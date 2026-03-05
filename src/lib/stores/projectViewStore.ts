import { get, writable, type Writable } from "svelte/store";
import { PROJECT_GRID_BASE_COLUMNS } from "../constants";
import type {
  BoardType,
  ProjectGridColumn,
  ProjectMetadataUpdate,
  ProjectSettings,
  ProjectSortField,
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
  createProject: () => Promise<void>;
  createTask: (areaId: string | null) => Promise<void>;
  getSettings: () => ProjectSettings;
  persistSettings: () => Promise<void>;
  boardType: BoardType;
  variant: ViewVariant;
  initialAreaId?: string | null;
}

const RESERVED_PROJECT_COLUMN_PROPERTY_KEYS = new Set<string>([
  "aliases",
  "status",
  "priority",
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
  private readonly createProject: () => Promise<void>;
  private readonly createTask: (areaId: string | null) => Promise<void>;
  private readonly getSettings: () => ProjectSettings;
  private readonly persistSettings: () => Promise<void>;
  private unsubscribeIndex: (() => void) | null = null;

  constructor(dependencies: Dependencies) {
    this.indexService = dependencies.indexService;
    this.noteOpenService = dependencies.noteOpenService;
    this.createProject = dependencies.createProject;
    this.createTask = dependencies.createTask;
    this.getSettings = dependencies.getSettings;
    this.persistSettings = dependencies.persistSettings;

    const settings = this.getSettings();
    const initialArea = this.resolveInitialAreaId(dependencies.initialAreaId, settings);
    const initialAreaConfig = settings.areas.find((area) => area.id === initialArea) ?? null;
    const initialGridColumns = this.resolveGridColumns(settings, initialArea, initialAreaConfig);

    this.state = writable<ProjectViewState>({
      areas: settings.areas,
      currentAreaId: initialArea,
      statuses: this.indexService.getStatusesForArea(initialArea),
      priorities: this.indexService.getPrioritiesForArea(initialArea),
      boardType: dependencies.boardType,
      variant: dependencies.variant,
      gridTab: "projects",
      projectSearch: "",
      taskSearch: "",
      statusFilter: settings.defaultProjectStatuses,
      priorityFilter: [],
      areaTagFilter: [],
      availableAreaTags: [],
      availableProjectGridColumns: initialGridColumns.available,
      projectGridColumns: initialGridColumns.visible,
      sortBy: settings.defaultSortBy,
      sortDirection: settings.defaultSortDirection,
      projects: [],
      tasks: [],
      showCompletedTasksInTaskView: false,
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

      const statusFilter = current.statusFilter.filter((status) => statuses.includes(status) || status === "Unknown");
      const priorityFilter = current.priorityFilter.filter((priority) => priorities.includes(priority));

      const allAreaProjects = this.indexService.queryProjects({ areaId: currentAreaId });
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
          current.boardType === "grid" && statusFilter.length > 0
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
        includeCompleted: current.showCompletedTasksInTaskView,
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
        hiddenKanbanStatuses: settings.kanbanHiddenStatuses,
        triStateCheckboxes: settings.enableTriStateCheckboxes,
        projects,
        tasks,
      };
    });
  }

  setArea(areaId: string): void {
    this.state.update((current) => ({ ...current, currentAreaId: areaId }));
    this.refresh();
  }

  setGridTab(tab: "projects" | "tasks"): void {
    this.state.update((current) => ({ ...current, gridTab: tab }));
  }

  setProjectSearch(search: string): void {
    this.state.update((current) => ({ ...current, projectSearch: search }));
    this.refresh();
  }

  setTaskSearch(search: string): void {
    this.state.update((current) => ({ ...current, taskSearch: search }));
    this.refresh();
  }

  toggleTaskViewCompletedVisibility(): void {
    this.state.update((current) => ({
      ...current,
      showCompletedTasksInTaskView: !current.showCompletedTasksInTaskView,
    }));
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

  async openProject(path: string): Promise<void> {
    await this.noteOpenService.openProject(path);
  }

  async updateProject(update: ProjectMetadataUpdate): Promise<void> {
    await this.indexService.updateProjectMetadata(update);
  }

  async createProjectNote(): Promise<void> {
    await this.createProject();
  }

  async createTaskInCurrentArea(): Promise<void> {
    const areaId = get(this.state).currentAreaId;
    await this.createTask(areaId);
  }

  async setTaskState(taskId: string, state: TaskState): Promise<void> {
    await this.indexService.toggleTask({ taskId, state });
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

  private resolveInitialAreaId(areaId: string | null | undefined, settings: ProjectSettings): string | null {
    if (areaId && settings.areas.some((area) => area.id === areaId)) {
      return areaId;
    }

    return settings.areas[0]?.id ?? null;
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

    const withoutProject = deduped.filter((id) => id !== "project");
    return ["project", ...withoutProject];
  }
}
