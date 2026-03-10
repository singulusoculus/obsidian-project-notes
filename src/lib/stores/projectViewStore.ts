import { get, writable, type Writable } from "svelte/store";
import { FILTER_NONE_TOKEN, KANBAN_CARD_BASE_FIELDS, PROJECT_GRID_BASE_COLUMNS } from "../constants";
import type {
  BoardType,
  KanbanCardField,
  ProjectGridColumn,
  ProjectMetadataUpdate,
  ProjectSettings,
  ProjectSortField,
  TaskDateField,
  TaskState,
  ProjectViewState,
  SortDirection,
  ViewVariant,
} from "../types";
import type { ProjectIndexService } from "../services/projectIndexService";
import type { NoteOpenService } from "../services/noteOpenService";
import { canonicalPropertyName, resolveAreaPropertyTemplates } from "../utils/properties";

interface Dependencies {
  indexService: ProjectIndexService;
  noteOpenService: NoteOpenService;
  openSettings: () => void;
  createProject: () => Promise<void>;
  createProjectInAreaWithStatus: (areaId: string | null, status: string) => Promise<void>;
  createTask: (areaId: string | null) => Promise<void>;
  getSettings: () => ProjectSettings;
  persistSettings: () => Promise<void>;
  boardType: BoardType;
  variant: ViewVariant;
  initialAreaId?: string | null;
  initialGridTab?: "projects" | "tasks" | "kanban";
}

