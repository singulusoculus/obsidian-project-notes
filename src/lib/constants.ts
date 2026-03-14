import type {
  ProjectTimingFilterOption,
  KanbanCardField,
  NoteTaskPriority,
  ProjectGridColumn,
  ProjectPropertyTemplate,
  ProjectPropertyType,
  ProjectSettings,
  TaskGridColumn,
  TaskStatusFilterOption,
  TaskTimingFilterOption,
} from "./types";

export const DEFAULT_STATUSES = [
  "To Do",
  "Doing",
  "Ongoing",
  "Done",
  "Cancelled",
  "Awaiting Response",
];

export const DEFAULT_PRIORITIES = ["Low", "Medium", "High"];
export const PROJECT_NO_PRIORITY_TOKEN = "__project_no_priority__";
export const INFER_DATES_PROPERTY = "opn-infer-dates";

export const LOCKED_PROPERTY_DEFAULTS: ProjectPropertyTemplate[] = [
  { name: "status", type: "multitext", defaultValue: "To Do" },
  { name: "priority", type: "multitext", defaultValue: "" },
  { name: "scheduled-date", type: "date", defaultValue: "" },
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

export const PROJECT_GRID_BASE_COLUMNS: ProjectGridColumn[] = [
  { id: "project", label: "Project", kind: "base", sortable: true, sortField: "project" },
  { id: "status", label: "Status", kind: "base", sortable: true, sortField: "status" },
  { id: "priority", label: "Priority", kind: "base", sortable: true, sortField: "priority" },
  { id: "timing-status", label: "Timing", kind: "base", sortable: true, sortField: "timing-status" },
  { id: "scheduled-date", label: "Scheduled", kind: "base", sortable: true, sortField: "scheduled-date" },
  { id: "start-date", label: "Start", kind: "base", sortable: true, sortField: "start-date" },
  { id: "finish-date", label: "Finish", kind: "base", sortable: true, sortField: "finish-date" },
  { id: "due-date", label: "Due", kind: "base", sortable: true, sortField: "due-date" },
  { id: "tags", label: "Tags", kind: "base", sortable: true, sortField: "tags" },
  { id: "parent-project", label: "Parent", kind: "base", sortable: true, sortField: "parent-project" },
  { id: "requester", label: "Requester", kind: "base", sortable: true, sortField: "requester" },
];

export const KANBAN_CARD_BASE_FIELDS: KanbanCardField[] = [
  { id: "name", label: "Name", kind: "base" },
  { id: "timing-status", label: "Timing Status", kind: "base" },
  { id: "priority", label: "Priority", kind: "base" },
  { id: "scheduled-date", label: "Scheduled Date", kind: "base" },
  { id: "start-date", label: "Start Date", kind: "base" },
  { id: "due-date", label: "Due Date", kind: "base" },
  { id: "finish-date", label: "Finish Date", kind: "base" },
  { id: "requester", label: "Requester", kind: "base" },
  { id: "count-tasks", label: "Count Tasks", kind: "base" },
  { id: "next-tasks", label: "Next Task(s)", kind: "base" },
  { id: "notes", label: "Notes", kind: "base" },
];

export const DEFAULT_KANBAN_CARD_FIELD_IDS = ["name", "timing-status", "priority", "due-date", "count-tasks", "next-tasks"];

export const DEFAULT_SETTINGS: ProjectSettings = {
  areas: [],
  statuses: DEFAULT_STATUSES,
  priorities: DEFAULT_PRIORITIES,
  defaultProperties: DEFAULT_PROJECT_PROPERTIES,
  gridColumnsByArea: {},
  kanbanCardDefaultFieldIds: [...DEFAULT_KANBAN_CARD_FIELD_IDS],
  kanbanCardFieldsByArea: {},
  kanbanCardDefaultNextTaskCount: 1,
  kanbanCardNextTaskCountByArea: {},
  kanbanNotesPreviewWords: 100,
  kanbanNotesPreviewLines: 5,
  inferDates: false,
  enableTriStateCheckboxes: true,
  enableTaskAutoSuggest: true,
  taskAutoSuggestMinMatch: 0,
  taskAutoSuggestMaxSuggestions: 8,
  startupView: "none",
  openTarget: "new-tab",
  defaultProjectStatuses: ["Doing", "Awaiting Response", "Ongoing"],
  defaultSortBy: "due-date",
  defaultSortDirection: "asc",
  kanbanHiddenStatuses: ["Done", "Cancelled"],
  cacheReconcileMinutes: 10,
  savedViewsByArea: {},
  activeSavedViewIdsByArea: {},
};

export const SNAPSHOT_VERSION = 7;

export const TASK_SCHEDULED_EMOJI = "⏳";
export const TASK_START_EMOJI = "🛫";
export const TASK_DUE_EMOJI = "📅";
export const TASK_FINISHED_EMOJI = "✅";
export const TASK_PRIORITY_LOW_EMOJI = "🔵";
export const TASK_PRIORITY_MEDIUM_EMOJI = "🟢";
export const TASK_PRIORITY_HIGH_EMOJI = "🔴";
export const TASK_PRIORITY_HIGHEST_EMOJI = "🔥";

export const TASK_PRIORITY_ORDER: NoteTaskPriority[] = ["highest", "high", "medium", "low"];

export const TASK_PRIORITY_METADATA: Record<
  NoteTaskPriority,
  { emoji: string; label: string; searchTerms: string[]; lineClass: string }
> = {
  highest: {
    emoji: TASK_PRIORITY_HIGHEST_EMOJI,
    label: "Highest",
    searchTerms: ["highest", "fire", "urgent"],
    lineClass: "opn-task-priority-highest-line",
  },
  high: {
    emoji: TASK_PRIORITY_HIGH_EMOJI,
    label: "High",
    searchTerms: ["high", "red"],
    lineClass: "opn-task-priority-high-line",
  },
  medium: {
    emoji: TASK_PRIORITY_MEDIUM_EMOJI,
    label: "Medium",
    searchTerms: ["medium", "green"],
    lineClass: "opn-task-priority-medium-line",
  },
  low: {
    emoji: TASK_PRIORITY_LOW_EMOJI,
    label: "Low",
    searchTerms: ["low", "blue"],
    lineClass: "opn-task-priority-low-line",
  },
};

export const TASK_PRIORITY_EMOJIS = TASK_PRIORITY_ORDER.map((priority) => TASK_PRIORITY_METADATA[priority].emoji);

export const VIEW_TYPES = {
  grid: "project-notes-grid",
  kanban: "project-notes-kanban",
} as const;

export const UNKNOWN_STATUS = "Unknown";
export const FILTER_NONE_TOKEN = "__none__";
export const TRI_STATE_TASK_STATUS_OPTIONS: TaskStatusFilterOption[] = ["To Do", "Doing", "Done"];
export const BINARY_TASK_STATUS_OPTIONS: TaskStatusFilterOption[] = ["To Do", "Done"];
export const TASK_TIMING_OPTIONS: TaskTimingFilterOption[] = [
  "Current",
  "Today",
  "Off Schedule",
  "Due",
  "Overdue",
  "Tomorrow",
  "Future",
  "Needs Timing",
];
export const PROJECT_TIMING_OPTIONS: ProjectTimingFilterOption[] = [...TASK_TIMING_OPTIONS];
export const DEFAULT_TASK_TIMING_FILTER: TaskTimingFilterOption[] = [
  "Current",
  "Today",
  "Off Schedule",
  "Due",
  "Overdue",
  "Tomorrow",
  "Needs Timing",
];
export const TASK_GRID_COLUMNS: TaskGridColumn[] = [
  { id: "done", label: "Done", sortField: "state", hideable: true },
  { id: "task", label: "Task", sortField: "task", hideable: false },
  { id: "project", label: "Project", sortField: "project", hideable: true },
  { id: "requester", label: "Requester", sortField: "requester", hideable: true },
  { id: "scheduled", label: "Scheduled", sortField: "scheduled", hideable: true },
  { id: "start", label: "Start", sortField: "start", hideable: true },
  { id: "due", label: "Due", sortField: "due", hideable: true },
  { id: "finish", label: "Finish", sortField: "finish", hideable: true },
  { id: "timing", label: "Timing Status", sortField: "timing", hideable: true },
];
