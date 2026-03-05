import type { ProjectSettings } from "./types";

export const DEFAULT_STATUSES = [
  "To Do",
  "Doing",
  "Done",
  "Cancelled",
  "Awaiting Response",
];

export const DEFAULT_PRIORITIES = ["Low", "Medium", "High"];

export const DEFAULT_SETTINGS: ProjectSettings = {
  areas: [],
  statuses: DEFAULT_STATUSES,
  priorities: DEFAULT_PRIORITIES,
  openTarget: "new-tab",
  defaultProjectStatuses: ["Doing", "Awaiting Response"],
  defaultSortBy: "due-date",
  defaultSortDirection: "asc",
  kanbanHiddenStatuses: ["Done", "Cancelled"],
  cacheReconcileMinutes: 10,
};

export const SNAPSHOT_VERSION = 1;

export const TASK_START_EMOJI = "🛫";
export const TASK_DUE_EMOJI = "📅";
export const TASK_FINISHED_EMOJI = "✅";

export const VIEW_TYPES = {
  customGrid: "project-notes-grid-custom",
  customKanban: "project-notes-kanban-custom",
  basesGrid: "project-notes-grid-bases",
  basesKanban: "project-notes-kanban-bases",
} as const;

export const UNKNOWN_STATUS = "Unknown";

export const REQUIRED_PROPERTY_TYPES: Record<string, string> = {
  "custom-name": "text",
  status: "multitext",
  priority: "multitext",
  "start-date": "date",
  "finish-date": "date",
  "due-date": "date",
  tags: "tags",
  "parent-project": "text",
  requester: "multitext",
  "created-at": "datetime",
  "updated-at": "datetime",
};
