import { get, writable, type Writable } from "svelte/store";
import {
  DEFAULT_TASK_TIMING_FILTER,
  FILTER_NONE_TOKEN,
  PROJECT_NO_PRIORITY_TOKEN,
  PROJECT_TIMING_OPTIONS,
  TASK_GRID_COLUMNS,
  TASK_PRIORITY_ORDER,
  TRI_STATE_TASK_STATUS_OPTIONS,
  BINARY_TASK_STATUS_OPTIONS,
} from "../constants";
import type {
  BoardType,
  GridTab,
  KanbanCardField,
  ProjectGridColumn,
  ProjectMetadataUpdate,
  ProjectSettings,
  ProjectSortField,
  ProjectTimingFilterOption,
  ProjectViewState,
  SavedKanbanView,
  SavedProjectsView,
  SavedTasksView,
  SavedView,
  SavedViewPromptResult,
  SavedViewTab,
  SortDirection,
  TaskDateField,
  TaskGridColumn,
  TaskPriorityFilterOption,
  TaskSortField,
  TaskState,
  TaskStatusFilterOption,
  TaskTimingFilterOption,
  ViewVariant,
} from "../types";
import type { ProjectIndexService } from "../services/projectIndexService";
import type { NoteOpenService } from "../services/noteOpenService";
import {
  appendRestoredDefaultView,
  buildSavedViewListItems,
  ensureSavedViewsForArea,
  findSavedView,
  getActiveSavedViewId,
  getSavedViewsForTab,
  makeSavedViewId,
  normalizeTaskPriorityFilter,
  normalizeTaskStatusFilter,
} from "../utils/savedViews";
import {
  buildAvailableKanbanCardFields,
  buildAvailableProjectGridColumns,
  normalizeKanbanCardFieldIds,
  normalizeKanbanNextTaskCount,
  normalizeVisibleProjectColumnIds,
  resolveDefaultKanbanCardFieldIds,
  resolveDefaultKanbanNextTaskCount,
  resolveDefaultProjectGridColumnIds,
  resolveStatusesForArea,
} from "../utils/viewConfig";

interface Dependencies {
  indexService: ProjectIndexService;
  noteOpenService: NoteOpenService;
  openSettings: () => void;
  createProject: () => Promise<void>;
  createProjectInAreaWithStatus: (areaId: string | null, status: string) => Promise<void>;
  createTask: (areaId: string | null) => Promise<void>;
  getSettings: () => ProjectSettings;
  persistSettings: () => Promise<void>;
  promptSaveView: (currentName: string) => Promise<SavedViewPromptResult | null>;
  boardType: BoardType;
  variant: ViewVariant;
  initialAreaId?: string | null;
  initialGridTab?: GridTab;
}

interface AreaContext {
  areaId: string | null;
  area: ProjectSettings["areas"][number] | null;
  statuses: string[];
  priorities: string[];
  availableProjectGridColumns: ProjectGridColumn[];
  availableTaskGridColumns: TaskGridColumn[];
  availableKanbanCardFields: KanbanCardField[];
}

interface KanbanProjectMoveRequest {
  path: string;
  sourceStatus: string;
  targetStatus: string;
  sourceVisiblePaths: string[];
  targetVisiblePaths: string[];
}

