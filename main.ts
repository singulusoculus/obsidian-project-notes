import {
  App,
  FuzzySuggestModal,
  ItemView,
  MarkdownView,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TAbstractFile,
  TFile,
  TextComponent,
  type ViewStateResult,
  type WorkspaceLeaf,
} from "obsidian";
import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { mount, unmount } from "svelte";
import ProjectBoard from "./src/components/ProjectBoard.svelte";
import {
  DEFAULT_SETTINGS,
  DEFAULT_VALUE_TOKENS,
  KANBAN_CARD_BASE_FIELDS,
  LOCKED_PROPERTY_NAMES,
  PROJECT_PROPERTY_TYPE_OPTIONS,
  TASK_PRIORITY_METADATA,
  TASK_PRIORITY_ORDER,
  VIEW_TYPES,
} from "./src/lib/constants";
import { NoteOpenService } from "./src/lib/services/noteOpenService";
import { TaskEditorSuggest } from "./src/lib/services/taskEditorSuggest";
import { ProjectIndexService } from "./src/lib/services/projectIndexService";
import { ProjectNormalizer } from "./src/lib/services/projectNormalizer";
import { TaskParser } from "./src/lib/services/taskParser";
import { makeNewArea, parsePersistedData } from "./src/lib/settings";
import { ProjectViewStore } from "./src/lib/stores/projectViewStore";
import { resolveAreaForPath } from "./src/lib/utils/areas";
import { appendRestoredDefaultView, ensureSavedViewsForArea } from "./src/lib/utils/savedViews";
import {
  buildConfiguredPropertyTypeMap,
  canonicalPropertyName,
  isLockedPropertyName,
  normalizePropertyName,
  normalizePropertyType,
  resolveAreaPropertyTemplates,
} from "./src/lib/utils/properties";
import type {
  AddTaskRequest,
  AreaConfig,
  BoardType,
  OpenTarget,
  SavedViewPromptResult,
  SavedViewTab,
  ProjectPropertyTemplate,
  StartupView,
  ProjectNote,
  PluginPersistedData,
  ProjectSettings,
  ViewVariant,
} from "./src/lib/types";
import { isIsoDate, slugifyAreaName, todayIsoDate } from "./src/lib/utils/text";

interface ViewDefinition {
  type: string;
  displayText: string;
  boardType: BoardType;
  variant: ViewVariant;
}

const PRIMARY_VIEW_DEFINITIONS: ViewDefinition[] = [
  {
    type: VIEW_TYPES.grid,
    displayText: "Project Notes",
    boardType: "grid",
    variant: "default",
  },
  {
    type: VIEW_TYPES.kanban,
    displayText: "Project Notes",
    boardType: "kanban",
    variant: "default",
  },
];

const LEGACY_VIEW_DEFINITIONS: ViewDefinition[] = [
  {
    type: "project-notes-grid-custom",
    displayText: "Project Notes Grid",
    boardType: "grid",
    variant: "default",
  },
  {
    type: "project-notes-kanban-custom",
    displayText: "Project Notes Kanban",
    boardType: "kanban",
    variant: "default",
  },
  {
    type: "project-notes-grid-bases",
    displayText: "Project Notes Grid",
    boardType: "grid",
    variant: "default",
  },
  {
    type: "project-notes-kanban-bases",
    displayText: "Project Notes Kanban",
    boardType: "kanban",
    variant: "default",
  },
];

const ALL_VIEW_DEFINITIONS = [...PRIMARY_VIEW_DEFINITIONS, ...LEGACY_VIEW_DEFINITIONS];
const IN_PROGRESS_TASK_LINE_REGEX = /^\s*[-*+]\s+\[\/\]\s*/;
const RESERVED_KANBAN_CARD_PROPERTY_KEYS = new Set<string>([
  "aliases",
  "status",
  "priority",
  "scheduled-date",
  "start-date",
  "finish-date",
  "due-date",
  "tags",
  "parent-project",
  "requester",
]);

function createTriStateLineDecorationExtension() {
  const inProgressLine = Decoration.line({ class: "opn-task-in-progress-line" });
  const priorityLines = new Map(
    TASK_PRIORITY_ORDER.map((priority) => [priority, Decoration.line({ class: TASK_PRIORITY_METADATA[priority].lineClass })]),
  );

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = this.buildDecorations(view);
      }

      update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = this.buildDecorations(update.view);
        }
      }

      private buildDecorations(view: EditorView): DecorationSet {
        const builder = new RangeSetBuilder<Decoration>();

        for (const { from, to } of view.visibleRanges) {
          let line = view.state.doc.lineAt(from);
          const end = to;

          while (true) {
            if (IN_PROGRESS_TASK_LINE_REGEX.test(line.text)) {
              builder.add(line.from, line.from, inProgressLine);
            }

            for (const priority of TASK_PRIORITY_ORDER) {
              if (!line.text.includes(TASK_PRIORITY_METADATA[priority].emoji)) {
                continue;
              }

              const decoration = priorityLines.get(priority);
              if (decoration) {
                builder.add(line.from, line.from, decoration);
              }
              break;
            }

            if (line.to >= end || line.number >= view.state.doc.lines) {
              break;
            }
            line = view.state.doc.line(line.number + 1);
          }
        }

        return builder.finish();
      }
    },
    {
      decorations: (value) => value.decorations,
    },
  );
}

class ProjectNotesView extends ItemView {
  private readonly plugin: ObsidianProjectNotesPlugin;
  private readonly definition: ViewDefinition;
  private viewStore: ProjectViewStore | null = null;
  private mountedComponent: ReturnType<typeof mount> | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: ObsidianProjectNotesPlugin, definition: ViewDefinition) {
    super(leaf);
    this.plugin = plugin;
    this.definition = definition;
  }

  getViewType(): string {
    return this.getResolvedDefinition().type;
  }

  getDisplayText(): string {
    return this.getResolvedDefinition().displayText;
  }

  getIcon(): string {
    return this.getResolvedDefinition().boardType === "grid" ? "layout-grid" : "kanban-square";
  }

  async onOpen(): Promise<void> {
    const definition = this.getResolvedDefinition();

    this.contentEl.empty();
    this.contentEl.addClass("project-notes-view");

    const areaId = this.extractInitialAreaId();
    const gridTab = this.extractInitialGridTab();

    this.viewStore = new ProjectViewStore({
      indexService: this.plugin.indexService,
      noteOpenService: this.plugin.noteOpenService,
      openSettings: () => this.plugin.openProjectNotesSettings(),
      createProject: () => this.plugin.createProjectNote(),
      createProjectInAreaWithStatus: (areaId, status) =>
        this.plugin.createProjectNote({ areaId, defaultStatus: status }),
      createTask: (areaId) => this.plugin.createTaskInArea(areaId),
      getSettings: () => this.plugin.settings,
      persistSettings: () => this.plugin.saveSettings({ reconcile: false }),
      promptSaveView: (currentName) => this.plugin.promptSaveView(currentName),
      boardType: definition.boardType,
      variant: definition.variant,
      initialAreaId: areaId,
      initialGridTab: gridTab,
    });

    this.mountedComponent = mount(ProjectBoard, {
      target: this.contentEl,
      props: {
        viewStore: this.viewStore,
        variant: definition.variant,
        boardType: definition.boardType,
      },
    });
  }

  async onClose(): Promise<void> {
    if (this.mountedComponent) {
      unmount(this.mountedComponent);
      this.mountedComponent = null;
    }

    this.viewStore?.destroy();
    this.viewStore = null;
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    await super.setState(state, result);

    if (!state || typeof state !== "object") {
      return;
    }

    const candidate = state as Record<string, unknown>;

    const areaId = candidate.areaId;
    if (typeof areaId === "string" && areaId.trim().length > 0) {
      this.viewStore?.setArea(areaId);
    }

    const gridTab = candidate.gridTab;
    if (gridTab === "projects" || gridTab === "tasks" || gridTab === "kanban") {
      this.viewStore?.setGridTab(gridTab);
    }
  }

  private extractInitialAreaId(): string | null {
    const state = this.leaf.getViewState().state;
    if (!state || typeof state !== "object" || !("areaId" in state)) {
      return null;
    }

    const value = state.areaId;
    if (typeof value !== "string" || value.trim().length === 0) {
      return null;
    }

    return value;
  }

  private extractInitialGridTab(): "projects" | "tasks" | "kanban" | undefined {
    const state = this.leaf.getViewState().state;
    if (!state || typeof state !== "object" || !("gridTab" in state)) {
      return undefined;
    }

    const value = state.gridTab;
    if (value === "projects" || value === "tasks" || value === "kanban") {
      return value;
    }

    return undefined;
  }

  private getResolvedDefinition(): ViewDefinition {
    if (this.definition) {
      return this.definition;
    }

    const typeFromLeaf = this.leaf?.getViewState()?.type;
    if (typeFromLeaf) {
      const match = ALL_VIEW_DEFINITIONS.find((candidate) => candidate.type === typeFromLeaf);
      if (match) {
        return match;
      }
    }

    return PRIMARY_VIEW_DEFINITIONS[0];
  }
}

