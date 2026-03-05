import {
  App,
  FuzzySuggestModal,
  ItemView,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TAbstractFile,
  TFile,
  TextComponent,
  type WorkspaceLeaf,
} from "obsidian";
import { mount, unmount } from "svelte";
import ProjectBoard from "./src/components/ProjectBoard.svelte";
import { DEFAULT_SETTINGS, REQUIRED_PROPERTY_TYPES, VIEW_TYPES } from "./src/lib/constants";
import { NoteOpenService } from "./src/lib/services/noteOpenService";
import { ProjectIndexService } from "./src/lib/services/projectIndexService";
import { ProjectNormalizer } from "./src/lib/services/projectNormalizer";
import { TaskParser } from "./src/lib/services/taskParser";
import { parsePersistedData } from "./src/lib/settings";
import { ProjectViewStore } from "./src/lib/stores/projectViewStore";
import type {
  AddTaskRequest,
  AreaConfig,
  BoardType,
  OpenTarget,
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

const VIEW_DEFINITIONS: ViewDefinition[] = [
  {
    type: VIEW_TYPES.customGrid,
    displayText: "Project Notes Grid (Custom)",
    boardType: "grid",
    variant: "custom",
  },
  {
    type: VIEW_TYPES.customKanban,
    displayText: "Project Notes Kanban (Custom)",
    boardType: "kanban",
    variant: "custom",
  },
  {
    type: VIEW_TYPES.basesGrid,
    displayText: "Project Notes Grid (Bases)",
    boardType: "grid",
    variant: "bases",
  },
  {
    type: VIEW_TYPES.basesKanban,
    displayText: "Project Notes Kanban (Bases)",
    boardType: "kanban",
    variant: "bases",
  },
];

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

    this.viewStore = new ProjectViewStore({
      indexService: this.plugin.indexService,
      noteOpenService: this.plugin.noteOpenService,
      createProject: () => this.plugin.createProjectNote(),
      createTask: (areaId) => this.plugin.createTaskInArea(areaId),
      getSettings: () => this.plugin.settings,
      boardType: definition.boardType,
      variant: definition.variant,
      initialAreaId: areaId,
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

  private getResolvedDefinition(): ViewDefinition {
    if (this.definition) {
      return this.definition;
    }

    const typeFromLeaf = this.leaf?.getViewState()?.type;
    if (typeFromLeaf) {
      const match = VIEW_DEFINITIONS.find((candidate) => candidate.type === typeFromLeaf);
      if (match) {
        return match;
      }
    }

    return VIEW_DEFINITIONS[0];
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

    contentEl.createEl("h3", { text: "Create Project Note" });

    const inputWrapper = contentEl.createDiv({ cls: "opn-modal-field" });
    inputWrapper.createEl("label", { text: "Filename", attr: { for: "opn-project-filename" } });

    this.inputComponent = new TextComponent(inputWrapper);
    this.inputComponent.inputEl.id = "opn-project-filename";
    this.inputComponent.inputEl.setAttribute("aria-label", "Project note filename");
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

class AddTaskModal extends Modal {
  private readonly projects: ProjectNote[];
  private readonly resolve: (value: AddTaskRequest | null) => void;
  private selectedProjectPath: string;
  private taskInput: TextComponent | null = null;
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

    contentEl.createEl("h3", { text: "Add Task" });

    const projectWrapper = contentEl.createDiv({ cls: "opn-modal-field" });
    projectWrapper.createEl("label", { text: "Project", attr: { for: "opn-task-project" } });
    const projectSelect = projectWrapper.createEl("select", { attr: { id: "opn-task-project", "aria-label": "Project" } });
    for (const project of this.projects) {
      projectSelect.createEl("option", {
        text: project.customName || project.title,
        attr: { value: project.path },
      });
    }
    projectSelect.value = this.selectedProjectPath;
    projectSelect.addEventListener("change", (event) => {
      this.selectedProjectPath = (event.currentTarget as HTMLSelectElement).value;
    });

    const taskWrapper = contentEl.createDiv({ cls: "opn-modal-field" });
    taskWrapper.createEl("label", { text: "Task", attr: { for: "opn-task-text" } });
    this.taskInput = new TextComponent(taskWrapper);
    this.taskInput.inputEl.id = "opn-task-text";
    this.taskInput.inputEl.setAttribute("aria-label", "Task text");
    this.taskInput.setPlaceholder("Task description");

    const startWrapper = contentEl.createDiv({ cls: "opn-modal-field" });
    startWrapper.createEl("label", { text: "Start Date", attr: { for: "opn-task-start-date" } });
    this.startDateInput = startWrapper.createEl("input", {
      attr: {
        id: "opn-task-start-date",
        type: "date",
        value: todayIsoDate(),
        "aria-label": "Task start date",
      },
    });

    const dueWrapper = contentEl.createDiv({ cls: "opn-modal-field" });
    dueWrapper.createEl("label", { text: "Due Date", attr: { for: "opn-task-due-date" } });
    this.dueDateInput = dueWrapper.createEl("input", {
      attr: {
        id: "opn-task-due-date",
        type: "date",
        "aria-label": "Task due date",
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

      const startDate = this.startDateInput?.value.trim() ?? "";
      if (!isIsoDate(startDate)) {
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
    if (!this.submitted) {
      this.resolve(null);
    }
  }
}

class ProjectNotesSettingTab extends PluginSettingTab {
  private readonly plugin: ObsidianProjectNotesPlugin;

  constructor(app: App, plugin: ObsidianProjectNotesPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Obsidian Project Notes" });

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
          .addOption("custom-name", "Custom Name")
          .addOption("status", "Status")
          .addOption("priority", "Priority")
          .addOption("start-date", "Start Date")
          .addOption("finish-date", "Finish Date")
          .addOption("due-date", "Due Date")
          .addOption("tags", "Tags")
          .addOption("parent-project", "Parent Project")
          .addOption("requester", "Requester")
          .addOption("created-at", "Created At")
          .addOption("updated-at", "Updated At")
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

    containerEl.createEl("h3", { text: "Areas" });

    for (const area of this.plugin.settings.areas) {
      const areaContainer = containerEl.createDiv({ cls: "opn-area-setting" });
      const areaTitleEl = areaContainer.createEl("h4", { text: area.name || "Unnamed Area" });

      new Setting(areaContainer)
        .setName("Area Name")
        .addText((text) => {
          text.setValue(area.name).onChange(async (value) => {
            area.name = value;
            area.slug = slugifyAreaName(value);
            areaTitleEl.setText(value.trim().length > 0 ? value.trim() : "Unnamed Area");
            await this.plugin.saveSettings();
          });
        });

      new Setting(areaContainer)
        .setName("Folder Path")
        .setDesc("Path inside vault, e.g. Projects/Client-A")
        .addText((text) => {
          text.setValue(area.folderPath).onChange(async (value) => {
            area.folderPath = value.replace(/^\/+|\/+$/g, "");
            await this.plugin.saveSettings();
          });
        });

      new Setting(areaContainer)
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

      new Setting(areaContainer)
        .setName("Status overrides")
        .setDesc("Optional comma-separated list. Empty means use global statuses.")
        .addText((text) => {
          text.setValue((area.statusOverrides ?? []).join(", ")).onChange(async (value) => {
            const parsed = parseCsv(value);
            area.statusOverrides = parsed.length > 0 ? parsed : undefined;
            await this.plugin.saveSettings({ reconcile: false });
          });
        });

      new Setting(areaContainer)
        .setName("Priority overrides")
        .setDesc("Optional comma-separated list. Empty means use global priorities.")
        .addText((text) => {
          text.setValue((area.priorityOverrides ?? []).join(", ")).onChange(async (value) => {
            const parsed = parseCsv(value);
            area.priorityOverrides = parsed.length > 0 ? parsed : undefined;
            await this.plugin.saveSettings({ reconcile: false });
          });
        });

      new Setting(areaContainer)
        .setName("Remove Area")
        .addButton((button) => {
          button
            .setButtonText("Remove")
            .setWarning()
            .onClick(async () => {
              this.plugin.settings.areas = this.plugin.settings.areas.filter((candidate) => candidate.id !== area.id);
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
            this.plugin.settings.areas.push({
              id: `area-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              name: "",
              slug: "",
              folderPath: "",
              includeMode: "recursive",
            });
            await this.plugin.saveSettings({ reconcile: false });
            this.display();
          });
      });
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
    defaultProjectStatuses: [...DEFAULT_SETTINGS.defaultProjectStatuses],
    kanbanHiddenStatuses: [...DEFAULT_SETTINGS.kanbanHiddenStatuses],
  };

  normalizer!: ProjectNormalizer;
  taskParser!: TaskParser;
  noteOpenService!: NoteOpenService;
  indexService!: ProjectIndexService;

  private persistTimer: number | null = null;
  private reconcileTimer: number | null = null;
  private intervalId: number | null = null;

  async onload(): Promise<void> {
    const persisted = parsePersistedData(await this.loadData());
    this.settings = persisted.settings;

    await this.ensureVaultPropertyTypes();

    this.normalizer = new ProjectNormalizer(this.app);
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
    this.addSettingTab(new ProjectNotesSettingTab(this.app, this));
    this.registerReconcileInterval();
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

  async saveSettings(options: { reconcile?: boolean; resetInterval?: boolean } = {}): Promise<void> {
    const shouldReconcile = options.reconcile ?? true;
    const resetInterval = options.resetInterval ?? false;

    if (shouldReconcile) {
      this.scheduleReconcile();
    }

    if (resetInterval) {
      this.registerReconcileInterval();
    }

    this.indexService.notifyExternalChange();
    this.schedulePersist();
  }

  private registerViews(): void {
    for (const definition of VIEW_DEFINITIONS) {
      this.registerView(definition.type, (leaf) => new ProjectNotesView(leaf, this, definition));
    }
  }

  private registerCommands(): void {
    for (const definition of VIEW_DEFINITIONS) {
      this.addCommand({
        id: `open-${definition.type}`,
        name: definition.displayText,
        callback: () => {
          void this.activateView(definition.type);
        },
      });
    }

    this.addCommand({
      id: "create-project-note",
      name: "Create Project Note",
      callback: () => {
        void this.createProjectNote();
      },
    });

    this.addCommand({
      id: "rebuild-project-index",
      name: "Rebuild Project Notes Index",
      callback: () => {
        void this.indexService.reconcileAllAreas({ normalize: true });
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

  private async activateView(type: string): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(type)[0];

    if (!leaf) {
      leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({
        type,
        active: true,
      });
    } else {
      await leaf.setViewState({
        type,
        active: true,
      });
    }

    this.app.workspace.revealLeaf(leaf);
  }

  async createProjectNote(): Promise<void> {
    if (this.settings.areas.length === 0) {
      new Notice("No Areas configured. Add one in plugin settings first.");
      return;
    }

    const area = await this.promptAreaSelection();
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
    await this.noteOpenService.openProject(file.path);
    new Notice(`Created ${normalizedFileName}`);
  }

  async createTaskInArea(areaId: string | null): Promise<void> {
    const projects = this.indexService.queryProjects({
      areaId,
      sortBy: "project",
      sortDirection: "asc",
    });

    if (projects.length === 0) {
      new Notice("No projects available in this Area.");
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

    for (const [key, value] of Object.entries(REQUIRED_PROPERTY_TYPES)) {
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
