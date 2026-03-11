export type IncludeMode = "top-level" | "recursive";
export type StartupView =
  | "none"
  | "projects"
  | "tasks"
  | "kanban";

export type OpenTarget =
  | "new-tab"
  | "left-sidebar"
  | "right-sidebar"
  | "left-split"
  | "right-split"
  | "bottom-split";

export type BoardType = "grid" | "kanban";
export type ViewVariant = "default";
export type SortDirection = "asc" | "desc";
export type ProjectPropertyType = "text" | "number" | "checkbox" | "date" | "datetime" | "multitext" | "tags" | "aliases";
export type TaskState = "unchecked" | "in-progress" | "checked";
export type NoteTaskPriority = "low" | "medium" | "high" | "highest";
export type GridTab = "projects" | "tasks" | "kanban";
export type SavedViewTab = GridTab;
export type TaskSortField = "state" | "task" | "project" | "requester" | "scheduled" | "start" | "due" | "finish" | "timing";
export type TaskStatusFilterOption = "To Do" | "Doing" | "Done";
export type TaskPriorityFilterOption = NoteTaskPriority | "none";
export type TaskTimingFilterOption = "Current" | "Off Schedule" | "Due" | "Overdue" | "Tomorrow" | "Future" | "Needs Timing";
export type ProjectTimingFilterOption = TaskTimingFilterOption;
export type KanbanCardBaseFieldId =
  | "name"
  | "priority"
  | "timing-status"
  | "scheduled-date"
  | "start-date"
  | "due-date"
  | "finish-date"
  | "requester"
  | "count-tasks"
  | "next-tasks"
  | "notes";
export type ProjectGridBaseColumnId =
  | "project"
  | "status"
  | "priority"
  | "timing-status"
  | "scheduled-date"
  | "start-date"
  | "finish-date"
  | "due-date"
  | "tags"
  | "parent-project"
  | "requester";

export interface ProjectGridColumn {
  id: string;
  label: string;
  kind: "base" | "property";
  sortable: boolean;
  sortField?: ProjectSortField;
  propertyKey?: string;
}

export interface KanbanCardField {
  id: string;
  label: string;
  kind: "base" | "property";
  propertyKey?: string;
}

export interface TaskGridColumn {
  id: string;
  label: string;
  sortField: TaskSortField;
  hideable?: boolean;
}

export interface ProjectPropertyTemplate {
  name: string;
  type: ProjectPropertyType;
  defaultValue: string;
}

export type ProjectSortField =
  | "project"
  | "status"
  | "priority"
  | "timing-status"
  | "scheduled-date"
  | "start-date"
  | "finish-date"
  | "due-date"
  | "tags"
  | "parent-project"
  | "requester";

export interface AreaConfig {
  id: string;
  name: string;
  slug: string;
  folderPath: string;
  includeMode: IncludeMode;
  statusOverrides?: string[];
  priorityOverrides?: string[];
  propertyOverrides?: ProjectPropertyTemplate[];
  disabledPropertyNames?: string[];
}

export interface ProjectSettings {
  areas: AreaConfig[];
  statuses: string[];
  priorities: string[];
  defaultProperties: ProjectPropertyTemplate[];
  gridColumnsByArea: Record<string, string[]>;
  kanbanCardDefaultFieldIds: string[];
  kanbanCardFieldsByArea: Record<string, string[]>;
  kanbanCardDefaultNextTaskCount: number;
  kanbanCardNextTaskCountByArea: Record<string, number>;
  kanbanNotesPreviewWords: number;
  kanbanNotesPreviewLines: number;
  enableTriStateCheckboxes: boolean;
  enableTaskAutoSuggest: boolean;
  taskAutoSuggestMinMatch: number;
  taskAutoSuggestMaxSuggestions: number;
  startupView: StartupView;
  openTarget: OpenTarget;
  defaultProjectStatuses: string[];
  defaultSortBy: ProjectSortField;
  defaultSortDirection: SortDirection;
  kanbanHiddenStatuses: string[];
  cacheReconcileMinutes: number;
  savedViewsByArea: Record<string, AreaSavedViews>;
  activeSavedViewIdsByArea: Record<string, Partial<Record<SavedViewTab, string>>>;
}

export interface ProjectTask {
  id: string;
  projectPath: string;
  projectName: string;
  projectRequester: string[];
  line: number;
  text: string;
  state: TaskState;
  checked: boolean;
  priority: NoteTaskPriority | null;
  scheduledDate: string | null;
  startDate: string | null;
  dueDate: string | null;
  finishedDate: string | null;
  rawLine: string;
}

export interface ProjectNote {
  path: string;
  title: string;
  aliases: string[];
  displayName: string;
  areaId: string;
  areaName: string;
  status: string;
  statusIsUnknown: boolean;
  priority: string;
  scheduledDate: string | null;
  startDate: string | null;
  finishDate: string | null;
  dueDate: string | null;
  tags: string[];
  parentProject: string | null;
  requester: string[];
  customProperties: Record<string, string>;
  notesSectionText: string;
  createdAt: number;
  updatedAt: number;
  tasks: ProjectTask[];
}