class AreaSuggestModal extends FuzzySuggestModal<AreaConfig> {
  private readonly areas: AreaConfig[];
  private readonly resolve: (area: AreaConfig | null) => void;
  private hasResolved = false;

  constructor(app: App, areas: AreaConfig[], resolve: (area: AreaConfig | null) => void) {
    super(app);
    this.areas = areas;
    this.resolve = resolve;
    this.setPlaceholder("Choose an Area");
  }

  getItems(): AreaConfig[] {
    return this.areas;
  }

  getItemText(item: AreaConfig): string {
    return `${item.name} (${item.folderPath})`;
  }

  onChooseItem(item: AreaConfig): void {
    this.resolveOnce(item);
    this.close();
  }

  onClose(): void {
    super.onClose();
    window.setTimeout(() => {
      if (!this.hasResolved) {
        this.resolveOnce(null);
      }
    }, 0);
  }

  private resolveOnce(value: AreaConfig | null): void {
    if (this.hasResolved) {
      return;
    }

    this.hasResolved = true;
    this.resolve(value);
  }
}

class ProjectNameModal extends Modal {
  private readonly resolve: (value: string | null) => void;
  private inputComponent: TextComponent | null = null;
  private submitted = false;

  constructor(app: App, resolve: (value: string | null) => void) {
    super(app);
    this.resolve = resolve;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h1", { text: "Create Project Note" });

    const inputWrapper = contentEl.createDiv({ cls: "opn-modal-field" });
    inputWrapper.createEl("label", { text: "Filename", attr: { for: "opn-project-filename" } });

    this.inputComponent = new TextComponent(inputWrapper);
    this.inputComponent.inputEl.id = "opn-project-filename";
    this.inputComponent.setPlaceholder("Project name");
    this.inputComponent.inputEl.focus();

    const actionRow = contentEl.createDiv({ cls: "opn-modal-actions" });

    const createButton = actionRow.createEl("button", { text: "Create", cls: "mod-cta" });
    createButton.addEventListener("click", () => {
      const value = this.inputComponent?.getValue().trim() ?? "";
      if (!value) {
        new Notice("Filename is required.");
        return;
      }

      this.submitted = true;
      this.resolve(value);
      this.close();
    });

    const cancelButton = actionRow.createEl("button", { text: "Cancel" });
    cancelButton.addEventListener("click", () => {
      this.close();
    });

    this.inputComponent.inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        createButton.click();
      }
    });
  }

  onClose(): void {
    if (!this.submitted) {
      this.resolve(null);
    }
  }
}

class SaveViewModal extends Modal {
  private readonly initialName: string;
  private readonly resolve: (value: SavedViewPromptResult | null) => void;
  private inputComponent: TextComponent | null = null;
  private submitted = false;

  constructor(app: App, initialName: string, resolve: (value: SavedViewPromptResult | null) => void) {
    super(app);
    this.initialName = initialName;
    this.resolve = resolve;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h1", { text: "Save View" });

    const inputWrapper = contentEl.createDiv({ cls: "opn-modal-field" });
    inputWrapper.createEl("label", { text: "View Name", attr: { for: "opn-view-name" } });

    this.inputComponent = new TextComponent(inputWrapper);
    this.inputComponent.inputEl.id = "opn-view-name";
    this.inputComponent.setPlaceholder("View name");
    this.inputComponent.setValue(this.initialName);
    this.inputComponent.inputEl.focus();
    this.inputComponent.inputEl.select();

    const actionRow = contentEl.createDiv({ cls: "opn-modal-actions" });

    const updateButton = actionRow.createEl("button", { text: "Update Current View", cls: "mod-cta" });
    updateButton.addEventListener("click", () => {
      const name = this.inputComponent?.getValue().trim() ?? "";
      if (!name) {
        new Notice("View name is required.");
        return;
      }

      this.submitted = true;
      this.resolve({ action: "update-current", name });
      this.close();
    });

    const saveNewButton = actionRow.createEl("button", { text: "Save New View" });
    saveNewButton.addEventListener("click", () => {
      const name = this.inputComponent?.getValue().trim() ?? "";
      if (!name) {
        new Notice("View name is required.");
        return;
      }

      this.submitted = true;
      this.resolve({ action: "save-new", name });
      this.close();
    });

    const cancelButton = actionRow.createEl("button", { text: "Cancel" });
    cancelButton.addEventListener("click", () => {
      this.close();
    });

    this.inputComponent.inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        updateButton.click();
      }
    });
  }

  onClose(): void {
    if (!this.submitted) {
      this.resolve(null);
    }
  }
}

class AddTaskModal extends Modal {
  private readonly projects: ProjectNote[];
  private readonly resolve: (value: AddTaskRequest | null) => void;
  private selectedProjectPath: string;
  private projectFilterInput: TextComponent | null = null;
  private projectPopoverEl: HTMLDivElement | null = null;
  private projectSelectEl: HTMLSelectElement | null = null;
  private projectPickerPointerHandler: ((event: PointerEvent) => void) | null = null;
  private taskInput: TextComponent | null = null;
  private scheduledDateInput: HTMLInputElement | null = null;
  private startDateInput: HTMLInputElement | null = null;
  private dueDateInput: HTMLInputElement | null = null;
  private submitted = false;

