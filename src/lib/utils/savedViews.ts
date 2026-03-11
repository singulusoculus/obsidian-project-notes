import {
  DEFAULT_TASK_TIMING_FILTER,
  PROJECT_TIMING_OPTIONS,
  TASK_GRID_COLUMNS,
  TASK_PRIORITY_ORDER,
  TRI_STATE_TASK_STATUS_OPTIONS,
  BINARY_TASK_STATUS_OPTIONS,
} from "../constants";
import type {
  AreaConfig,
  AreaSavedViews,
  ProjectSettings,
  SavedKanbanView,
  SavedProjectsView,
  SavedTasksView,
  SavedView,
  SavedViewListItem,
  SavedViewTab,
  TaskPriorityFilterOption,
  TaskStatusFilterOption,
} from "../types";
import {
  resolveDefaultKanbanCardFieldIds,
  resolveDefaultKanbanNextTaskCount,
  resolveDefaultProjectGridColumnIds,
  resolveStatusesForArea,
} from "./viewConfig";

export function makeSavedViewId(tab: SavedViewTab): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `saved-view-${tab}-${Date.now()}-${random}`;
}

export function makeEmptyAreaSavedViews(): AreaSavedViews {
  return {
    projects: [],
    tasks: [],
    kanban: [],
  };
}

export function defaultTaskStatusFilter(enableTriStateCheckboxes: boolean): TaskStatusFilterOption[] {
  return enableTriStateCheckboxes ? ["To Do", "Doing"] : ["To Do"];
}

export function normalizeTaskStatusFilter(
  values: string[] | undefined,
  enableTriStateCheckboxes: boolean,
): TaskStatusFilterOption[] {
  const allowed = enableTriStateCheckboxes ? TRI_STATE_TASK_STATUS_OPTIONS : BINARY_TASK_STATUS_OPTIONS;
  const normalized = (values ?? []).filter((value): value is TaskStatusFilterOption => allowed.includes(value as TaskStatusFilterOption));
  if (normalized.length > 0) {
    return allowed.filter((value) => normalized.includes(value));
  }

  return defaultTaskStatusFilter(enableTriStateCheckboxes);
}

export function normalizeTaskPriorityFilter(values: string[] | undefined): TaskPriorityFilterOption[] {
  const allowed = new Set<TaskPriorityFilterOption>([...TASK_PRIORITY_ORDER, "none"]);
  const normalized = (values ?? []).filter((value): value is TaskPriorityFilterOption => allowed.has(value as TaskPriorityFilterOption));
  if (normalized.length > 0) {
    return normalized;
  }

  return [...TASK_PRIORITY_ORDER, "none"];
}

export function createDefaultProjectsSavedView(settings: ProjectSettings, area: AreaConfig): SavedProjectsView {
  return {
    id: makeSavedViewId("projects"),
    name: "Default",
    tab: "projects",
    columnIds: resolveDefaultProjectGridColumnIds(settings, area.id, area),
    statusFilter: [...settings.defaultProjectStatuses],
    priorityFilter: [],
    timingFilter: [...PROJECT_TIMING_OPTIONS],
    taskStatusFilter: defaultTaskStatusFilter(settings.enableTriStateCheckboxes),
    sortBy: settings.defaultSortBy,
    sortDirection: settings.defaultSortDirection,
    expandedProjectPaths: [],
  };
}

export function createDefaultTasksSavedView(settings: ProjectSettings): SavedTasksView {
  return {
    id: makeSavedViewId("tasks"),
    name: "Default",
    tab: "tasks",
    columnIds: TASK_GRID_COLUMNS.map((column) => column.id),
    taskStatusFilter: defaultTaskStatusFilter(settings.enableTriStateCheckboxes),
    taskPriorityFilter: [...TASK_PRIORITY_ORDER, "none"],
    timingFilter: [...DEFAULT_TASK_TIMING_FILTER],
    sortBy: "due",
    sortDirection: "asc",
  };
}

export function createDefaultKanbanSavedView(settings: ProjectSettings, area: AreaConfig): SavedKanbanView {
  const statuses = resolveStatusesForArea(settings, area.id);
  return {
    id: makeSavedViewId("kanban"),
    name: "Default",
    tab: "kanban",
    statusOrder: [...statuses],
    hiddenStatuses: settings.kanbanHiddenStatuses.filter((status) => statuses.includes(status)),
    cardFieldIds: resolveDefaultKanbanCardFieldIds(settings, area.id, area),
    nextTaskCount: resolveDefaultKanbanNextTaskCount(settings, area.id),
    timingFilter: [...PROJECT_TIMING_OPTIONS],
  };
}

