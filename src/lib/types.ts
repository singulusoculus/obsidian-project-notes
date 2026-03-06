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
export type ProjectGridBaseColumnId =
  | "project"
  | "status"
  | "priority"
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
  gridColumnsByArea: Record<string, string[]>;
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
  customProperties: Record<string, string>;
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
  gridTab: "projects" | "tasks" | "kanban";
  projectSearch: string;
  taskSearch: string;
  statusFilter: string[];
  priorityFilter: string[];
  areaTagFilter: string[];
  availableAreaTags: string[];
  availableProjectGridColumns: ProjectGridColumn[];
  projectGridColumns: ProjectGridColumn[];
  sortBy: ProjectSortField;
  sortDirection: SortDirection;
  projects: ProjectNote[];
  projectStatusByPath: Record<string, string>;
  tasks: ProjectTask[];
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
