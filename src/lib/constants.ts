import type { ProjectPropertyTemplate, ProjectPropertyType, ProjectSettings } from "./types";

export const DEFAULT_STATUSES = [
  "To Do",
  "Doing",
  "Done",
  "Cancelled",
  "Awaiting Response",
];

export const DEFAULT_PRIORITIES = ["Low", "Medium", "High"];

export const LOCKED_PROPERTY_DEFAULTS: ProjectPropertyTemplate[] = [
  { name: "status", type: "multitext", defaultValue: "To Do" },
  { name: "priority", type: "multitext", defaultValue: "Medium" },
  { name: "start-date", type: "date", defaultValue: "" },
  { name: "finish-date", type: "date", defaultValue: "" },
  { name: "due-date", type: "date", defaultValue: "" },
];

export const LOCKED_PROPERTY_NAMES = new Set<string>(LOCKED_PROPERTY_DEFAULTS.map((property) => property.name.toLowerCase()));

export const DEFAULT_PROJECT_PROPERTIES: ProjectPropertyTemplate[] = [
  { name: "aliases", type: "aliases", defaultValue: "" },
  ...LOCKED_PROPERTY_DEFAULTS,
  { name: "parent-project", type: "text", defaultValue: "" },
  { name: "requester", type: "multitext", defaultValue: "" },
];

export const PROJECT_PROPERTY_TYPE_OPTIONS: Array<{ value: ProjectPropertyType; label: string }> = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "checkbox", label: "Checkbox" },
  { value: "date", label: "Date" },
  { value: "datetime", label: "Date & time" },
  { value: "multitext", label: "List" },
  { value: "tags", label: "Tags" },
  { value: "aliases", label: "Aliases" },
];

export const DEFAULT_VALUE_TOKENS: Array<{ token: string; description: string }> = [
  { token: "{{today}}", description: "Current date (YYYY-MM-DD)" },
  { token: "{{tomorrow}}", description: "Next date (YYYY-MM-DD)" },
  { token: "{{yesterday}}", description: "Previous date (YYYY-MM-DD)" },
  { token: "{{now}}", description: "Current datetime (YYYY-MM-DDTHH:mm)" },
  { token: "{{area-name}}", description: "Current Area name" },
  { token: "{{area-slug}}", description: "Current Area slug" },
  { token: "{{file-title}}", description: "Project note filename (without .md)" },
];

export const DEFAULT_SETTINGS: ProjectSettings = {
  areas: [],
  statuses: DEFAULT_STATUSES,
  priorities: DEFAULT_PRIORITIES,
  defaultProperties: DEFAULT_PROJECT_PROPERTIES,
  enableTriStateCheckboxes: true,
  startupView: "none",
  openTarget: "new-tab",
  defaultProjectStatuses: ["Doing", "Awaiting Response"],
  defaultSortBy: "due-date",
  defaultSortDirection: "asc",
  kanbanHiddenStatuses: ["Done", "Cancelled"],
  cacheReconcileMinutes: 10,
};

export const SNAPSHOT_VERSION = 3;

export const TASK_START_EMOJI = "🛫";
export const TASK_DUE_EMOJI = "📅";
export const TASK_FINISHED_EMOJI = "✅";

export const VIEW_TYPES = {
  grid: "project-notes-grid",
  kanban: "project-notes-kanban",
} as const;

export const UNKNOWN_STATUS = "Unknown";
