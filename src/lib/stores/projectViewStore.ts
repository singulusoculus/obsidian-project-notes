import { get, writable, type Writable } from "svelte/store";
import type {
  BoardType,
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

interface Dependencies {
  indexService: ProjectIndexService;
  noteOpenService: NoteOpenService;
  createProject: () => Promise<void>;
  createTask: (areaId: string | null) => Promise<void>;
  getSettings: () => ProjectSettings;
  boardType: BoardType;
  variant: ViewVariant;
  initialAreaId?: string | null;
}

export class ProjectViewStore {
  readonly state: Writable<ProjectViewState>;

  private readonly indexService: ProjectIndexService;
  private readonly noteOpenService: NoteOpenService;
  private readonly createProject: () => Promise<void>;
  private readonly createTask: (areaId: string | null) => Promise<void>;
  private readonly getSettings: () => ProjectSettings;
  private unsubscribeIndex: (() => void) | null = null;

  constructor(dependencies: Dependencies) {
    this.indexService = dependencies.indexService;
    this.noteOpenService = dependencies.noteOpenService;
    this.createProject = dependencies.createProject;
    this.createTask = dependencies.createTask;
    this.getSettings = dependencies.getSettings;

    const settings = this.getSettings();
    const initialArea = this.resolveInitialAreaId(dependencies.initialAreaId, settings);

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

  private resolveInitialAreaId(areaId: string | null | undefined, settings: ProjectSettings): string | null {
    if (areaId && settings.areas.some((area) => area.id === areaId)) {
      return areaId;
    }

    return settings.areas[0]?.id ?? null;
  }
}