const TASK_TIMING_OPTION_VALUES: TaskTimingFilterOption[] = [...PROJECT_TIMING_OPTIONS];
const GLOBAL_KANBAN_ORDER_AREA_KEY = "__all__";

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
  private readonly promptSaveViewAction: (currentName: string) => Promise<SavedViewPromptResult | null>;
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
    this.promptSaveViewAction = dependencies.promptSaveView;

    const settings = this.getSettings();
    const initialized = this.ensureSavedViewsInitialized(settings);
    const initialAreaId = this.resolveInitialAreaId(dependencies.initialAreaId, settings);
    const initialGridTab = this.resolveInitialGridTab(dependencies.initialGridTab, dependencies.boardType);
    const context = this.buildAreaContext(settings, initialAreaId);
    const initialState = this.buildInitialState(settings, context, initialGridTab, dependencies.boardType, dependencies.variant);

    this.state = writable<ProjectViewState>(initialState);

    this.unsubscribeIndex = this.indexService.subscribe(() => {
      this.refresh();
    });

    if (initialized) {
      void this.persistSettings();
    }

    this.refresh();
  }

  destroy(): void {
    this.unsubscribeIndex?.();
    this.unsubscribeIndex = null;
  }

  refresh(): void {
    let shouldPersist = false;

    this.state.update((current) => {
      const settings = this.getSettings();
      if (this.ensureSavedViewsInitialized(settings)) {
        shouldPersist = true;
      }

      const currentAreaId = this.resolveInitialAreaId(current.currentAreaId, settings);
      const context = this.buildAreaContext(settings, currentAreaId);
      const activeView = this.resolveActiveSavedView(settings, currentAreaId, current.gridTab, context.area);
      const nextState = this.applySavedViewIfNeeded(current, settings, context, activeView);
      return this.populateData(nextState, settings, context, activeView);
    });

    if (shouldPersist) {
      void this.persistSettings();
    }
  }

  setArea(areaId: string): void {
    this.state.update((current) => ({ ...current, currentAreaId: areaId }));
    this.refresh();
  }

  setGridTab(tab: GridTab): void {
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

  setStatusFilter(statuses: string[]): void {
    this.state.update((current) => ({
      ...current,
      statusFilter: Array.from(new Set(statuses)),
    }));
    this.refresh();
  }

  setPriorityFilter(priorities: string[]): void {
    this.state.update((current) => ({
      ...current,
      priorityFilter: Array.from(new Set(priorities)),
    }));
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

  setProjectTimingFilter(timingFilter: ProjectTimingFilterOption[]): void {
    this.state.update((current) => ({
      ...current,
      projectTimingFilter: this.normalizeProjectTimingFilter(timingFilter, false),
    }));
  }

  setProjectTaskStatusFilter(taskStatusFilter: TaskStatusFilterOption[]): void {
    this.state.update((current) => ({
      ...current,
      projectTaskStatusFilter: this.normalizeTaskStatusFilterForState(taskStatusFilter, current.triStateCheckboxes, false),
    }));
  }

  setTaskStatusFilter(taskStatusFilter: TaskStatusFilterOption[]): void {
    this.state.update((current) => ({
      ...current,
      taskStatusFilter: this.normalizeTaskStatusFilterForState(taskStatusFilter, current.triStateCheckboxes, false),
    }));
  }

  setTaskPriorityFilter(taskPriorityFilter: TaskPriorityFilterOption[]): void {
    this.state.update((current) => ({
      ...current,
      taskPriorityFilter: normalizeTaskPriorityFilter(taskPriorityFilter),
    }));
  }

  setTaskTimingFilter(taskTimingFilter: TaskTimingFilterOption[]): void {
    this.state.update((current) => ({
      ...current,
      taskTimingFilter: this.normalizeTaskTimingFilter(taskTimingFilter, false),
    }));
  }

  setTaskSort(sortBy: TaskSortField, sortDirection: SortDirection): void {
    this.state.update((current) => ({ ...current, taskSortBy: sortBy, taskSortDirection: sortDirection }));
  }

  setProjectExpandedPaths(paths: string[]): void {
    this.state.update((current) => ({
      ...current,
      projectExpandedPaths: Array.from(new Set(paths.filter((path) => path.trim().length > 0))),
    }));
  }

  toggleProjectExpanded(path: string): void {
    this.state.update((current) => {
      const expanded = new Set(current.projectExpandedPaths);
      if (expanded.has(path)) {
        expanded.delete(path);
      } else {
        expanded.add(path);
      }

      return {
        ...current,
        projectExpandedPaths: Array.from(expanded),
      };
    });
  }

  setProjectColumnOrder(columnOrderIds: string[]): void {
    this.state.update((current) => {
      const nextOrder = this.normalizeOrderedIds(columnOrderIds, current.availableProjectGridColumns.map((column) => column.id));
      const visibleIds = new Set(current.projectGridColumns.map((column) => column.id));
      return {
        ...current,
        projectColumnOrderIds: nextOrder,
        projectGridColumns: this.resolveVisibleProjectColumns(current.availableProjectGridColumns, nextOrder, visibleIds),
      };
    });
  }

  setProjectGridColumns(columnIds: string[]): void {
    this.state.update((current) => {
      const visibleIds = new Set(this.normalizeVisibleProjectColumnIds(columnIds, current.availableProjectGridColumns));
      return {
        ...current,
        projectGridColumns: this.resolveVisibleProjectColumns(current.availableProjectGridColumns, current.projectColumnOrderIds, visibleIds),
      };
    });
  }

  setTaskColumnOrder(columnOrderIds: string[]): void {
    this.state.update((current) => {
      const nextOrder = this.normalizeOrderedIds(columnOrderIds, current.availableTaskGridColumns.map((column) => column.id));
      const visibleIds = new Set(current.taskGridColumns.map((column) => column.id));
      return {
        ...current,
        taskColumnOrderIds: nextOrder,
        taskGridColumns: this.resolveVisibleTaskColumns(current.availableTaskGridColumns, nextOrder, visibleIds),
      };
    });
  }

  setTaskGridColumns(columnIds: string[]): void {
    this.state.update((current) => {
      const visibleIds = new Set(this.normalizeVisibleTaskColumnIds(columnIds));
      return {
        ...current,
        taskGridColumns: this.resolveVisibleTaskColumns(current.availableTaskGridColumns, current.taskColumnOrderIds, visibleIds),
      };
    });
  }

  toggleShowHiddenKanban(): void {
    this.state.update((current) => ({ ...current, showHiddenKanban: !current.showHiddenKanban }));
  }

  setKanbanHiddenStatuses(statuses: string[]): void {
    this.state.update((current) => ({
      ...current,
      hiddenKanbanStatuses: Array.from(new Set(statuses.filter((status) => current.statuses.includes(status)))),
    }));
  }

  setKanbanStatusOrder(statusOrder: string[]): void {
    this.state.update((current) => ({
      ...current,
      kanbanStatusOrder: this.normalizeOrderedIds(statusOrder, current.statuses),
    }));
  }

  setKanbanCardFields(fieldIds: string[]): void {
    this.state.update((current) => {
      const normalized = normalizeKanbanCardFieldIds(fieldIds, current.availableKanbanCardFields);
      const visible = normalized
        .map((id) => current.availableKanbanCardFields.find((field) => field.id === id))
        .filter((field): field is KanbanCardField => field !== undefined);
      return {
        ...current,
        kanbanCardFields: visible,
      };
    });
  }

  setKanbanNextTaskCount(count: number): void {
    this.state.update((current) => ({
      ...current,
      kanbanNextTaskCount: normalizeKanbanNextTaskCount(count),
    }));
  }

  setKanbanTimingFilter(timingFilter: ProjectTimingFilterOption[]): void {
    this.state.update((current) => ({
      ...current,
      kanbanTimingFilter: this.normalizeProjectTimingFilter(timingFilter, false),
    }));
  }

  async selectSavedView(viewId: string): Promise<void> {
    const current = get(this.state);
    if (!current.currentAreaId) {
      return;
    }

    this.state.update((state) => ({
      ...state,
      activeSavedViewId: state.activeSavedViewId === viewId ? null : state.activeSavedViewId,
    }));

    const settings = this.getSettings();
    settings.activeSavedViewIdsByArea[current.currentAreaId] = settings.activeSavedViewIdsByArea[current.currentAreaId] ?? {};
    settings.activeSavedViewIdsByArea[current.currentAreaId][current.gridTab] = viewId;
    await this.persistSettings();
    this.refresh();
  }

  async promptSaveCurrentView(): Promise<void> {
    const current = get(this.state);
    if (!current.currentAreaId) {
      return;
    }

    const currentName = current.activeSavedViewName || "Default";
    const promptResult = await this.promptSaveViewAction(currentName);
    if (!promptResult) {
      return;
    }

    const settings = this.getSettings();
    const area = settings.areas.find((candidate) => candidate.id === current.currentAreaId);
    if (!area) {
      return;
    }

    this.ensureSavedViewsInitialized(settings);
    const views = settings.savedViewsByArea[area.id] ?? (settings.savedViewsByArea[area.id] = {
      projects: [],
      tasks: [],
      kanban: [],
    });

    const snapshot = this.captureCurrentSavedView(current);
    snapshot.name = promptResult.name.trim();

    if (promptResult.action === "update-current" && current.activeSavedViewId) {
      this.replaceSavedView(views, snapshot, current.activeSavedViewId);
      settings.activeSavedViewIdsByArea[area.id] = settings.activeSavedViewIdsByArea[area.id] ?? {};
      settings.activeSavedViewIdsByArea[area.id][current.gridTab] = current.activeSavedViewId;
    } else {
      snapshot.id = makeSavedViewId(current.gridTab);
      this.appendSavedView(views, snapshot);
      settings.activeSavedViewIdsByArea[area.id] = settings.activeSavedViewIdsByArea[area.id] ?? {};
      settings.activeSavedViewIdsByArea[area.id][current.gridTab] = snapshot.id;
    }

    await this.persistSettings();
    this.refresh();
  }

  async deleteSavedView(viewId: string): Promise<void> {
    const current = get(this.state);
    if (!current.currentAreaId) {
      return;
    }

    const settings = this.getSettings();
    const area = settings.areas.find((candidate) => candidate.id === current.currentAreaId);
    if (!area) {
      return;
    }

    this.ensureSavedViewsInitialized(settings);
    const viewsByTab = settings.savedViewsByArea[area.id];
    const tab = current.gridTab;
    const currentViews = getSavedViewsForTab(settings, area.id, tab);
    const target = currentViews.find((view) => view.id === viewId);
    if (!target || target.name.trim() === "Default") {
      return;
    }

    if (tab === "projects") {
      viewsByTab.projects = viewsByTab.projects.filter((view) => view.id !== viewId);
    } else if (tab === "tasks") {
      viewsByTab.tasks = viewsByTab.tasks.filter((view) => view.id !== viewId);
    } else {
      viewsByTab.kanban = viewsByTab.kanban.filter((view) => view.id !== viewId);
    }

    const remaining = getSavedViewsForTab(settings, area.id, tab);
    let nextActive = remaining.find((view) => view.name.trim() === "Default") ?? null;
    if (!nextActive) {
      nextActive = appendRestoredDefaultView(settings, area, tab);
    }

    if (current.activeSavedViewId === viewId) {
      settings.activeSavedViewIdsByArea[area.id] = settings.activeSavedViewIdsByArea[area.id] ?? {};
      settings.activeSavedViewIdsByArea[area.id][tab] = nextActive.id;
    }

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

  async moveKanbanProject(request: KanbanProjectMoveRequest): Promise<void> {
    const current = get(this.state);
    const settings = this.getSettings();
    const allAreaProjects = this.indexService.queryProjects({
      areaId: current.currentAreaId,
      sortBy: current.sortBy,
      sortDirection: current.sortDirection,
    });
    const currentOrders = this.resolveKanbanProjectOrderByStatus(settings, current.currentAreaId, current.statuses, allAreaProjects);
    const sourceBaseOrder = (currentOrders[request.sourceStatus] ?? []).filter((path) => path !== request.path);
    const targetBaseOrder = (currentOrders[request.targetStatus] ?? []).filter((path) => path !== request.path);
    const nextOrders: Record<string, string[]> = { ...currentOrders };

    if (request.sourceStatus === request.targetStatus) {
      nextOrders[request.targetStatus] = this.mergeVisibleKanbanOrder(targetBaseOrder, request.targetVisiblePaths);
    } else {
      nextOrders[request.sourceStatus] = this.mergeVisibleKanbanOrder(sourceBaseOrder, request.sourceVisiblePaths);
      nextOrders[request.targetStatus] = this.mergeVisibleKanbanOrder(targetBaseOrder, request.targetVisiblePaths);
    }

    this.persistKanbanProjectOrder(settings, current.currentAreaId, nextOrders, [request.sourceStatus, request.targetStatus]);
    this.state.update((state) => ({
      ...state,
      kanbanProjectOrderByStatus: nextOrders,
      projectStatusByPath:
        request.sourceStatus === request.targetStatus
          ? state.projectStatusByPath
          : { ...state.projectStatusByPath, [request.path]: request.targetStatus },
      projects:
        request.sourceStatus === request.targetStatus
          ? state.projects
          : state.projects.map((project) =>
              project.path === request.path
                ? {
                    ...project,
                    status: request.targetStatus,
                    statusIsUnknown: !state.statuses.includes(request.targetStatus),
                  }
                : project,
            ),
    }));

    if (request.sourceStatus !== request.targetStatus) {
      const changed = await this.indexService.updateProjectMetadata({
        path: request.path,
        key: "status",
        value: request.targetStatus,
      });

      if (!changed) {
        this.persistKanbanProjectOrder(settings, current.currentAreaId, currentOrders, [request.sourceStatus, request.targetStatus]);
        this.refresh();
        return;
      }
    }

    await this.persistSettings();
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

  private buildInitialState(
    settings: ProjectSettings,
    context: AreaContext,
    gridTab: GridTab,
    boardType: BoardType,
    variant: ViewVariant,
  ): ProjectViewState {
    const activeView = this.resolveActiveSavedView(settings, context.areaId, gridTab, context.area);
    const taskColumnOrderIds = TASK_GRID_COLUMNS.map((column) => column.id);
    const taskGridColumns = this.resolveVisibleTaskColumns(context.availableTaskGridColumns, taskColumnOrderIds, new Set(taskColumnOrderIds));

    const baseState: ProjectViewState = {
      areas: settings.areas,
      currentAreaId: context.areaId,
      statuses: context.statuses,
      priorities: context.priorities,
      boardType,
      variant,
      gridTab,
      projectSearch: "",
      taskSearch: "",
      statusFilter: [...settings.defaultProjectStatuses],
      priorityFilter: [],
      projectTimingFilter: [...PROJECT_TIMING_OPTIONS],
      projectTaskStatusFilter: normalizeTaskStatusFilter(undefined, settings.enableTriStateCheckboxes),
      projectExpandedPaths: [],
      areaTagFilter: [],
      availableAreaTags: [],
      availableProjectGridColumns: context.availableProjectGridColumns,
      projectGridColumns: this.resolveVisibleProjectColumns(
        context.availableProjectGridColumns,
        context.availableProjectGridColumns.map((column) => column.id),
        new Set(resolveDefaultProjectGridColumnIds(settings, context.areaId, context.area)),
      ),
      projectColumnOrderIds: context.availableProjectGridColumns.map((column) => column.id),
      availableTaskGridColumns: context.availableTaskGridColumns,
      taskGridColumns,
      taskColumnOrderIds,
      taskStatusFilter: normalizeTaskStatusFilter(undefined, settings.enableTriStateCheckboxes),
      taskPriorityFilter: [...TASK_PRIORITY_ORDER, "none"],
      taskTimingFilter: [...DEFAULT_TASK_TIMING_FILTER],
      taskSortBy: "due",
      taskSortDirection: "asc",
      availableKanbanCardFields: context.availableKanbanCardFields,
      kanbanCardFields: this.resolveVisibleKanbanCardFields(
        context.availableKanbanCardFields,
        resolveDefaultKanbanCardFieldIds(settings, context.areaId, context.area),
      ),
      kanbanNextTaskCount: resolveDefaultKanbanNextTaskCount(settings, context.areaId),
      kanbanStatusOrder: [...context.statuses],
      kanbanProjectOrderByStatus: {},
      kanbanTimingFilter: [...PROJECT_TIMING_OPTIONS],
      kanbanNotesPreviewWords: settings.kanbanNotesPreviewWords,
      kanbanNotesPreviewLines: settings.kanbanNotesPreviewLines,
      sortBy: settings.defaultSortBy,
      sortDirection: settings.defaultSortDirection,
      projects: [],
      projectStatusByPath: {},
      tasks: [],
      triStateCheckboxes: settings.enableTriStateCheckboxes,
      hiddenKanbanStatuses: settings.kanbanHiddenStatuses.filter((status) => context.statuses.includes(status)),
      showHiddenKanban: false,
      savedViews: [],
      activeSavedViewId: null,
      activeSavedViewName: "",
    };

    return this.populateData(this.applySavedViewIfNeeded(baseState, settings, context, activeView), settings, context, activeView);
  }

  private populateData(
    current: ProjectViewState,
    settings: ProjectSettings,
    context: AreaContext,
    activeView: SavedView | null,
  ): ProjectViewState {
    const statuses = context.statuses;
    const priorities = context.priorities;
    const areaTagPrefix = context.area ? `area/${context.area.slug}` : null;
    const allAreaProjects = this.indexService.queryProjects({
      areaId: context.areaId,
      sortBy: current.sortBy,
      sortDirection: current.sortDirection,
    });
    const kanbanProjectOrderByStatus = this.resolveKanbanProjectOrderByStatus(
      settings,
      context.areaId,
      statuses,
      allAreaProjects,
    );
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
      areaId: context.areaId,
      search: current.projectSearch,
      statuses: current.gridTab !== "kanban" && current.statusFilter.length > 0 ? current.statusFilter : undefined,
      priorities: current.priorityFilter.length > 0 ? current.priorityFilter : undefined,
      areaTags: areaTagFilter.length > 0 ? areaTagFilter : undefined,
      sortBy: current.sortBy,
      sortDirection: current.sortDirection,
    });
    const tasks = this.indexService.queryTasks({
      areaId: context.areaId,
      search: current.taskSearch,
      includeCompleted: true,
      sortBy: "due-date",
      sortDirection: "asc",
    });
    const visibleProjectPaths = new Set(projects.map((project) => project.path));

    return {
      ...current,
      areas: settings.areas,
      currentAreaId: context.areaId,
      statuses,
      priorities,
      triStateCheckboxes: settings.enableTriStateCheckboxes,
      availableAreaTags,
      areaTagFilter,
      availableProjectGridColumns: context.availableProjectGridColumns,
      projectColumnOrderIds: this.normalizeOrderedIds(current.projectColumnOrderIds, context.availableProjectGridColumns.map((column) => column.id)),
      projectGridColumns: this.resolveVisibleProjectColumns(
        context.availableProjectGridColumns,
        current.projectColumnOrderIds,
        new Set(current.projectGridColumns.map((column) => column.id)),
      ),
      availableTaskGridColumns: context.availableTaskGridColumns,
      taskColumnOrderIds: this.normalizeOrderedIds(current.taskColumnOrderIds, context.availableTaskGridColumns.map((column) => column.id)),
      taskGridColumns: this.resolveVisibleTaskColumns(
        context.availableTaskGridColumns,
        current.taskColumnOrderIds,
        new Set(current.taskGridColumns.map((column) => column.id)),
      ),
      availableKanbanCardFields: context.availableKanbanCardFields,
      kanbanCardFields: this.resolveVisibleKanbanCardFields(
        context.availableKanbanCardFields,
        current.kanbanCardFields.map((field) => field.id),
      ),
      kanbanStatusOrder: this.normalizeOrderedIds(current.kanbanStatusOrder, statuses),
      kanbanProjectOrderByStatus,
      hiddenKanbanStatuses: Array.from(new Set(current.hiddenKanbanStatuses.filter((status) => statuses.includes(status)))),
      kanbanNotesPreviewWords: settings.kanbanNotesPreviewWords,
      kanbanNotesPreviewLines: settings.kanbanNotesPreviewLines,
      savedViews: buildSavedViewListItems(getSavedViewsForTab(settings, context.areaId, current.gridTab)),
      activeSavedViewId: activeView?.id ?? null,
      activeSavedViewName: activeView?.name ?? "",
      projectExpandedPaths: current.projectExpandedPaths.filter((path) => visibleProjectPaths.has(path)),
      projects,
      projectStatusByPath,
      tasks,
    };
  }

  private applySavedViewIfNeeded(
    current: ProjectViewState,
    settings: ProjectSettings,
    context: AreaContext,
    activeView: SavedView | null,
  ): ProjectViewState {
    const shouldApply =
      current.activeSavedViewId !== (activeView?.id ?? null) ||
      current.currentAreaId !== context.areaId;

    if (!shouldApply) {
      return this.normalizeCurrentState(current, settings, context);
    }

    return this.stateFromSavedView(current, settings, context, activeView);
  }

  private normalizeCurrentState(
    current: ProjectViewState,
    settings: ProjectSettings,
    context: AreaContext,
  ): ProjectViewState {
    const allowedStatusFilters = new Set([...context.statuses, FILTER_NONE_TOKEN]);
    const allowedPriorityFilters = new Set([...context.priorities, FILTER_NONE_TOKEN, PROJECT_NO_PRIORITY_TOKEN]);
    const projectVisibleIds = new Set(this.normalizeVisibleProjectColumnIds(current.projectGridColumns.map((column) => column.id), context.availableProjectGridColumns));
    const taskVisibleIds = new Set(this.normalizeVisibleTaskColumnIds(current.taskGridColumns.map((column) => column.id)));

    return {
      ...current,
      statusFilter: current.statusFilter.filter((status) => allowedStatusFilters.has(status)),
      priorityFilter: current.priorityFilter.filter((priority) => allowedPriorityFilters.has(priority)),
      projectTimingFilter: this.normalizeProjectTimingFilter(current.projectTimingFilter, false),
      projectTaskStatusFilter: this.normalizeTaskStatusFilterForState(current.projectTaskStatusFilter, settings.enableTriStateCheckboxes, false),
      projectColumnOrderIds: this.normalizeOrderedIds(current.projectColumnOrderIds, context.availableProjectGridColumns.map((column) => column.id)),
      projectGridColumns: this.resolveVisibleProjectColumns(context.availableProjectGridColumns, current.projectColumnOrderIds, projectVisibleIds),
      taskColumnOrderIds: this.normalizeOrderedIds(current.taskColumnOrderIds, context.availableTaskGridColumns.map((column) => column.id)),
      taskGridColumns: this.resolveVisibleTaskColumns(context.availableTaskGridColumns, current.taskColumnOrderIds, taskVisibleIds),
      taskStatusFilter: this.normalizeTaskStatusFilterForState(current.taskStatusFilter, settings.enableTriStateCheckboxes, false),
      taskPriorityFilter: normalizeTaskPriorityFilter(current.taskPriorityFilter),
      taskTimingFilter: this.normalizeTaskTimingFilter(current.taskTimingFilter, false),
      kanbanCardFields: this.resolveVisibleKanbanCardFields(context.availableKanbanCardFields, current.kanbanCardFields.map((field) => field.id)),
      kanbanNextTaskCount: normalizeKanbanNextTaskCount(current.kanbanNextTaskCount),
      kanbanStatusOrder: this.normalizeOrderedIds(current.kanbanStatusOrder, context.statuses),
      kanbanTimingFilter: this.normalizeProjectTimingFilter(current.kanbanTimingFilter, false),
    };
  }

  private stateFromSavedView(
    current: ProjectViewState,
    settings: ProjectSettings,
    context: AreaContext,
    activeView: SavedView | null,
  ): ProjectViewState {
    const base = {
      ...current,
      currentAreaId: context.areaId,
    };

    if (!activeView) {
      return this.normalizeCurrentState(base, settings, context);
    }

    if (activeView.tab === "projects") {
      const view = activeView as SavedProjectsView;
      const projectVisibleIds = new Set(this.normalizeVisibleProjectColumnIds(view.columnIds, context.availableProjectGridColumns));
      const projectColumnOrderIds = this.normalizeOrderedIds(
        [...view.columnIds, ...context.availableProjectGridColumns.map((column) => column.id)],
        context.availableProjectGridColumns.map((column) => column.id),
      );
      return {
        ...base,
        statusFilter: view.statusFilter.filter((status) => context.statuses.includes(status) || status === FILTER_NONE_TOKEN),
        priorityFilter: view.priorityFilter.filter(
          (priority) => context.priorities.includes(priority) || priority === FILTER_NONE_TOKEN || priority === PROJECT_NO_PRIORITY_TOKEN,
        ),
        projectTimingFilter: this.normalizeProjectTimingFilter(view.timingFilter, true),
        projectTaskStatusFilter: this.normalizeTaskStatusFilterForState(view.taskStatusFilter, settings.enableTriStateCheckboxes, true),
        projectExpandedPaths: Array.from(new Set(view.expandedProjectPaths)),
        projectColumnOrderIds,
        projectGridColumns: this.resolveVisibleProjectColumns(context.availableProjectGridColumns, projectColumnOrderIds, projectVisibleIds),
        sortBy: view.sortBy,
        sortDirection: view.sortDirection,
        activeSavedViewId: view.id,
        activeSavedViewName: view.name,
      };
    }

    if (activeView.tab === "tasks") {
      const view = activeView as SavedTasksView;
      const taskVisibleIds = new Set(this.normalizeVisibleTaskColumnIds(view.columnIds));
      const taskColumnOrderIds = this.normalizeOrderedIds(
        [...view.columnIds, ...context.availableTaskGridColumns.map((column) => column.id)],
        context.availableTaskGridColumns.map((column) => column.id),
      );
      return {
        ...base,
        taskColumnOrderIds,
        taskGridColumns: this.resolveVisibleTaskColumns(context.availableTaskGridColumns, taskColumnOrderIds, taskVisibleIds),
        taskStatusFilter: this.normalizeTaskStatusFilterForState(view.taskStatusFilter, settings.enableTriStateCheckboxes, true),
        taskPriorityFilter: normalizeTaskPriorityFilter(view.taskPriorityFilter),
        taskTimingFilter: this.normalizeTaskTimingFilter(view.timingFilter, true),
        taskSortBy: view.sortBy,
        taskSortDirection: view.sortDirection,
        activeSavedViewId: view.id,
        activeSavedViewName: view.name,
      };
    }

    const view = activeView as SavedKanbanView;
    return {
      ...base,
      kanbanStatusOrder: this.normalizeOrderedIds(view.statusOrder, context.statuses),
      hiddenKanbanStatuses: Array.from(new Set(view.hiddenStatuses.filter((status) => context.statuses.includes(status)))),
      kanbanCardFields: this.resolveVisibleKanbanCardFields(context.availableKanbanCardFields, view.cardFieldIds),
      kanbanNextTaskCount: normalizeKanbanNextTaskCount(view.nextTaskCount),
      kanbanTimingFilter: this.normalizeProjectTimingFilter(view.timingFilter, true),
      activeSavedViewId: view.id,
      activeSavedViewName: view.name,
    };
  }

  private captureCurrentSavedView(state: ProjectViewState): SavedView {
    if (state.gridTab === "projects") {
      return {
        id: state.activeSavedViewId ?? makeSavedViewId("projects"),
        name: state.activeSavedViewName || "Default",
        tab: "projects",
        columnIds: state.projectGridColumns.map((column) => column.id),
        statusFilter: [...state.statusFilter],
        priorityFilter: [...state.priorityFilter],
        timingFilter: [...state.projectTimingFilter],
        taskStatusFilter: [...state.projectTaskStatusFilter],
        sortBy: state.sortBy,
        sortDirection: state.sortDirection,
        expandedProjectPaths: [...state.projectExpandedPaths],
      } satisfies SavedProjectsView;
    }

    if (state.gridTab === "tasks") {
      return {
        id: state.activeSavedViewId ?? makeSavedViewId("tasks"),
        name: state.activeSavedViewName || "Default",
        tab: "tasks",
        columnIds: state.taskGridColumns.map((column) => column.id),
        taskStatusFilter: [...state.taskStatusFilter],
        taskPriorityFilter: [...state.taskPriorityFilter],
        timingFilter: [...state.taskTimingFilter],
        sortBy: state.taskSortBy,
        sortDirection: state.taskSortDirection,
      } satisfies SavedTasksView;
    }

    return {
      id: state.activeSavedViewId ?? makeSavedViewId("kanban"),
      name: state.activeSavedViewName || "Default",
      tab: "kanban",
      statusOrder: [...state.kanbanStatusOrder],
      hiddenStatuses: [...state.hiddenKanbanStatuses],
      cardFieldIds: state.kanbanCardFields.map((field) => field.id),
      nextTaskCount: state.kanbanNextTaskCount,
      timingFilter: [...state.kanbanTimingFilter],
    } satisfies SavedKanbanView;
  }

  private replaceSavedView(
    views: { projects: SavedProjectsView[]; tasks: SavedTasksView[]; kanban: SavedKanbanView[] },
    snapshot: SavedView,
    activeId: string,
  ): void {
    if (snapshot.tab === "projects") {
      views.projects = views.projects.map((view) => (view.id === activeId ? { ...(snapshot as SavedProjectsView), id: activeId } : view));
      return;
    }

    if (snapshot.tab === "tasks") {
      views.tasks = views.tasks.map((view) => (view.id === activeId ? { ...(snapshot as SavedTasksView), id: activeId } : view));
      return;
    }

    views.kanban = views.kanban.map((view) => (view.id === activeId ? { ...(snapshot as SavedKanbanView), id: activeId } : view));
  }

  private appendSavedView(
    views: { projects: SavedProjectsView[]; tasks: SavedTasksView[]; kanban: SavedKanbanView[] },
    snapshot: SavedView,
  ): void {
    if (snapshot.tab === "projects") {
      views.projects = [snapshot as SavedProjectsView, ...views.projects];
      return;
    }

    if (snapshot.tab === "tasks") {
      views.tasks = [snapshot as SavedTasksView, ...views.tasks];
      return;
    }

    views.kanban = [snapshot as SavedKanbanView, ...views.kanban];
  }

  private ensureSavedViewsInitialized(settings: ProjectSettings): boolean {
    let changed = false;
    for (const area of settings.areas) {
      if (ensureSavedViewsForArea(settings, area)) {
        changed = true;
      }
    }
    return changed;
  }

  private resolveActiveSavedView(
    settings: ProjectSettings,
    areaId: string | null,
    tab: SavedViewTab,
    area: ProjectSettings["areas"][number] | null,
  ): SavedView | null {
    if (!areaId || !area) {
      return null;
    }

    ensureSavedViewsForArea(settings, area);
    const activeId = getActiveSavedViewId(settings, areaId, tab);
    const active = findSavedView(settings, areaId, tab, activeId);
    if (active) {
      return active;
    }

    return getSavedViewsForTab(settings, areaId, tab)[0] ?? null;
  }

  private buildAreaContext(settings: ProjectSettings, areaId: string | null): AreaContext {
    const area = settings.areas.find((candidate) => candidate.id === areaId) ?? null;
    return {
      areaId,
      area,
      statuses: resolveStatusesForArea(settings, areaId),
      priorities: this.indexService.getPrioritiesForArea(areaId),
      availableProjectGridColumns: buildAvailableProjectGridColumns(settings, area),
      availableTaskGridColumns: TASK_GRID_COLUMNS.map((column) => ({ ...column })),
      availableKanbanCardFields: buildAvailableKanbanCardFields(settings, area),
    };
  }

  private resolveInitialAreaId(areaId: string | null | undefined, settings: ProjectSettings): string | null {
    if (areaId && settings.areas.some((area) => area.id === areaId)) {
      return areaId;
    }

    return settings.areas[0]?.id ?? null;
  }

  private resolveInitialGridTab(gridTab: GridTab | undefined, boardType: BoardType): GridTab {
    if (gridTab === "projects" || gridTab === "tasks" || gridTab === "kanban") {
      return gridTab;
    }

    return boardType === "kanban" ? "kanban" : "projects";
  }

  private getKanbanProjectOrderAreaKey(areaId: string | null): string {
    return areaId ?? GLOBAL_KANBAN_ORDER_AREA_KEY;
  }

  private resolveKanbanProjectOrderByStatus(
    settings: ProjectSettings,
    areaId: string | null,
    statuses: string[],
    projects: ProjectViewState["projects"],
  ): Record<string, string[]> {
    const storedByStatus = settings.kanbanProjectOrderByArea[this.getKanbanProjectOrderAreaKey(areaId)] ?? {};
    const orderedStatuses = [...statuses];
    const seenStatuses = new Set(orderedStatuses);
    const pathsByStatus = new Map<string, string[]>();

    for (const project of projects) {
      if (!seenStatuses.has(project.status)) {
        seenStatuses.add(project.status);
        orderedStatuses.push(project.status);
      }

      const bucket = pathsByStatus.get(project.status) ?? [];
      bucket.push(project.path);
      pathsByStatus.set(project.status, bucket);
    }

    const resolved: Record<string, string[]> = {};
    for (const status of orderedStatuses) {
      const availablePaths = pathsByStatus.get(status) ?? [];
      resolved[status] = this.normalizeOrderedIds(storedByStatus[status] ?? [], availablePaths);
    }

    return resolved;
  }

  private mergeVisibleKanbanOrder(baseOrder: string[], visibleOrder: string[]): string[] {
    const normalizedVisibleOrder = Array.from(new Set(visibleOrder.filter((path) => path.length > 0)));
    const visibleSet = new Set(normalizedVisibleOrder);
    const hiddenOrder = baseOrder.filter((path) => !visibleSet.has(path));
    return this.normalizeOrderedIds(normalizedVisibleOrder, [...normalizedVisibleOrder, ...hiddenOrder]);
  }

  private persistKanbanProjectOrder(
    settings: ProjectSettings,
    areaId: string | null,
    orderByStatus: Record<string, string[]>,
    statuses: string[],
  ): void {
    const areaKey = this.getKanbanProjectOrderAreaKey(areaId);
    const nextAreaOrder = { ...(settings.kanbanProjectOrderByArea[areaKey] ?? {}) };

    for (const status of statuses) {
      const order = Array.from(new Set((orderByStatus[status] ?? []).filter((path) => path.length > 0)));
      if (order.length > 0) {
        nextAreaOrder[status] = order;
      } else {
        delete nextAreaOrder[status];
      }
    }

    if (Object.keys(nextAreaOrder).length > 0) {
      settings.kanbanProjectOrderByArea[areaKey] = nextAreaOrder;
      return;
    }

    delete settings.kanbanProjectOrderByArea[areaKey];
  }

  private normalizeOrderedIds(ids: string[], availableIds: string[]): string[] {
    const seen = new Set<string>();
    const next: string[] = [];
    for (const id of ids) {
      if (!availableIds.includes(id) || seen.has(id)) {
        continue;
      }
      seen.add(id);
      next.push(id);
    }

    for (const id of availableIds) {
      if (!seen.has(id)) {
        next.push(id);
      }
    }

    return next;
  }

  private normalizeVisibleProjectColumnIds(columnIds: string[], availableColumns: ProjectGridColumn[]): string[] {
    const normalized = normalizeVisibleProjectColumnIds(columnIds, availableColumns);
    return normalized.length > 0 ? normalized : ["project"];
  }

  private normalizeVisibleTaskColumnIds(columnIds: string[]): string[] {
    const availableIds = new Set(TASK_GRID_COLUMNS.map((column) => column.id));
    const normalized = Array.from(new Set(columnIds.filter((id) => availableIds.has(id))));
    return normalized.length > 0 ? normalized : ["task"];
  }

  private resolveVisibleProjectColumns(
    availableColumns: ProjectGridColumn[],
    orderedIds: string[],
    visibleIds: Set<string>,
  ): ProjectGridColumn[] {
    const nextOrder = this.normalizeOrderedIds(orderedIds, availableColumns.map((column) => column.id));
    const byId = new Map(availableColumns.map((column) => [column.id, column]));
    return nextOrder
      .filter((id) => visibleIds.has(id))
      .map((id) => byId.get(id))
      .filter((column): column is ProjectGridColumn => column !== undefined);
  }

  private resolveVisibleTaskColumns(
    availableColumns: TaskGridColumn[],
    orderedIds: string[],
    visibleIds: Set<string>,
  ): TaskGridColumn[] {
    const nextOrder = this.normalizeOrderedIds(orderedIds, availableColumns.map((column) => column.id));
    const byId = new Map(availableColumns.map((column) => [column.id, column]));
    return nextOrder
      .filter((id) => visibleIds.has(id))
      .map((id) => byId.get(id))
      .filter((column): column is TaskGridColumn => column !== undefined);
  }

  private resolveVisibleKanbanCardFields(availableFields: KanbanCardField[], fieldIds: string[]): KanbanCardField[] {
    const normalized = normalizeKanbanCardFieldIds(fieldIds, availableFields);
    const byId = new Map(availableFields.map((field) => [field.id, field]));
    return normalized
      .map((id) => byId.get(id))
      .filter((field): field is KanbanCardField => field !== undefined);
  }

  private normalizeProjectTimingFilter(values: ProjectTimingFilterOption[], fallbackToAll: boolean): ProjectTimingFilterOption[] {
    const normalized = PROJECT_TIMING_OPTIONS.filter((status) => values.includes(status));
    if (normalized.length > 0 || !fallbackToAll) {
      return normalized;
    }
    return [...PROJECT_TIMING_OPTIONS];
  }

  private normalizeTaskTimingFilter(values: TaskTimingFilterOption[], fallbackToDefault: boolean): TaskTimingFilterOption[] {
    const normalized = TASK_TIMING_OPTION_VALUES.filter((status) => values.includes(status));
    if (normalized.length > 0 || !fallbackToDefault) {
      return normalized;
    }
    return [...DEFAULT_TASK_TIMING_FILTER];
  }

  private normalizeTaskStatusFilterForState(
    values: TaskStatusFilterOption[],
    enableTriStateCheckboxes: boolean,
    fallbackToDefault: boolean,
  ): TaskStatusFilterOption[] {
    const allowed = enableTriStateCheckboxes ? TRI_STATE_TASK_STATUS_OPTIONS : BINARY_TASK_STATUS_OPTIONS;
    const normalized = allowed.filter((status) => values.includes(status));
    if (normalized.length > 0 || !fallbackToDefault) {
      return normalized;
    }
    return normalizeTaskStatusFilter(undefined, enableTriStateCheckboxes);
  }
}
