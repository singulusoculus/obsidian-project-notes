export type IncludeMode = "top-level" | "recursive";

export type OpenTarget =
  | "new-tab"
  | "left-sidebar"
  | "right-sidebar"
  | "left-split"
  | "right-split"
  | "bottom-split";

export type BoardType = "grid" | "kanban";
export type ViewVariant = "custom" | "bases";
export type SortDirection = "asc" | "desc";

export type ProjectSortField =
  | "project"
  | "custom-name"
  | "status"
  | "priority"
  | "start-date"
  | "finish-date"
  | "due-date"
  | "tags"
  | "parent-project"
  | "requester"
  | "created-at"
  | "updated-at";

export interface AreaConfig {
  id: string;
  name: string;
  slug: string;
  folderPath: string;
  includeMode: IncludeMode;
  statusOverrides?: string[];
  priorityOverrides?: string[];
}

export interface ProjectSettings {
  areas: AreaConfig[];
  statuses: string[];
  priorities: string[];
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
  line: number;
  text: string;
  checked: boolean;
  startDate: string | null;
  dueDate: string | null;
  finishedDate: string | null;
  rawLine: string;
}

export interface ProjectNote {
  path: string;
  title: string;
  areaId: string;
  areaName: string;
  customName: string;
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
  checked: boolean;
}

export interface AddTaskRequest {
  projectPath: string;
  text: string;
  startDate: string;
  dueDate: string | null;
}