export interface ProjectIndexSnapshot {
  version: number;
  generatedAt: number;
  projects: ProjectNote[];
}

export interface ProjectQuerySpec {
  areaId?: string | null;
  search?: string;
  statuses?: string[];
  priorities?: string[];
  areaTags?: string[];
  sortBy?: ProjectSortField;
  sortDirection?: SortDirection;
}

export interface TaskQuerySpec {
  areaId?: string | null;
  search?: string;
  includeCompleted?: boolean;
  sortBy?: "due-date" | "project" | "updated-at";
  sortDirection?: SortDirection;
}

export interface SavedViewBase {
  id: string;
  name: string;
  tab: SavedViewTab;
}

export interface SavedProjectsView extends SavedViewBase {
  tab: "projects";
  columnIds: string[];
  statusFilter: string[];
  priorityFilter: string[];
  timingFilter: ProjectTimingFilterOption[];
  taskStatusFilter: TaskStatusFilterOption[];
  sortBy: ProjectSortField;
  sortDirection: SortDirection;
  expandedProjectPaths: string[];
}

export interface SavedTasksView extends SavedViewBase {
  tab: "tasks";
  columnIds: string[];
  taskStatusFilter: TaskStatusFilterOption[];
  taskPriorityFilter: TaskPriorityFilterOption[];
  timingFilter: TaskTimingFilterOption[];
  sortBy: TaskSortField;
  sortDirection: SortDirection;
}

export interface SavedKanbanView extends SavedViewBase {
  tab: "kanban";
  statusOrder: string[];
  hiddenStatuses: string[];
  cardFieldIds: string[];
  nextTaskCount: number;
  timingFilter: ProjectTimingFilterOption[];
}

export interface AreaSavedViews {
  projects: SavedProjectsView[];
  tasks: SavedTasksView[];
  kanban: SavedKanbanView[];
}

export type SavedView = SavedProjectsView | SavedTasksView | SavedKanbanView;

export interface SavedViewListItem {
  id: string;
  name: string;
  label: string;
  deletable: boolean;
}

export interface SavedViewPromptResult {
  action: "update-current" | "save-new";
  name: string;
}

export interface ProjectViewState {
  areas: AreaConfig[];
  currentAreaId: string | null;
  statuses: string[];
  priorities: string[];
  boardType: BoardType;
  variant: ViewVariant;
  gridTab: GridTab;
  projectSearch: string;
  taskSearch: string;
  statusFilter: string[];
  priorityFilter: string[];
  projectTimingFilter: ProjectTimingFilterOption[];
  projectTaskStatusFilter: TaskStatusFilterOption[];
  projectExpandedPaths: string[];
  areaTagFilter: string[];
  availableAreaTags: string[];
  availableProjectGridColumns: ProjectGridColumn[];
  projectGridColumns: ProjectGridColumn[];
  projectColumnOrderIds: string[];
  availableTaskGridColumns: TaskGridColumn[];
  taskGridColumns: TaskGridColumn[];
  taskColumnOrderIds: string[];
  taskStatusFilter: TaskStatusFilterOption[];
  taskPriorityFilter: TaskPriorityFilterOption[];
  taskTimingFilter: TaskTimingFilterOption[];
  taskSortBy: TaskSortField;
  taskSortDirection: SortDirection;
  availableKanbanCardFields: KanbanCardField[];
  kanbanCardFields: KanbanCardField[];
  kanbanNextTaskCount: number;
  kanbanStatusOrder: string[];
  kanbanTimingFilter: ProjectTimingFilterOption[];
  kanbanNotesPreviewWords: number;
  kanbanNotesPreviewLines: number;
  sortBy: ProjectSortField;
  sortDirection: SortDirection;
  projects: ProjectNote[];
  projectStatusByPath: Record<string, string>;
  tasks: ProjectTask[];
  triStateCheckboxes: boolean;
  hiddenKanbanStatuses: string[];
  showHiddenKanban: boolean;
  savedViews: SavedViewListItem[];
  activeSavedViewId: string | null;
  activeSavedViewName: string;
}

export interface PluginPersistedData {
  schemaVersion: number;
  settings: ProjectSettings;
  snapshot?: ProjectIndexSnapshot;
}

export type ProjectMetadataKey =
  | "status"
  | "priority"
  | "scheduled-date"
  | "start-date"
  | "finish-date"
  | "due-date";

export interface ProjectMetadataUpdate {
  path: string;
  key: ProjectMetadataKey;
  value: string;
}

export interface TaskToggleRequest {
  taskId: string;
  state: TaskState;
}

export type TaskDateField = "scheduled" | "start" | "due" | "finish";

export interface TaskDateUpdateRequest {
  taskId: string;
  field: TaskDateField;
  value: string | null;
}

export interface AddTaskRequest {
  projectPath: string;
  text: string;
  scheduledDate: string;
  startDate: string | null;
  dueDate: string | null;
}