  constructor(app: App, projects: ProjectNote[], resolve: (value: AddTaskRequest | null) => void) {
    super(app);
    this.projects = projects;
    this.resolve = resolve;
    this.selectedProjectPath = projects[0]?.path ?? "";
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h1", { text: "Add Task" });

    const projectWrapper = contentEl.createDiv({ cls: "opn-modal-field" });
    projectWrapper.createEl("label", { text: "Project", attr: { for: "opn-task-project-filter" } });
    const projectPickerWrapper = projectWrapper.createDiv({ cls: "opn-task-project-picker" });

    this.projectFilterInput = new TextComponent(projectPickerWrapper);
    this.projectFilterInput.inputEl.id = "opn-task-project-filter";
    this.projectFilterInput.setPlaceholder("Search or choose project");

    this.projectPopoverEl = projectPickerWrapper.createDiv({ cls: "opn-task-project-popover is-hidden" });
    this.projectSelectEl = this.projectPopoverEl.createEl("select", {
      attr: {
        id: "opn-task-project",
      },
    });
    this.projectSelectEl.addClass("opn-task-project-select");
    this.projectSelectEl.addEventListener("change", (event) => {
      this.selectedProjectPath = (event.currentTarget as HTMLSelectElement).value;
      this.syncSelectedProjectLabel();
    });
    this.projectSelectEl.addEventListener("dblclick", () => {
      this.hideProjectPopover();
      this.taskInput?.inputEl.focus();
    });
    this.projectSelectEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.selectedProjectPath = this.projectSelectEl?.value ?? "";
        this.syncSelectedProjectLabel();
        this.hideProjectPopover();
        this.taskInput?.inputEl.focus();
      } else if (event.key === "Escape") {
        event.preventDefault();
        this.hideProjectPopover();
        this.projectFilterInput?.inputEl.focus();
      }
    });

    this.projectFilterInput.inputEl.addEventListener("focus", () => {
      this.projectFilterInput?.inputEl.select();
      this.renderFilteredProjectOptions("");
      this.showProjectPopover();
    });
    this.projectFilterInput.inputEl.addEventListener("click", () => {
      this.renderFilteredProjectOptions("");
      this.showProjectPopover();
    });
    this.projectFilterInput.inputEl.addEventListener("input", () => {
      const query = this.projectFilterInput?.getValue() ?? "";
      this.renderFilteredProjectOptions(query);
      this.showProjectPopover();
    });
    this.projectFilterInput.inputEl.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        this.showProjectPopover();
        this.projectSelectEl?.focus();
      } else if (event.key === "Escape") {
        event.preventDefault();
        this.hideProjectPopover();
      }
    });

    this.renderFilteredProjectOptions("");
    this.syncSelectedProjectLabel();

    this.projectPickerPointerHandler = (event: PointerEvent) => {
      if (this.isInsideProjectPicker(event.target)) {
        return;
      }
      this.hideProjectPopover();
    };
    window.addEventListener("pointerdown", this.projectPickerPointerHandler, true);

    const taskWrapper = contentEl.createDiv({ cls: "opn-modal-field" });
    taskWrapper.createEl("label", { text: "Task", attr: { for: "opn-task-text" } });
    this.taskInput = new TextComponent(taskWrapper);
    this.taskInput.inputEl.id = "opn-task-text";
    this.taskInput.setPlaceholder("Task description");

    const scheduledWrapper = contentEl.createDiv({ cls: "opn-modal-field" });
    scheduledWrapper.createEl("label", { text: "Scheduled Date", attr: { for: "opn-task-scheduled-date" } });
    this.scheduledDateInput = scheduledWrapper.createEl("input", {
      attr: {
        id: "opn-task-scheduled-date",
        type: "date",
        value: todayIsoDate(),
      },
    });

    const startWrapper = contentEl.createDiv({ cls: "opn-modal-field" });
    startWrapper.createEl("label", { text: "Start Date", attr: { for: "opn-task-start-date" } });
    this.startDateInput = startWrapper.createEl("input", {
      attr: {
        id: "opn-task-start-date",
        type: "date",
      },
    });

    const dueWrapper = contentEl.createDiv({ cls: "opn-modal-field" });
    dueWrapper.createEl("label", { text: "Due Date", attr: { for: "opn-task-due-date" } });
    this.dueDateInput = dueWrapper.createEl("input", {
      attr: {
        id: "opn-task-due-date",
        type: "date",
      },
    });

    const actionRow = contentEl.createDiv({ cls: "opn-modal-actions" });
    const addButton = actionRow.createEl("button", { text: "Add Task", cls: "mod-cta" });
    addButton.addEventListener("click", () => {
      const text = this.taskInput?.getValue().trim() ?? "";
      if (!text) {
        new Notice("Task text is required.");
        return;
      }

      if (!this.selectedProjectPath) {
        new Notice("Choose a project.");
        return;
      }

      const scheduledDate = this.scheduledDateInput?.value.trim() ?? "";
      if (!isIsoDate(scheduledDate)) {
        new Notice("Scheduled date must be a valid date.");
        return;
      }

      const rawStartDate = this.startDateInput?.value.trim() ?? "";
      const startDate = rawStartDate.length > 0 ? rawStartDate : null;
      if (startDate && !isIsoDate(startDate)) {
        new Notice("Start date must be a valid date.");
        return;
      }

      const rawDueDate = this.dueDateInput?.value.trim() ?? "";
      const dueDate = rawDueDate.length > 0 ? rawDueDate : null;
      if (dueDate && !isIsoDate(dueDate)) {
        new Notice("Due date must be a valid date.");
        return;
      }

      this.submitted = true;
      this.resolve({
        projectPath: this.selectedProjectPath,
        text,
        scheduledDate,
        startDate,
        dueDate,
      });
      this.close();
    });

    const cancelButton = actionRow.createEl("button", { text: "Cancel" });
    cancelButton.addEventListener("click", () => {
      this.close();
    });

    this.taskInput.inputEl.focus();
    this.taskInput.inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        addButton.click();
      }
    });
  }

  onClose(): void {
    if (this.projectPickerPointerHandler) {
      window.removeEventListener("pointerdown", this.projectPickerPointerHandler, true);
      this.projectPickerPointerHandler = null;
    }

    if (!this.submitted) {
      this.resolve(null);
    }
  }

  private isInsideProjectPicker(target: EventTarget | null): boolean {
    if (!(target instanceof Node)) {
      return false;
    }

    return (
      this.projectFilterInput?.inputEl.contains(target) === true ||
      this.projectPopoverEl?.contains(target) === true
    );
  }

  private showProjectPopover(): void {
    if (!this.projectPopoverEl) {
      return;
    }

    this.projectPopoverEl.classList.remove("is-hidden");
  }

  private hideProjectPopover(): void {
    if (!this.projectPopoverEl) {
      return;
    }

    this.projectPopoverEl.classList.add("is-hidden");
  }

  private renderFilteredProjectOptions(query: string): void {
    if (!this.projectSelectEl) {
      return;
    }

    const normalizedQuery = query.trim().toLowerCase();
    const filteredProjects =
      normalizedQuery.length === 0
        ? this.projects
        : this.projects.filter((project) => this.projectSearchText(project).includes(normalizedQuery));

    const selectEl = this.projectSelectEl;
    selectEl.empty();

    if (filteredProjects.length === 0) {
      this.selectedProjectPath = "";
      const option = selectEl.createEl("option", {
        text: "No matching projects",
        attr: { value: "" },
      });
      option.disabled = true;
      option.selected = true;
      selectEl.size = 8;
      return;
    }

    for (const project of filteredProjects) {
      const option = selectEl.createEl("option", {
        text: this.projectDisplayName(project),
        attr: { value: project.path },
      });
      if (project.path === this.selectedProjectPath) {
        option.selected = true;
      }
    }

    if (!filteredProjects.some((project) => project.path === this.selectedProjectPath)) {
      this.selectedProjectPath = filteredProjects[0].path;
    }

    selectEl.value = this.selectedProjectPath;
    selectEl.size = Math.min(14, Math.max(8, filteredProjects.length));
  }

  private syncSelectedProjectLabel(): void {
    if (!this.projectFilterInput) {
      return;
    }

    const selectedProject = this.projects.find((project) => project.path === this.selectedProjectPath);
    this.projectFilterInput.setValue(selectedProject ? this.projectDisplayName(selectedProject) : "");
  }

  private projectDisplayName(project: ProjectNote): string {
    return project.displayName || project.title;
  }

  private projectSearchText(project: ProjectNote): string {
    return [project.displayName, project.title, project.path]
      .filter((value) => value && value.length > 0)
      .join(" ")
      .toLowerCase();
  }
}

class ProjectNotesSettingTab extends PluginSettingTab {
  private readonly plugin: ObsidianProjectNotesPlugin;
  private activePanel: "general" | "properties" | "areas" = "general";

  constructor(app: App, plugin: ObsidianProjectNotesPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Project Notes" });

    const tabsEl = containerEl.createDiv({ cls: "opn-settings-tabs" });
    this.renderPanelTabButton(tabsEl, "general", "General");
    this.renderPanelTabButton(tabsEl, "properties", "Properties");
    this.renderPanelTabButton(tabsEl, "areas", "Areas");

    const panelEl = containerEl.createDiv({ cls: "opn-settings-panel" });
    if (this.activePanel === "general") {
      this.renderGeneralSettings(panelEl);
      return;
    }

    if (this.activePanel === "properties") {
      this.renderPropertiesSettings(panelEl);
      return;
    }

    this.renderAreasSettings(panelEl);
  }

  private renderPanelTabButton(
    containerEl: HTMLElement,
    panel: "general" | "properties" | "areas",
    label: string,
  ): void {
    const button = containerEl.createEl("button", {
      text: label,
      cls: "opn-settings-tab",
      attr: { type: "button" },
    });

    if (this.activePanel === panel) {
      button.addClass("is-active");
    }

    button.addEventListener("click", () => {
      if (this.activePanel === panel) {
        return;
      }

      this.activePanel = panel;
      this.display();
    });
  }