export function ensureSavedViewsForArea(settings: ProjectSettings, area: AreaConfig): boolean {
  let changed = false;
  const existing = settings.savedViewsByArea[area.id] ?? makeEmptyAreaSavedViews();

  if (!settings.savedViewsByArea[area.id]) {
    settings.savedViewsByArea[area.id] = existing;
    changed = true;
  }

  if (existing.projects.length === 0) {
    existing.projects.push(createDefaultProjectsSavedView(settings, area));
    changed = true;
  }

  if (existing.tasks.length === 0) {
    existing.tasks.push(createDefaultTasksSavedView(settings));
    changed = true;
  }

  if (existing.kanban.length === 0) {
    existing.kanban.push(createDefaultKanbanSavedView(settings, area));
    changed = true;
  }

  settings.activeSavedViewIdsByArea[area.id] = settings.activeSavedViewIdsByArea[area.id] ?? {};
  const activeByTab = settings.activeSavedViewIdsByArea[area.id];

  if (!activeByTab.projects || !existing.projects.some((view) => view.id === activeByTab.projects)) {
    activeByTab.projects = existing.projects[0]?.id;
    changed = true;
  }

  if (!activeByTab.tasks || !existing.tasks.some((view) => view.id === activeByTab.tasks)) {
    activeByTab.tasks = existing.tasks[0]?.id;
    changed = true;
  }

  if (!activeByTab.kanban || !existing.kanban.some((view) => view.id === activeByTab.kanban)) {
    activeByTab.kanban = existing.kanban[0]?.id;
    changed = true;
  }

  return changed;
}

export function getSavedViewsForTab(settings: ProjectSettings, areaId: string | null, tab: SavedViewTab): SavedView[] {
  if (!areaId) {
    return [];
  }

  const views = settings.savedViewsByArea[areaId] ?? makeEmptyAreaSavedViews();
  if (tab === "projects") {
    return views.projects;
  }
  if (tab === "tasks") {
    return views.tasks;
  }
  return views.kanban;
}

export function getActiveSavedViewId(settings: ProjectSettings, areaId: string | null, tab: SavedViewTab): string | null {
  if (!areaId) {
    return null;
  }

  return settings.activeSavedViewIdsByArea[areaId]?.[tab] ?? null;
}

export function isDefaultSavedView(view: SavedView): boolean {
  return view.name.trim() === "Default";
}

export function findSavedView(settings: ProjectSettings, areaId: string | null, tab: SavedViewTab, viewId: string | null): SavedView | null {
  if (!viewId) {
    return null;
  }

  const views = getSavedViewsForTab(settings, areaId, tab);
  return views.find((view) => view.id === viewId) ?? null;
}

export function buildSavedViewListItems(views: SavedView[]): SavedViewListItem[] {
  const counts = new Map<string, number>();
  const names = new Map<string, number>();
  for (const view of views) {
    counts.set(view.name, (counts.get(view.name) ?? 0) + 1);
  }

  return views.map((view) => {
    const count = counts.get(view.name) ?? 0;
    const seen = (names.get(view.name) ?? 0) + 1;
    names.set(view.name, seen);
    return {
      id: view.id,
      name: view.name,
      label: count > 1 ? `${view.name} (${seen})` : view.name,
      deletable: !isDefaultSavedView(view),
    };
  });
}

export function appendRestoredDefaultView(settings: ProjectSettings, area: AreaConfig, tab: SavedViewTab): SavedView {
  const views = settings.savedViewsByArea[area.id] ?? (settings.savedViewsByArea[area.id] = makeEmptyAreaSavedViews());
  let created: SavedView;

  if (tab === "projects") {
    created = createDefaultProjectsSavedView(settings, area);
    views.projects = [created, ...views.projects];
  } else if (tab === "tasks") {
    created = createDefaultTasksSavedView(settings);
    views.tasks = [created, ...views.tasks];
  } else {
    created = createDefaultKanbanSavedView(settings, area);
    views.kanban = [created, ...views.kanban];
  }

  return created;
}
