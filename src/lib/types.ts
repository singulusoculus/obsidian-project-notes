export type IncludeMode = "top-level" | "recursive";
export type StartupView =
  | "none"
  | "project-notes-grid"
  | "project-notes-kanban";

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

export interface ProjectPropertyTemplate {
  name: string;
  type: ProjectPropertyType;
  defaultValue: string;
}

export type ProjectSortField =
  | "project"
  | "status"
  | "priority"
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
  enableTriStateCheckboxes: boolean;
  startupView: StartupView;
  openTarget: OpenTarget;
  defaultProjectStatuses: string[];
  defaultSortBy: ProjectSortField;
  defaultSortDirection: SortDirection;
  kanbanHiddenStatuses: string[];
  cacheReconcileMinutes: number;
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
  startDate: string | null;
  finishDate: string | null;
  dueDate: string | null;
  tags: string[];
  parentProject: string | null;
  requester: string[];
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

export interface ProjectViewState {
  areas: AreaConfig[];
  currentAreaId: string | null;
  statuses: string[];
  priorities: string[];
  boardType: BoardType;
  variant: ViewVariant;
  gridTab: "projects" | "tasks";
  projectSearch: string;
  taskSearch: string;
  statusFilter: string[];
  priorityFilter: string[];
  areaTagFilter: string[];
  availableAreaTags: string[];
  sortBy: ProjectSortField;
  sortDirection: SortDirection;
  projects: ProjectNote[];
  tasks: ProjectTask[];
  showCompletedTasksInTaskView: boolean;
  triStateCheckboxes: boolean;
  hiddenKanbanStatuses: string[];
  showHiddenKanban: boolean;
}

export interface PluginPersistedData {
  schemaVersion: number;
  settings: ProjectSettings;
  snapshot?: ProjectIndexSnapshot;
}

export interface ProjectMetadataUpdate {
  path: string;
  key: "status" | "priority";
  value: string;
}

export interface TaskToggleRequest {
  taskId: string;
  state: TaskState;
}

export interface AddTaskRequest {
  projectPath: string;
  text: string;
  startDate: string;
  dueDate: string | null;
}