const RESERVED_PROJECT_COLUMN_PROPERTY_KEYS = new Set<string>([
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

export class ProjectViewStore {
  readonly state: Writable<ProjectViewState>;

  private readonly indexService: ProjectIndexService;
  private readonly noteOpenService: NoteOpenService;
  private readonly openSettingsAction: () => void;
  private readonly createProject: () => Promise<void>;
  private readonly createProjectInAreaWithStatus: (areaId: string | null, status: string) => Promise<void>;
  private readonly createTask: (areaId: string | null) => Promise<void>;
  private readonly getSettings: () => ProjectSettings;
  private readonly persistSettings: () => Promise<void>;
  private unsubscribeIndex: (() => void) | null = null;

  constructor(dependencies: Dependencies) {
    this.indexService = dependencies.indexService;
    this.noteOpenService = dependencies.noteOpenService;
    this.openSettingsAction = dependencies.openSettings;
    this.createProject = dependencies.createProject;
    this.createProjectInAreaWithStatus = dependencies.createProjectInAreaWithStatus;
    this.createTask = dependencies.createTask;
    this.getSettings = dependencies.getSettings;
    this.persistSettings = dependencies.persistSettings;

    const settings = this.getSettings();
    const initialArea = this.resolveInitialAreaId(dependencies.initialAreaId, settings);
    const initialAreaConfig = settings.areas.find((area) => area.id === initialArea) ?? null;
    const initialGridColumns = this.resolveGridColumns(settings, initialArea, initialAreaConfig);
    const initialKanbanCardFields = this.resolveKanbanCardFields(settings, initialArea, initialAreaConfig);
    const initialKanbanNextTaskCount = this.resolveKanbanNextTaskCount(settings, initialArea);
    const initialGridTab = this.resolveInitialGridTab(dependencies.initialGridTab, dependencies.boardType);

    this.state = writable<ProjectViewState>({
      areas: settings.areas,
      currentAreaId: initialArea,
      statuses: this.indexService.getStatusesForArea(initialArea),
      priorities: this.indexService.getPrioritiesForArea(initialArea),
      boardType: dependencies.boardType,
      variant: dependencies.variant,
      gridTab: initialGridTab,
      projectSearch: "",
      taskSearch: "",
      statusFilter: settings.defaultProjectStatuses,
      priorityFilter: [],
      areaTagFilter: [],
      availableAreaTags: [],
      availableProjectGridColumns: initialGridColumns.available,
      projectGridColumns: initialGridColumns.visible,
      availableKanbanCardFields: initialKanbanCardFields.available,
      kanbanCardFields: initialKanbanCardFields.visible,
      kanbanNextTaskCount: initialKanbanNextTaskCount,
      kanbanNotesPreviewWords: settings.kanbanNotesPreviewWords,
      kanbanNotesPreviewLines: settings.kanbanNotesPreviewLines,
      sortBy: settings.defaultSortBy,
      sortDirection: settings.defaultSortDirection,
      projects: [],
      projectStatusByPath: {},
      tasks: [],
      triStateCheckboxes: settings.enableTriStateCheckboxes,
      hiddenKanbanStatuses: settings.kanbanHiddenStatuses,
      showHiddenKanban: false,
    });

    this.unsubscribeIndex = this.indexService.subscribe(() => {
      this.refresh();
    });

    this.refresh();
  }

  destroy(): void {
    this.unsubscribeIndex?.();
    this.unsubscribeIndex = null;
  }

  refresh(): void {
    this.state.update((current) => {
      const settings = this.getSettings();
      const currentAreaId = this.resolveInitialAreaId(current.currentAreaId, settings);

      const statuses = this.indexService.getStatusesForArea(currentAreaId);
      const priorities = this.indexService.getPrioritiesForArea(currentAreaId);
      const currentArea = settings.areas.find((area) => area.id === currentAreaId) ?? null;
      const areaTagPrefix = currentArea ? `area/${currentArea.slug}` : null;
      const gridColumns = this.resolveGridColumns(settings, currentAreaId, currentArea);
      const kanbanCardFields = this.resolveKanbanCardFields(settings, currentAreaId, currentArea);
      const kanbanNextTaskCount = this.resolveKanbanNextTaskCount(settings, currentAreaId);

      const statusFilter = current.statusFilter.filter(
        (status) => statuses.includes(status) || status === "Unknown" || status === FILTER_NONE_TOKEN,
      );
      const priorityFilter = current.priorityFilter.filter(
        (priority) => priorities.includes(priority) || priority === FILTER_NONE_TOKEN,
      );

      const allAreaProjects = this.indexService.queryProjects({ areaId: currentAreaId });
      const projectStatusByPath = allAreaProjects.reduce<Record<string, string>>((acc, project) => {
        acc[project.path] = project.status;
        return acc;
      }, {});
      const availableAreaTags = Array.from(
        new Set(
          allAreaProjects
            .flatMap((project) => project.tags)
            .filter((tag) => (areaTagPrefix ? tag.startsWith(areaTagPrefix) : true)),
        ),
      ).sort((left, right) => left.localeCompare(right));

      const areaTagFilter = current.areaTagFilter.filter((tag) => availableAreaTags.includes(tag));

      const projects = this.indexService.queryProjects({
        areaId: currentAreaId,
        search: current.projectSearch,
        statuses:
          current.gridTab !== "kanban" && statusFilter.length > 0
            ? statusFilter
            : undefined,
        priorities: priorityFilter.length > 0 ? priorityFilter : undefined,
        areaTags: areaTagFilter.length > 0 ? areaTagFilter : undefined,
        sortBy: current.sortBy,
        sortDirection: current.sortDirection,
      });

      const tasks = this.indexService.queryTasks({
        areaId: currentAreaId,
        search: current.taskSearch,
        includeCompleted: true,
        sortBy: "due-date",
        sortDirection: "asc",
      });

      return {
        ...current,
        areas: settings.areas,
        currentAreaId,
        statuses,
        priorities,
        statusFilter,
        priorityFilter,
        areaTagFilter,
        availableAreaTags,
        availableProjectGridColumns: gridColumns.available,
        projectGridColumns: gridColumns.visible,
        availableKanbanCardFields: kanbanCardFields.available,
        kanbanCardFields: kanbanCardFields.visible,
        kanbanNextTaskCount,
        kanbanNotesPreviewWords: settings.kanbanNotesPreviewWords,
        kanbanNotesPreviewLines: settings.kanbanNotesPreviewLines,
        hiddenKanbanStatuses: settings.kanbanHiddenStatuses,
        triStateCheckboxes: settings.enableTriStateCheckboxes,
        projects,
        projectStatusByPath,
        tasks,
      };
    });
  }

  setArea(areaId: string): void {
    this.state.update((current) => ({ ...current, currentAreaId: areaId }));
    this.refresh();
  }

  setGridTab(tab: "projects" | "tasks" | "kanban"): void {
    this.state.update((current) => ({ ...current, gridTab: tab }));
    this.refresh();
  }

  setProjectSearch(search: string): void {
    this.state.update((current) => ({ ...current, projectSearch: search }));
    this.refresh();
  }

  setTaskSearch(search: string): void {
    this.state.update((current) => ({ ...current, taskSearch: search }));
    this.refresh();
  }

  toggleStatusFilter(status: string): void {
    this.state.update((current) => {
      const existing = new Set(current.statusFilter);
      if (existing.has(status)) {
        existing.delete(status);
      } else {
        existing.add(status);
      }

      return {
        ...current,
        statusFilter: Array.from(existing),
      };
    });
    this.refresh();
  }

  setStatusFilter(statuses: string[]): void {
    this.state.update((current) => ({
      ...current,
      statusFilter: Array.from(new Set(statuses)),
    }));
    this.refresh();
  }

  clearStatusFilter(): void {
    this.state.update((current) => ({ ...current, statusFilter: [] }));
    this.refresh();
  }

  togglePriorityFilter(priority: string): void {
    this.state.update((current) => {
      const existing = new Set(current.priorityFilter);
      if (existing.has(priority)) {
        existing.delete(priority);
      } else {
        existing.add(priority);
      }

      return {
        ...current,
        priorityFilter: Array.from(existing),
      };
    });
    this.refresh();
  }

  setPriorityFilter(priorities: string[]): void {
    this.state.update((current) => ({
      ...current,
      priorityFilter: Array.from(new Set(priorities)),
    }));
    this.refresh();
  }

  clearPriorityFilter(): void {
    this.state.update((current) => ({ ...current, priorityFilter: [] }));
    this.refresh();
  }

  toggleAreaTagFilter(tag: string): void {
    this.state.update((current) => {
      const existing = new Set(current.areaTagFilter);
      if (existing.has(tag)) {
        existing.delete(tag);
      } else {
        existing.add(tag);
      }

      return {
        ...current,
        areaTagFilter: Array.from(existing),
      };
    });
    this.refresh();
  }

  clearAreaTagFilter(): void {
    this.state.update((current) => ({ ...current, areaTagFilter: [] }));
    this.refresh();
  }

  setSort(sortBy: ProjectSortField, sortDirection: SortDirection): void {
    this.state.update((current) => ({ ...current, sortBy, sortDirection }));
    this.refresh();
  }

  toggleShowHiddenKanban(): void {
    this.state.update((current) => ({ ...current, showHiddenKanban: !current.showHiddenKanban }));
  }

  async setKanbanHiddenStatuses(statuses: string[]): Promise<void> {
    const settings = this.getSettings();
    settings.kanbanHiddenStatuses = Array.from(new Set(statuses));
    await this.persistSettings();
    this.refresh();
  }

  async openProject(path: string): Promise<void> {
    await this.noteOpenService.openProject(path);
  }

  async openProjectLink(linkText: string, sourcePath?: string): Promise<void> {
    await this.noteOpenService.openProjectLink(linkText, sourcePath);
  }

  async openProjectTask(path: string, lineNumber: number): Promise<void> {
    await this.noteOpenService.openProjectTask(path, lineNumber);
  }

  openPluginSettings(): void {
    this.openSettingsAction();
  }

  async updateProject(update: ProjectMetadataUpdate): Promise<void> {
    await this.indexService.updateProjectMetadata(update);
  }

  async createProjectNote(): Promise<void> {
    await this.createProject();
  }

  async createProjectNoteInCurrentAreaWithStatus(status: string): Promise<void> {
    const areaId = get(this.state).currentAreaId;
    await this.createProjectInAreaWithStatus(areaId, status);
  }

  async createTaskInCurrentArea(): Promise<void> {
    const areaId = get(this.state).currentAreaId;
    await this.createTask(areaId);
  }

  async setTaskState(taskId: string, state: TaskState): Promise<void> {
    await this.indexService.toggleTask({ taskId, state });
  }

  async setTaskDate(taskId: string, field: TaskDateField, value: string | null): Promise<void> {
    await this.indexService.updateTaskDate({ taskId, field, value });
  }

  async setProjectGridColumns(columnIds: string[]): Promise<void> {
    const current = get(this.state);
    const areaId = current.currentAreaId;
    if (!areaId) {
      return;
    }

    const visibleIds = this.normalizeVisibleColumnIds(columnIds, current.availableProjectGridColumns);
    const settings = this.getSettings();
    settings.gridColumnsByArea[areaId] = visibleIds;
    await this.persistSettings();
    this.refresh();
  }

  async setKanbanCardFields(fieldIds: string[]): Promise<void> {
    const current = get(this.state);
    const areaId = current.currentAreaId;
    const normalized = this.normalizeKanbanCardFieldIds(fieldIds, current.availableKanbanCardFields);
    const settings = this.getSettings();

    if (areaId) {
      settings.kanbanCardFieldsByArea[areaId] = normalized;
    } else {
      settings.kanbanCardDefaultFieldIds = normalized;
    }

    await this.persistSettings();
    this.refresh();
  }

  async setKanbanNextTaskCount(count: number): Promise<void> {
    const normalized = this.normalizeKanbanNextTaskCount(count);
    const current = get(this.state);
    const areaId = current.currentAreaId;
    const settings = this.getSettings();

    if (areaId) {
      settings.kanbanCardNextTaskCountByArea[areaId] = normalized;
    } else {
      settings.kanbanCardDefaultNextTaskCount = normalized;
    }

    await this.persistSettings();
    this.refresh();
  }

  private resolveInitialAreaId(areaId: string | null | undefined, settings: ProjectSettings): string | null {
    if (areaId && settings.areas.some((area) => area.id === areaId)) {
      return areaId;
    }

    return settings.areas[0]?.id ?? null;
  }

  private resolveInitialGridTab(
    gridTab: "projects" | "tasks" | "kanban" | undefined,
    boardType: BoardType,
  ): "projects" | "tasks" | "kanban" {
    if (gridTab === "projects" || gridTab === "tasks" || gridTab === "kanban") {
      return gridTab;
    }

    return boardType === "kanban" ? "kanban" : "projects";
  }

  private resolveGridColumns(
    settings: ProjectSettings,
    areaId: string | null,
    area: ProjectSettings["areas"][number] | null,
  ): { available: ProjectGridColumn[]; visible: ProjectGridColumn[] } {
    const available = this.buildAvailableGridColumns(settings, area);
    if (!areaId) {
      return {
        available,
        visible: available,
      };
    }

    const saved = settings.gridColumnsByArea[areaId];
    const availableById = new Map(available.map((column) => [column.id, column]));

    const visibleIds =
      Array.isArray(saved) && saved.length > 0
        ? this.normalizeVisibleColumnIds(saved, available)
        : this.normalizeVisibleColumnIds(
            available.map((column) => column.id),
            available,
          );

    const visible = visibleIds
      .map((id) => availableById.get(id))
      .filter((column): column is ProjectGridColumn => column !== undefined);

    return {
      available,
      visible,
    };
  }

  private resolveKanbanCardFields(
    settings: ProjectSettings,
    areaId: string | null,
    area: ProjectSettings["areas"][number] | null,
  ): { available: KanbanCardField[]; visible: KanbanCardField[] } {
    const available = this.buildAvailableKanbanCardFields(settings, area);
    const sourceIds =
      areaId && settings.kanbanCardFieldsByArea[areaId] && settings.kanbanCardFieldsByArea[areaId].length > 0
        ? settings.kanbanCardFieldsByArea[areaId]
        : settings.kanbanCardDefaultFieldIds;
    const visibleIds = this.normalizeKanbanCardFieldIds(sourceIds, available);
    const availableById = new Map(available.map((field) => [field.id, field]));
    const visible = visibleIds
      .map((id) => availableById.get(id))
      .filter((field): field is KanbanCardField => field !== undefined);

    return {
      available,
      visible,
    };
  }

  private resolveKanbanNextTaskCount(settings: ProjectSettings, areaId: string | null): number {
    if (!areaId) {
      return this.normalizeKanbanNextTaskCount(settings.kanbanCardDefaultNextTaskCount);
    }

    const override = settings.kanbanCardNextTaskCountByArea[areaId];
    if (typeof override === "number" && Number.isFinite(override) && override >= 1) {
      return this.normalizeKanbanNextTaskCount(override);
    }

    return this.normalizeKanbanNextTaskCount(settings.kanbanCardDefaultNextTaskCount);
  }

  private buildAvailableKanbanCardFields(
    settings: ProjectSettings,
    area: ProjectSettings["areas"][number] | null,
  ): KanbanCardField[] {
    const fields: KanbanCardField[] = KANBAN_CARD_BASE_FIELDS.map((field) => ({ ...field }));
    const seen = new Set(fields.map((field) => field.id));

    for (const template of resolveAreaPropertyTemplates(settings, area)) {
      const key = canonicalPropertyName(template.name);
      if (RESERVED_PROJECT_COLUMN_PROPERTY_KEYS.has(key)) {
        continue;
      }

      const id = `property:${key}`;
      if (seen.has(id)) {
        continue;
      }

      fields.push({
        id,
        label: template.name,
        kind: "property",
        propertyKey: key,
      });
      seen.add(id);
    }

    return fields;
  }

  private buildAvailableGridColumns(
    settings: ProjectSettings,
    area: ProjectSettings["areas"][number] | null,
  ): ProjectGridColumn[] {
    const columns: ProjectGridColumn[] = PROJECT_GRID_BASE_COLUMNS.map((column) => ({ ...column }));
    const seen = new Set(columns.map((column) => column.id));

    for (const template of resolveAreaPropertyTemplates(settings, area)) {
      const key = canonicalPropertyName(template.name);
      if (RESERVED_PROJECT_COLUMN_PROPERTY_KEYS.has(key)) {
        continue;
      }

      const id = `property:${key}`;
      if (seen.has(id)) {
        continue;
      }

      columns.push({
        id,
        label: template.name,
        kind: "property",
        sortable: false,
        propertyKey: key,
      });
      seen.add(id);
    }

    return columns;
  }

  private normalizeVisibleColumnIds(columnIds: string[], availableColumns: ProjectGridColumn[]): string[] {
    const availableIds = new Set(availableColumns.map((column) => column.id));
    const deduped: string[] = [];
    for (const id of columnIds) {
      if (!availableIds.has(id)) {
        continue;
      }
      if (deduped.includes(id)) {
        continue;
      }
      deduped.push(id);
    }

    if (!deduped.includes("project") && availableIds.has("project")) {
      deduped.unshift("project");
    }

    return deduped;
  }

  private normalizeKanbanCardFieldIds(fieldIds: string[], availableFields: KanbanCardField[]): string[] {
    const availableIds = new Set(availableFields.map((field) => field.id));
    const deduped: string[] = [];
    for (const id of fieldIds) {
      if (!availableIds.has(id)) {
        continue;
      }
      if (deduped.includes(id)) {
        continue;
      }
      deduped.push(id);
    }

    if (!deduped.includes("name") && availableIds.has("name")) {
      deduped.unshift("name");
    }

    return deduped;
  }

  private normalizeKanbanNextTaskCount(value: number): number {
    if (!Number.isFinite(value)) {
      return 1;
    }

    return Math.max(1, Math.floor(value));
  }
}