  private renderGeneralSettings(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("Open project note target")
      .setDesc("Where notes opened from Grid/Kanban should appear.")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("new-tab", "New Tab")
          .addOption("left-sidebar", "Sidebar (Left)")
          .addOption("right-sidebar", "Sidebar (Right)")
          .addOption("left-split", "Left Split")
          .addOption("right-split", "Right Split")
          .addOption("bottom-split", "Bottom Split")
          .setValue(this.plugin.settings.openTarget)
          .onChange(async (value) => {
            this.plugin.settings.openTarget = value as OpenTarget;
            await this.plugin.saveSettings({ reconcile: false });
          });
      });

    new Setting(containerEl)
      .setName("Open view on startup")
      .setDesc("Project Notes view to open when Obsidian starts.")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("none", "None")
          .addOption("projects", "Projects")
          .addOption("tasks", "Tasks")
          .addOption("kanban", "Kanban");
        dropdown.setValue(this.plugin.settings.startupView).onChange(async (value) => {
          this.plugin.settings.startupView = value as StartupView;
          await this.plugin.saveSettings({ reconcile: false });
        });
      });

    new Setting(containerEl)
      .setName("Tri-state task checkboxes")
      .setDesc("Cycle task checkbox states as unchecked -> in progress ([/]) -> checked -> unchecked.")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.enableTriStateCheckboxes).onChange(async (value) => {
          this.plugin.settings.enableTriStateCheckboxes = value;
          await this.plugin.saveSettings({ reconcile: false });
        });
      });

    new Setting(containerEl)
      .setName("Task note auto-suggest")
      .setDesc("Show task-entry suggestions for dates and priorities inside note `## Tasks` sections.")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.enableTaskAutoSuggest).onChange(async (value) => {
          this.plugin.settings.enableTaskAutoSuggest = value;
          await this.plugin.saveSettings({ reconcile: false });
        });
      });

    new Setting(containerEl)
      .setName("Task auto-suggest minimum match")
      .setDesc("How many characters to type before task note suggestions appear. Use `0` to show them immediately.")
      .addText((text) => {
        text
          .setPlaceholder("0")
          .setValue(String(this.plugin.settings.taskAutoSuggestMinMatch))
          .onChange(async (value) => {
            const parsed = Number(value);
            if (!Number.isFinite(parsed) || parsed < 0) {
              return;
            }

            this.plugin.settings.taskAutoSuggestMinMatch = Math.max(0, Math.floor(parsed));
            await this.plugin.saveSettings({ reconcile: false });
          });
      });

    new Setting(containerEl)
      .setName("Task auto-suggest max results")
      .setDesc("Maximum number of task note suggestions shown at once.")
      .addText((text) => {
        text
          .setPlaceholder("8")
          .setValue(String(this.plugin.settings.taskAutoSuggestMaxSuggestions))
          .onChange(async (value) => {
            const parsed = Number(value);
            if (!Number.isFinite(parsed) || parsed < 1) {
              return;
            }

            this.plugin.settings.taskAutoSuggestMaxSuggestions = Math.max(1, Math.floor(parsed));
            await this.plugin.saveSettings({ reconcile: false });
          });
      });

    new Setting(containerEl)
      .setName("Statuses")
      .setDesc("Comma-separated statuses. You can override this per Area.")
      .addTextArea((text) => {
        text.setValue(this.plugin.settings.statuses.join(", ")).onChange(async (value) => {
          const parsed = parseCsv(value);
          this.plugin.settings.statuses = parsed.length > 0 ? parsed : [...DEFAULT_SETTINGS.statuses];
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Priorities")
      .setDesc("Comma-separated priorities. You can override this per Area.")
      .addText((text) => {
        text.setValue(this.plugin.settings.priorities.join(", ")).onChange(async (value) => {
          const parsed = parseCsv(value);
          this.plugin.settings.priorities = parsed.length > 0 ? parsed : [...DEFAULT_SETTINGS.priorities];
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Default project status filter")
      .setDesc("Comma-separated statuses used as default Grid/Kanban filter.")
      .addText((text) => {
        text.setValue(this.plugin.settings.defaultProjectStatuses.join(", ")).onChange(async (value) => {
          const parsed = parseCsv(value);
          this.plugin.settings.defaultProjectStatuses =
            parsed.length > 0 ? parsed : [...DEFAULT_SETTINGS.defaultProjectStatuses];
          await this.plugin.saveSettings({ reconcile: false });
        });
      });

    new Setting(containerEl)
      .setName("Default sort")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("project", "Project")
          .addOption("status", "Status")
          .addOption("priority", "Priority")
          .addOption("timing-status", "Timing Status")
          .addOption("scheduled-date", "Scheduled Date")
          .addOption("start-date", "Start Date")
          .addOption("finish-date", "Finish Date")
          .addOption("due-date", "Due Date")
          .addOption("tags", "Tags")
          .addOption("parent-project", "Parent Project")
          .addOption("requester", "Requester")
          .setValue(this.plugin.settings.defaultSortBy)
          .onChange(async (value) => {
            this.plugin.settings.defaultSortBy = value as ProjectSettings["defaultSortBy"];
            await this.plugin.saveSettings({ reconcile: false });
          });
      })
      .addDropdown((dropdown) => {
        dropdown
          .addOption("asc", "Ascending")
          .addOption("desc", "Descending")
          .setValue(this.plugin.settings.defaultSortDirection)
          .onChange(async (value) => {
            this.plugin.settings.defaultSortDirection = value as ProjectSettings["defaultSortDirection"];
            await this.plugin.saveSettings({ reconcile: false });
          });
      });

    new Setting(containerEl)
      .setName("Kanban hidden statuses")
      .setDesc("Comma-separated statuses hidden by default in Kanban (shown as drop zones).")
      .addText((text) => {
        text.setValue(this.plugin.settings.kanbanHiddenStatuses.join(", ")).onChange(async (value) => {
          this.plugin.settings.kanbanHiddenStatuses = parseCsv(value);
          await this.plugin.saveSettings({ reconcile: false });
        });
      });

    new Setting(containerEl)
      .setName("Kanban default next task count")
      .setDesc("Default number of incomplete tasks shown in the `Next Task(s)` card field.")
      .addText((text) => {
        text
          .setPlaceholder("1")
          .setValue(String(this.plugin.settings.kanbanCardDefaultNextTaskCount))
          .onChange(async (value) => {
            const parsed = Number(value);
            if (!Number.isFinite(parsed) || parsed < 1) {
              return;
            }

            this.plugin.settings.kanbanCardDefaultNextTaskCount = Math.max(1, Math.floor(parsed));
            await this.plugin.saveSettings({ reconcile: false });
          });
      });

    new Setting(containerEl)
      .setName("Kanban notes preview words")
      .setDesc("Word count used for collapsed Notes text in Kanban cards before `Read More`.")
      .addText((text) => {
        text
          .setPlaceholder("100")
          .setValue(String(this.plugin.settings.kanbanNotesPreviewWords))
          .onChange(async (value) => {
            const parsed = Number(value);
            if (!Number.isFinite(parsed) || parsed < 1) {
              return;
            }

            this.plugin.settings.kanbanNotesPreviewWords = Math.max(1, Math.floor(parsed));
            await this.plugin.saveSettings({ reconcile: false });
          });
      });

    new Setting(containerEl)
      .setName("Kanban notes preview lines")
      .setDesc("Line count used for collapsed Notes text in Kanban cards before `Read More`.")
      .addText((text) => {
        text
          .setPlaceholder("5")
          .setValue(String(this.plugin.settings.kanbanNotesPreviewLines))
          .onChange(async (value) => {
            const parsed = Number(value);
            if (!Number.isFinite(parsed) || parsed < 1) {
              return;
            }

            this.plugin.settings.kanbanNotesPreviewLines = Math.max(1, Math.floor(parsed));
            await this.plugin.saveSettings({ reconcile: false });
          });
      });

    this.renderKanbanCardFieldSettings({
      containerEl,
      heading: "Kanban default card fields",
      area: null,
      selectedFieldIds: this.plugin.settings.kanbanCardDefaultFieldIds,
      onFieldIdsChange: async (fieldIds) => {
        this.plugin.settings.kanbanCardDefaultFieldIds = fieldIds;
        await this.plugin.saveSettings({ reconcile: false });
      },
    });

    new Setting(containerEl)
      .setName("Reconcile interval (minutes)")
      .setDesc("How often to run background cache reconciliation.")
      .addText((text) => {
        text
          .setPlaceholder("10")
          .setValue(String(this.plugin.settings.cacheReconcileMinutes))
          .onChange(async (value) => {
            const parsed = Number(value);
            if (Number.isFinite(parsed) && parsed > 0) {
              this.plugin.settings.cacheReconcileMinutes = parsed;
              await this.plugin.saveSettings({ reconcile: false, resetInterval: true });
            }
          });
      });
  }

  private renderPropertiesSettings(containerEl: HTMLElement): void {
    
    containerEl.createEl("p", {
      text: "Define default properties auto-added to new/normalized project notes. Missing properties are added; existing values are preserved.",
    });

    const tokenListEl = containerEl.createDiv();
    tokenListEl.createEl("strong", { text: "Dynamic default tokens: " });
    tokenListEl.createEl("span", {
      text: DEFAULT_VALUE_TOKENS.map((token) => `${token.token} (${token.description})`).join(", "),
    });

    this.renderPropertyTemplateEditor({
      containerEl,
      heading: "Global default properties",
      templates: this.plugin.settings.defaultProperties,
      lockProtectedProperties: true,
      onChange: async () => {
        await this.plugin.saveSettings({ reconcile: false, syncPropertyTypes: true });
      },
      onAdd: async () => {
        this.plugin.settings.defaultProperties.push({
          name: this.nextPropertyName(this.plugin.settings.defaultProperties, "new-property"),
          type: "text",
          defaultValue: "",
        });
        await this.plugin.saveSettings({ reconcile: false, syncPropertyTypes: true });
      },
      onRemove: async (index) => {
        this.plugin.settings.defaultProperties.splice(index, 1);
        await this.plugin.saveSettings({ reconcile: false, syncPropertyTypes: true });
      },
    });
  }

  private renderAreasSettings(containerEl: HTMLElement): void {
    containerEl.createEl("p", {
      text: "Setup new areas and edit/remove existing areas",
    });

    for (const area of this.plugin.settings.areas) {
      const areaContainer = containerEl.createDiv({ cls: "opn-area-setting" });
      const areaDisclosure = areaContainer.createEl("details", { cls: "opn-area-disclosure" });
      areaDisclosure.open = false;
      const areaSummaryEl = areaDisclosure.createEl("summary", { cls: "opn-area-summary" });
      const areaTitleEl = areaSummaryEl.createEl("strong", { text: area.name || "Unnamed Area" });
      const areaSettingsEl = areaDisclosure.createDiv({ cls: "opn-area-settings" });

      new Setting(areaSettingsEl)
        .setName("Area Name")
        .addText((text) => {
          text.setValue(area.name).onChange(async (value) => {
            area.name = value;
            area.slug = slugifyAreaName(value);
            areaTitleEl.setText(value.trim().length > 0 ? value.trim() : "Unnamed Area");
            await this.plugin.saveSettings();
          });
        });

      new Setting(areaSettingsEl)
        .setName("Folder Path")
        .setDesc("Path inside vault, e.g. Projects/Client-A")
        .addText((text) => {
          text.setValue(area.folderPath).onChange(async (value) => {
            area.folderPath = value.replace(/^\/+|\/+$/g, "");
            await this.plugin.saveSettings();
          });
        });

      new Setting(areaSettingsEl)
        .setName("Include Mode")
        .addDropdown((dropdown) => {
          dropdown
            .addOption("recursive", "Recursive (include subfolders)")
            .addOption("top-level", "Top-level only")
            .setValue(area.includeMode)
            .onChange(async (value) => {
              area.includeMode = value as AreaConfig["includeMode"];
              await this.plugin.saveSettings();
            });
        });

      new Setting(areaSettingsEl)
        .setName("Status overrides")
        .setDesc("Optional comma-separated list. Empty means use global statuses.")
        .addText((text) => {
          text.setValue((area.statusOverrides ?? []).join(", ")).onChange(async (value) => {
            const parsed = parseCsv(value);
            area.statusOverrides = parsed.length > 0 ? parsed : undefined;
            await this.plugin.saveSettings({ reconcile: false });
          });
        });

      new Setting(areaSettingsEl)
        .setName("Priority overrides")
        .setDesc("Optional comma-separated list. Empty means use global priorities.")
        .addText((text) => {
          text.setValue((area.priorityOverrides ?? []).join(", ")).onChange(async (value) => {
            const parsed = parseCsv(value);
            area.priorityOverrides = parsed.length > 0 ? parsed : undefined;
            await this.plugin.saveSettings({ reconcile: false });
          });
        });

      new Setting(areaSettingsEl)
        .setName("Disabled global properties")
        .setDesc("Comma-separated property names to skip auto-adding in this Area. Locked properties are ignored.")
        .addText((text) => {
          text.setValue((area.disabledPropertyNames ?? []).join(", ")).onChange(async (value) => {
            area.disabledPropertyNames = parseCsv(value)
              .map((name) => canonicalPropertyName(name))
              .filter((name) => name.length > 0)
              .filter((name) => !LOCKED_PROPERTY_NAMES.has(name));
            await this.plugin.saveSettings({ reconcile: false, syncPropertyTypes: true });
          });
        });

      this.renderPropertyTemplateEditor({
        containerEl: areaSettingsEl,
        heading: "Area property overrides",
        templates: area.propertyOverrides ?? (area.propertyOverrides = []),
        lockProtectedProperties: true,
        onChange: async () => {
          await this.plugin.saveSettings({ reconcile: false, syncPropertyTypes: true });
        },
        onAdd: async () => {
          const overrides = area.propertyOverrides ?? (area.propertyOverrides = []);
          overrides.push({
            name: this.nextPropertyName(overrides, "area-property"),
            type: "text",
            defaultValue: "",
          });
          await this.plugin.saveSettings({ reconcile: false, syncPropertyTypes: true });
        },
        onRemove: async (index) => {
          const overrides = area.propertyOverrides ?? (area.propertyOverrides = []);
          overrides.splice(index, 1);
          await this.plugin.saveSettings({ reconcile: false, syncPropertyTypes: true });
        },
      });

      const hasKanbanCardFieldOverride =
        Array.isArray(this.plugin.settings.kanbanCardFieldsByArea[area.id]) &&
        this.plugin.settings.kanbanCardFieldsByArea[area.id].length > 0;
      const hasKanbanNextTaskCountOverride = typeof this.plugin.settings.kanbanCardNextTaskCountByArea[area.id] === "number";
      const hasKanbanCardOverride = hasKanbanCardFieldOverride || hasKanbanNextTaskCountOverride;

      new Setting(areaSettingsEl)
        .setName("Override Kanban card settings")
        .setDesc("When enabled, this Area uses its own Kanban card field selection and next-task count.")
        .addToggle((toggle) => {
          toggle.setValue(hasKanbanCardOverride).onChange(async (value) => {
            if (value) {
              if (!this.plugin.settings.kanbanCardFieldsByArea[area.id] || this.plugin.settings.kanbanCardFieldsByArea[area.id].length === 0) {
                this.plugin.settings.kanbanCardFieldsByArea[area.id] = [...this.plugin.settings.kanbanCardDefaultFieldIds];
              }

              if (
                !Number.isFinite(this.plugin.settings.kanbanCardNextTaskCountByArea[area.id]) ||
                this.plugin.settings.kanbanCardNextTaskCountByArea[area.id] < 1
              ) {
                this.plugin.settings.kanbanCardNextTaskCountByArea[area.id] = this.plugin.settings.kanbanCardDefaultNextTaskCount;
              }
            } else {
              delete this.plugin.settings.kanbanCardFieldsByArea[area.id];
              delete this.plugin.settings.kanbanCardNextTaskCountByArea[area.id];
            }

            await this.plugin.saveSettings({ reconcile: false });
            this.display();
          });
        });

      if (hasKanbanCardOverride) {
        const areaNextTaskCountOverride = this.plugin.settings.kanbanCardNextTaskCountByArea[area.id];
        this.renderKanbanCardFieldSettings({
          containerEl: areaSettingsEl,
          heading: "Kanban card field overrides",
          area,
          selectedFieldIds: this.plugin.settings.kanbanCardFieldsByArea[area.id] ?? this.plugin.settings.kanbanCardDefaultFieldIds,
          onFieldIdsChange: async (fieldIds) => {
            this.plugin.settings.kanbanCardFieldsByArea[area.id] = fieldIds;
            await this.plugin.saveSettings({ reconcile: false });
          },
        });

        new Setting(areaSettingsEl)
          .setName("Kanban next task count override")
          .setDesc("Area-specific number of incomplete tasks shown in `Next Task(s)`.")
          .addText((text) => {
            text
              .setPlaceholder(String(this.plugin.settings.kanbanCardDefaultNextTaskCount))
              .setValue(String(Number.isFinite(areaNextTaskCountOverride) ? areaNextTaskCountOverride : this.plugin.settings.kanbanCardDefaultNextTaskCount))
              .onChange(async (value) => {
                const parsed = Number(value);
                if (!Number.isFinite(parsed) || parsed < 1) {
                  return;
                }

                this.plugin.settings.kanbanCardNextTaskCountByArea[area.id] = Math.max(1, Math.floor(parsed));
                await this.plugin.saveSettings({ reconcile: false });
              });
          });
      }

      areaSettingsEl.createEl("h3", { text: "Saved Views" });

      new Setting(areaSettingsEl)
        .setName("Restore Projects Default View")
        .setDesc("Append a new Default saved view for the Projects tab in this Area.")
        .addButton((button) => {
          button.setButtonText("Restore").onClick(async () => {
            await this.plugin.restoreDefaultSavedView(area.id, "projects");
            new Notice("Restored Projects Default view.");
          });
        });

      new Setting(areaSettingsEl)
        .setName("Restore Tasks Default View")
        .setDesc("Append a new Default saved view for the Tasks tab in this Area.")
        .addButton((button) => {
          button.setButtonText("Restore").onClick(async () => {
            await this.plugin.restoreDefaultSavedView(area.id, "tasks");
            new Notice("Restored Tasks Default view.");
          });
        });

      new Setting(areaSettingsEl)
        .setName("Restore Kanban Default View")
        .setDesc("Append a new Default saved view for the Kanban tab in this Area.")
        .addButton((button) => {
          button.setButtonText("Restore").onClick(async () => {
            await this.plugin.restoreDefaultSavedView(area.id, "kanban");
            new Notice("Restored Kanban Default view.");
          });
        });

      new Setting(areaSettingsEl)
        .setName("Remove Area")
        .addButton((button) => {
          button
            .setButtonText("Remove")
            .setWarning()
            .onClick(async () => {
              this.plugin.settings.areas = this.plugin.settings.areas.filter((candidate) => candidate.id !== area.id);
              delete this.plugin.settings.gridColumnsByArea[area.id];
              delete this.plugin.settings.kanbanCardFieldsByArea[area.id];
              delete this.plugin.settings.kanbanCardNextTaskCountByArea[area.id];
              await this.plugin.saveSettings();
              this.display();
            });
        });
    }

    new Setting(containerEl)
      .setName("Add Area")
      .setDesc("Add a new folder-backed Area.")
      .addButton((button) => {
        button
          .setButtonText("Add")
          .onClick(async () => {
            this.plugin.settings.areas.push(makeNewArea());
            await this.plugin.saveSettings({ reconcile: false });
            this.display();
          });
      });
  }

  private renderPropertyTemplateEditor(options: {
    containerEl: HTMLElement;
    heading: string;
    templates: ProjectPropertyTemplate[];
    lockProtectedProperties: boolean;
    onChange: () => Promise<void>;
    onAdd: () => Promise<void>;
    onRemove: (index: number) => Promise<void>;
  }): void {
    const sectionEl = options.containerEl.createDiv({ cls: "opn-area-setting" });
    sectionEl.createEl("h4", { text: options.heading });

    if (options.templates.length === 0) {
      sectionEl.createEl("p", { text: "No properties configured." });
    }

    options.templates.forEach((template, index) => {
      const locked = options.lockProtectedProperties && isLockedPropertyName(template.name);
      const propertyName = template.name || `Property ${index + 1}`;

      const setting = new Setting(sectionEl);
      setting
        .setName(locked ? `${propertyName} (locked)` : propertyName)
        .setDesc("Name, type, default value")
        .addText((text) => {
          text
            .setPlaceholder("property-name")
            .setValue(template.name)
            .setDisabled(locked)
            .onChange(async (value) => {
              const normalizedName = normalizePropertyName(value);
              if (normalizedName.length === 0) {
                return;
              }

              if (options.lockProtectedProperties && isLockedPropertyName(normalizedName)) {
                new Notice(`Property '${normalizedName}' is locked and cannot be overridden.`);
                text.setValue(template.name);
                return;
              }

              if (this.hasDuplicatePropertyName(options.templates, index, normalizedName)) {
                new Notice(`Property '${normalizedName}' already exists in this list.`);
                text.setValue(template.name);
                return;
              }

              template.name = normalizedName;
              await options.onChange();
            });
        })
        .addDropdown((dropdown) => {
          for (const option of PROJECT_PROPERTY_TYPE_OPTIONS) {
            dropdown.addOption(option.value, option.label);
          }

          dropdown
            .setValue(template.type)
            .setDisabled(locked)
            .onChange(async (value) => {
              template.type = normalizePropertyType(value);
              await options.onChange();
            });
        })
        .addText((text) => {
          text
            .setPlaceholder("default value")
            .setValue(template.defaultValue ?? "")
            .onChange(async (value) => {
              template.defaultValue = value;
              await options.onChange();
            });
        });

      if (!locked) {
        setting.addExtraButton((button) => {
          button
            .setIcon("cross")
            .setTooltip("Remove property")
            .onClick(async () => {
              await options.onRemove(index);
              this.display();
            });
        });
      }
    });

    new Setting(sectionEl)
      .setName("Add property")
      .addButton((button) => {
        button.setButtonText("Add").onClick(async () => {
          await options.onAdd();
          this.display();
        });
      });
  }

  private renderKanbanCardFieldSettings(options: {
    containerEl: HTMLElement;
    heading: string;
    area: AreaConfig | null;
    selectedFieldIds: string[];
    onFieldIdsChange: (fieldIds: string[]) => Promise<void>;
  }): void {
    const sectionEl = options.containerEl.createDiv({ cls: "opn-area-setting" });
    sectionEl.createEl("h4", { text: options.heading });

    const availableFields = this.buildKanbanCardFieldOptions(options.area);
    const normalizedSelection = this.normalizeKanbanCardFieldSelection(options.selectedFieldIds, availableFields);
    const selected = new Set(normalizedSelection);

    for (const field of availableFields) {
      new Setting(sectionEl)
        .setName(field.label)
        .setDesc(field.id === "name" ? "Always visible" : "")
        .addToggle((toggle) => {
          toggle
            .setValue(selected.has(field.id))
            .setDisabled(field.id === "name")
            .onChange(async (visible) => {
              if (field.id === "name") {
                return;
              }

              if (visible) {
                selected.add(field.id);
              } else {
                selected.delete(field.id);
              }
              selected.add("name");

              const ordered = availableFields
                .map((candidate) => candidate.id)
                .filter((candidate) => selected.has(candidate));

              await options.onFieldIdsChange(ordered);
            });
        });
    }
  }

  private buildKanbanCardFieldOptions(area: AreaConfig | null): Array<{ id: string; label: string }> {
    const options = KANBAN_CARD_BASE_FIELDS.map((field) => ({ id: field.id, label: field.label }));
    const seen = new Set(options.map((option) => option.id));

    for (const template of resolveAreaPropertyTemplates(this.plugin.settings, area)) {
      const canonical = canonicalPropertyName(template.name);
      if (RESERVED_KANBAN_CARD_PROPERTY_KEYS.has(canonical)) {
        continue;
      }

      const id = `property:${canonical}`;
      if (seen.has(id)) {
        continue;
      }

      options.push({
        id,
        label: template.name,
      });
      seen.add(id);
    }

    return options;
  }

  private normalizeKanbanCardFieldSelection(
    fieldIds: string[],
    availableFields: Array<{ id: string; label: string }>,
  ): string[] {
    const available = new Set(availableFields.map((field) => field.id));
    const selected = new Set<string>();
    for (const fieldId of fieldIds) {
      if (available.has(fieldId)) {
        selected.add(fieldId);
      }
    }
    selected.add("name");

    return availableFields
      .map((field) => field.id)
      .filter((fieldId) => selected.has(fieldId));
  }

  private hasDuplicatePropertyName(templates: ProjectPropertyTemplate[], currentIndex: number, nextName: string): boolean {
    const target = canonicalPropertyName(nextName);
    return templates.some((template, index) => {
      if (index === currentIndex) {
        return false;
      }

      return canonicalPropertyName(template.name) === target;
    });
  }

  private nextPropertyName(templates: ProjectPropertyTemplate[], baseName: string): string {
    const base = canonicalPropertyName(baseName) || "new-property";
    const existing = new Set(templates.map((template) => canonicalPropertyName(template.name)));

    if (!existing.has(base)) {
      return base;
    }

    let index = 2;
    while (existing.has(`${base}-${index}`)) {
      index += 1;
    }

    return `${base}-${index}`;
  }
}

function parseCsv(value: string): string[] {
  return value
    .split(",")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function isMarkdownFile(file: TAbstractFile): file is TFile {
  return file instanceof TFile && file.extension === "md";
}

export default class ObsidianProjectNotesPlugin extends Plugin {
  settings: ProjectSettings = {
    ...DEFAULT_SETTINGS,
    areas: [],
    statuses: [...DEFAULT_SETTINGS.statuses],
    priorities: [...DEFAULT_SETTINGS.priorities],
    defaultProperties: DEFAULT_SETTINGS.defaultProperties.map((property) => ({ ...property })),
    gridColumnsByArea: { ...DEFAULT_SETTINGS.gridColumnsByArea },
    kanbanCardDefaultFieldIds: [...DEFAULT_SETTINGS.kanbanCardDefaultFieldIds],
    kanbanCardFieldsByArea: { ...DEFAULT_SETTINGS.kanbanCardFieldsByArea },
    kanbanCardDefaultNextTaskCount: DEFAULT_SETTINGS.kanbanCardDefaultNextTaskCount,
    kanbanCardNextTaskCountByArea: { ...DEFAULT_SETTINGS.kanbanCardNextTaskCountByArea },
    kanbanNotesPreviewWords: DEFAULT_SETTINGS.kanbanNotesPreviewWords,
    kanbanNotesPreviewLines: DEFAULT_SETTINGS.kanbanNotesPreviewLines,
    enableTriStateCheckboxes: DEFAULT_SETTINGS.enableTriStateCheckboxes,
    defaultProjectStatuses: [...DEFAULT_SETTINGS.defaultProjectStatuses],
    kanbanHiddenStatuses: [...DEFAULT_SETTINGS.kanbanHiddenStatuses],
    savedViewsByArea: { ...DEFAULT_SETTINGS.savedViewsByArea },
    activeSavedViewIdsByArea: { ...DEFAULT_SETTINGS.activeSavedViewIdsByArea },
  };

  normalizer!: ProjectNormalizer;
  taskParser!: TaskParser;
  noteOpenService!: NoteOpenService;
  indexService!: ProjectIndexService;

  private persistTimer: number | null = null;
  private reconcileTimer: number | null = null;
  private intervalId: number | null = null;
  private readonly editorSyncInFlight = new Set<string>();
  private readonly previousEditorContentByPath = new Map<string, string>();

  async onload(): Promise<void> {
    const persisted = parsePersistedData(await this.loadData());
    this.settings = persisted.settings;
    const savedViewsInitialized = this.ensureSavedViewsInitialized();

    await this.ensureVaultPropertyTypes();

    this.normalizer = new ProjectNormalizer(this.app, () => this.settings);
    this.taskParser = new TaskParser(this.app);
    this.noteOpenService = new NoteOpenService(this.app, () => this.settings.openTarget);

    this.indexService = new ProjectIndexService(
      this.app,
      () => this.settings,
      this.normalizer,
      this.taskParser,
      () => this.schedulePersist(),
    );

    await this.indexService.initialize(persisted.snapshot);

    this.registerViews();
    this.registerCommands();
    this.registerVaultEvents();
    this.registerEditorEvents();
    this.registerEditorExtension(createTriStateLineDecorationExtension());
    this.registerEditorSuggest(new TaskEditorSuggest(this.app, () => this.settings, this.taskParser));
    this.seedActiveEditorContent();
    this.app.workspace.onLayoutReady(() => {
      void this.openStartupView();
    });
    this.addSettingTab(new ProjectNotesSettingTab(this.app, this));
    this.registerReconcileInterval();

    if (savedViewsInitialized) {
      await this.saveData({
        schemaVersion: 1,
        settings: this.settings,
        snapshot: persisted.snapshot,
      } satisfies PluginPersistedData);
    }
  }

  onunload(): void {
    if (this.persistTimer !== null) {
      window.clearTimeout(this.persistTimer);
      this.persistTimer = null;
      void this.persistNow();
    }

    if (this.reconcileTimer !== null) {
      window.clearTimeout(this.reconcileTimer);
      this.reconcileTimer = null;
    }

    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async saveSettings(
    options: { reconcile?: boolean; resetInterval?: boolean; syncPropertyTypes?: boolean } = {},
  ): Promise<void> {
    const shouldReconcile = options.reconcile ?? true;
    const resetInterval = options.resetInterval ?? false;
    const syncPropertyTypes = options.syncPropertyTypes ?? false;

    if (shouldReconcile) {
      this.scheduleReconcile();
    }

    if (resetInterval) {
      this.registerReconcileInterval();
    }

    if (syncPropertyTypes) {
      await this.ensureVaultPropertyTypes();
    }

    this.ensureSavedViewsInitialized();

    this.indexService.notifyExternalChange();
    this.schedulePersist();
  }

  async promptSaveView(currentName: string): Promise<SavedViewPromptResult | null> {
    return new Promise((resolve) => {
      const modal = new SaveViewModal(this.app, currentName, resolve);
      modal.open();
    });
  }

  async restoreDefaultSavedView(areaId: string, tab: SavedViewTab): Promise<void> {
    const area = this.settings.areas.find((candidate) => candidate.id === areaId);
    if (!area) {
      return;
    }

    appendRestoredDefaultView(this.settings, area, tab);
    await this.saveSettings({ reconcile: false });
  }

  openProjectNotesSettings(): void {
    const settingsApi = (
      this.app as unknown as {
        setting?: {
          open: () => void;
          openTabById?: (id: string) => void;
        };
      }
    ).setting;

    if (!settingsApi) {
      return;
    }

    settingsApi.open();
    settingsApi.openTabById?.(this.manifest.id);
  }

  private registerViews(): void {
    for (const definition of ALL_VIEW_DEFINITIONS) {
      this.registerView(definition.type, (leaf) => new ProjectNotesView(leaf, this, definition));
    }
  }

  private ensureSavedViewsInitialized(): boolean {
    let changed = false;
    for (const area of this.settings.areas) {
      if (ensureSavedViewsForArea(this.settings, area)) {
        changed = true;
      }
    }

    return changed;
  }

  private registerCommands(): void {
    this.addCommand({
      id: "open-project-notes",
      name: "Open Project Notes",
      callback: () => {
        const startupView = this.settings.startupView;
        const targetTab = startupView === "none" ? "projects" : startupView;
        void this.openProjectNotes(targetTab);
      },
    });

    this.addCommand({
      id: "create-project-note",
      name: "Create Project Note",
      callback: () => {
        void this.createProjectNote();
      },
    });

    this.addCommand({
      id: "create-project-note-task",
      name: "Create Project Note Task",
      callback: () => {
        void this.createProjectNoteTask();
      },
    });

    this.addCommand({
      id: "rebuild-project-index",
      name: "Rebuild Project Notes Index",
      callback: () => {
        void this.indexService.reconcileAllAreas({ normalize: true });
      },
    });

    this.addCommand({
      id: "backfill-missing-project-properties",
      name: "Backfill Missing Projet Properties",
      callback: () => {
        void this.backfillMissingProperties();
      },
    });
  }

  private registerVaultEvents(): void {
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (!isMarkdownFile(file)) {
          return;
        }

        void this.indexService.onFileCreated(file);
      }),
    );

    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (!isMarkdownFile(file)) {
          return;
        }

        void this.indexService.onFileModified(file);
      }),
    );

    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (!isMarkdownFile(file)) {
          return;
        }

        void this.indexService.onFileRenamed(file, oldPath);
      }),
    );

    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (!isMarkdownFile(file)) {
          return;
        }

        this.indexService.onFileDeleted(file.path);
      }),
    );

    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        if (!isMarkdownFile(file)) {
          return;
        }

        void this.indexService.onFileMetadataChanged(file);
      }),
    );
  }

  private registerEditorEvents(): void {
    this.registerEvent(
      this.app.workspace.on("editor-change", (editor, info) => {
        const file = info.file;
        if (!file || file.extension !== "md") {
          return;
        }

        if (this.editorSyncInFlight.has(file.path)) {
          return;
        }

        const area = resolveAreaForPath(this.settings.areas, file.path);
        if (!area) {
          this.previousEditorContentByPath.set(file.path, editor.getValue());
          return;
        }

        const currentContent = editor.getValue();
        const previousContent = this.previousEditorContentByPath.get(file.path) ?? currentContent;

        const triStateReconciled = this.taskParser.reconcileTriStateTransitionsInContent(
          previousContent,
          currentContent,
          this.settings.enableTriStateCheckboxes,
        );

        const completionReconciled = this.taskParser.reconcileCompletedDateMarkersInContent(triStateReconciled.content);
        const finalContent = completionReconciled.content;

        if (finalContent === currentContent) {
          this.previousEditorContentByPath.set(file.path, currentContent);
          return;
        }

        const selections = editor.listSelections();
        this.editorSyncInFlight.add(file.path);
        try {
          editor.setValue(finalContent);
          this.previousEditorContentByPath.set(file.path, finalContent);
          if (selections.length > 0) {
            try {
              editor.setSelections(selections);
            } catch (error) {
              // Ignore selection restore failures; the edit should still apply.
            }
          }
        } finally {
          window.setTimeout(() => {
            this.editorSyncInFlight.delete(file.path);
          }, 0);
        }
      }),
    );

    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (!file) {
          return;
        }

        const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (markdownView?.file?.path === file.path) {
          this.previousEditorContentByPath.set(file.path, markdownView.editor.getValue());
          return;
        }

        if (this.previousEditorContentByPath.has(file.path)) {
          return;
        }

        void this.app.vault.cachedRead(file).then((content) => {
          if (!this.previousEditorContentByPath.has(file.path)) {
            this.previousEditorContentByPath.set(file.path, content);
          }
        });
      }),
    );
  }

  private seedActiveEditorContent(): void {
    const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!markdownView?.file) {
      return;
    }

    this.previousEditorContentByPath.set(markdownView.file.path, markdownView.editor.getValue());
  }

  private registerReconcileInterval(): void {
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }

    const intervalMs = Math.max(1, this.settings.cacheReconcileMinutes) * 60_000;
    this.intervalId = window.setInterval(() => {
      void this.indexService.reconcileAllAreas({ normalize: false });
    }, intervalMs);

    this.registerInterval(this.intervalId);
  }

  private schedulePersist(): void {
    if (this.persistTimer !== null) {
      window.clearTimeout(this.persistTimer);
    }

    this.persistTimer = window.setTimeout(() => {
      this.persistTimer = null;
      void this.persistNow();
    }, 800);
  }

  private async persistNow(): Promise<void> {
    const payload: PluginPersistedData = {
      schemaVersion: 1,
      settings: this.settings,
      snapshot: this.indexService.createSnapshot(),
    };

    await this.saveData(payload);
  }

  private scheduleReconcile(): void {
    if (this.reconcileTimer !== null) {
      window.clearTimeout(this.reconcileTimer);
    }

    this.reconcileTimer = window.setTimeout(() => {
      this.reconcileTimer = null;
      void this.indexService.reconcileAllAreas({ normalize: true });
    }, 1000);
  }

  private async openStartupView(): Promise<void> {
    const startupView = this.settings.startupView;
    if (startupView === "none") {
      return;
    }

    await this.openProjectNotes(startupView);
  }

  private async openProjectNotes(tab: "projects" | "tasks" | "kanban"): Promise<void> {
    const targetType = tab === "kanban" ? VIEW_TYPES.kanban : VIEW_TYPES.grid;

    let leaf = this.app.workspace.getLeavesOfType(targetType)[0];
    if (!leaf) {
      leaf =
        this.app.workspace.getLeavesOfType(VIEW_TYPES.grid)[0] ??
        this.app.workspace.getLeavesOfType(VIEW_TYPES.kanban)[0] ??
        this.app.workspace.getLeaf("tab");
    }

    const existingState = leaf.getViewState().state;
    const state =
      existingState && typeof existingState === "object"
        ? { ...(existingState as Record<string, unknown>), gridTab: tab }
        : { gridTab: tab };

    await leaf.setViewState({
      type: targetType,
      active: true,
      state,
    });

    this.app.workspace.revealLeaf(leaf);
  }

  async createProjectNote(options: { areaId?: string | null; defaultStatus?: string } = {}): Promise<void> {
    if (this.settings.areas.length === 0) {
      new Notice("No Areas configured. Add one in plugin settings first.");
      return;
    }

    let area: AreaConfig | null = null;
    if (options.areaId) {
      area = this.settings.areas.find((candidate) => candidate.id === options.areaId) ?? null;
    }

    if (!area && this.settings.areas.length === 1) {
      area = this.settings.areas[0];
    }

    if (!area) {
      area = await this.promptAreaSelection();
    }

    if (!area) {
      return;
    }

    const filename = await this.promptProjectName();
    if (!filename) {
      return;
    }

    const normalizedFileName = filename.endsWith(".md") ? filename : `${filename}.md`;
    const path = `${area.folderPath}/${normalizedFileName}`;

    if (this.app.vault.getAbstractFileByPath(path)) {
      new Notice("A note with that name already exists.");
      return;
    }

    await this.ensureFolderExists(area.folderPath);
    const file = await this.app.vault.create(path, "");
    await this.indexService.onFileCreated(file);

    if (options.defaultStatus && options.defaultStatus.trim().length > 0) {
      await this.indexService.updateProjectMetadata({
        path: file.path,
        key: "status",
        value: options.defaultStatus,
      });
    }

    await this.noteOpenService.openProject(file.path);
    new Notice(`Created ${normalizedFileName}`);
  }

  async createProjectNoteTask(): Promise<void> {
    if (this.settings.areas.length === 0) {
      new Notice("No Areas configured. Add one in plugin settings first.");
      return;
    }

    let area: AreaConfig | null = null;
    if (this.settings.areas.length === 1) {
      area = this.settings.areas[0];
    } else {
      area = await this.promptAreaSelection();
    }

    if (!area) {
      return;
    }

    await this.createTaskInArea(area.id);
  }

  async createTaskInArea(areaId: string | null): Promise<void> {
    const projects = this.indexService.queryProjects({
      areaId,
      sortBy: "project",
      sortDirection: "asc",
    }).filter((project) => this.isTaskAssignableProjectStatus(project.status));

    if (projects.length === 0) {
      new Notice("No active projects available in this Area.");
      return;
    }

    const taskRequest = await this.promptTaskDetails(projects);
    if (!taskRequest) {
      return;
    }

    const changed = await this.indexService.addTask(taskRequest);
    if (!changed) {
      new Notice("Unable to add task to the selected project.");
      return;
    }

    new Notice("Task added.");
  }

  private isTaskAssignableProjectStatus(status: string): boolean {
    const normalized = status.trim().toLowerCase();
    return normalized !== "done" && normalized !== "cancelled" && normalized !== "canceled";
  }

  private async backfillMissingProperties(): Promise<void> {
    new Notice("Backfilling missing project properties...");
    await this.indexService.reconcileAllAreas({ normalize: true });
    new Notice("Backfill complete.");
  }

  private async promptAreaSelection(): Promise<AreaConfig | null> {
    return new Promise((resolve) => {
      const modal = new AreaSuggestModal(this.app, this.settings.areas, resolve);
      modal.open();
    });
  }

  private async promptProjectName(): Promise<string | null> {
    return new Promise((resolve) => {
      const modal = new ProjectNameModal(this.app, resolve);
      modal.open();
    });
  }

  private async promptTaskDetails(projects: ProjectNote[]): Promise<AddTaskRequest | null> {
    return new Promise((resolve) => {
      const modal = new AddTaskModal(this.app, projects, resolve);
      modal.open();
    });
  }

  private async ensureFolderExists(folderPath: string): Promise<void> {
    const segments = folderPath.split("/").filter((segment) => segment.length > 0);
    let current = "";

    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      if (this.app.vault.getAbstractFileByPath(current)) {
        continue;
      }
      await this.app.vault.createFolder(current);
    }
  }

  private async ensureVaultPropertyTypes(): Promise<void> {
    const adapter = this.app.vault.adapter;
    const typesPath = `${this.app.vault.configDir}/types.json`;

    let existing: Record<string, unknown> = {};
    if (await adapter.exists(typesPath)) {
      try {
        existing = JSON.parse(await adapter.read(typesPath)) as Record<string, unknown>;
      } catch (error) {
        existing = {};
      }
    }

    const currentTypes = (existing.types as Record<string, string> | undefined) ?? {};
    const mergedTypes: Record<string, string> = { ...currentTypes };
    let changed = false;
    const configuredTypes = buildConfiguredPropertyTypeMap(this.settings);

    for (const [key, value] of Object.entries(configuredTypes)) {
      if (mergedTypes[key] === value) {
        continue;
      }
      mergedTypes[key] = value;
      changed = true;
    }

    if (!changed) {
      return;
    }

    const nextPayload = {
      ...existing,
      types: mergedTypes,
    };

    await adapter.write(typesPath, `${JSON.stringify(nextPayload, null, 2)}\n`);
  }
}
