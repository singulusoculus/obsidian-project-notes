import { DEFAULT_SETTINGS } from "./constants";
import type { AreaConfig, PluginPersistedData, ProjectSettings } from "./types";
import {
  isLockedPropertyName,
  normalizeDisabledPropertyNames,
  normalizePropertyTemplateList,
} from "./utils/properties";
import { slugifyAreaName } from "./utils/text";

function uniqueId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${random}`;
}

function normalizeList(values: unknown, fallback: string[]): string[] {
  if (!Array.isArray(values)) {
    return [...fallback];
  }

  const normalized = values
    .map((value) => String(value).trim())
    .filter((value) => value.length > 0);

  return normalized.length > 0 ? normalized : [...fallback];
}

function normalizeGridColumnsByArea(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const normalized: Record<string, string[]> = {};

  for (const [areaId, candidate] of Object.entries(value as Record<string, unknown>)) {
    if (typeof areaId !== "string" || areaId.trim().length === 0 || !Array.isArray(candidate)) {
      continue;
    }

    const columns = candidate
      .map((entry) => String(entry).trim())
      .filter((entry) => entry.length > 0);

    if (columns.length > 0) {
      normalized[areaId] = Array.from(new Set(columns));
    }
  }

  return normalized;
}

function normalizeStringListRecord(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const normalized: Record<string, string[]> = {};
  for (const [key, candidate] of Object.entries(value as Record<string, unknown>)) {
    if (typeof key !== "string" || key.trim().length === 0 || !Array.isArray(candidate)) {
      continue;
    }

    const entries = candidate
      .map((entry) => String(entry).trim())
      .filter((entry) => entry.length > 0);

    if (entries.length > 0) {
      normalized[key] = Array.from(new Set(entries));
    }
  }

  return normalized;
}

function normalizePositiveInteger(value: unknown, fallback: number, minimum = 1): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const integer = Math.floor(parsed);
  if (integer < minimum) {
    return fallback;
  }

  return integer;
}

function normalizeNumberRecord(value: unknown, minimum = 1): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const normalized: Record<string, number> = {};
  for (const [key, candidate] of Object.entries(value as Record<string, unknown>)) {
    if (typeof key !== "string" || key.trim().length === 0) {
      continue;
    }

    const parsed = normalizePositiveInteger(candidate, -1, minimum);
    if (parsed >= minimum) {
      normalized[key] = parsed;
    }
  }

  return normalized;
}

function normalizeKanbanCardFieldIds(values: unknown, fallback: string[]): string[] {
  const parsed = normalizeList(values, fallback);
  const deduped = Array.from(new Set(parsed));
  if (!deduped.includes("name")) {
    deduped.unshift("name");
  }
  return deduped;
}

function normalizeArea(rawArea: Partial<AreaConfig>): AreaConfig | null {
  if (!rawArea.folderPath || !rawArea.name) {
    return null;
  }

  const name = String(rawArea.name).trim();
  const folderPath = String(rawArea.folderPath).trim().replace(/^\/+|\/+$/g, "");

  if (!name || !folderPath) {
    return null;
  }

  const id = rawArea.id && rawArea.id.trim().length > 0 ? rawArea.id : uniqueId("area");
  const slug = rawArea.slug && rawArea.slug.trim().length > 0 ? rawArea.slug : slugifyAreaName(name);

  const includeMode = rawArea.includeMode === "top-level" ? "top-level" : "recursive";

  const normalized: AreaConfig = {
    id,
    name,
    slug,
    folderPath,
    includeMode,
  };

  if (rawArea.statusOverrides && rawArea.statusOverrides.length > 0) {
    normalized.statusOverrides = normalizeList(rawArea.statusOverrides, []);
  }

  if (rawArea.priorityOverrides && rawArea.priorityOverrides.length > 0) {
    normalized.priorityOverrides = normalizeList(rawArea.priorityOverrides, []);
  }

  if (rawArea.propertyOverrides && rawArea.propertyOverrides.length > 0) {
    normalized.propertyOverrides = normalizePropertyTemplateList(rawArea.propertyOverrides, []).filter(
      (property) => !isLockedPropertyName(property.name),
    );
  }

  normalized.disabledPropertyNames = normalizeDisabledPropertyNames(rawArea.disabledPropertyNames);

  return normalized;
}

function normalizeSortBy(value: unknown): ProjectSettings["defaultSortBy"] {
  if (
    value === "project" ||
    value === "status" ||
    value === "priority" ||
    value === "timing-status" ||
    value === "start-date" ||
    value === "finish-date" ||
    value === "due-date" ||
    value === "tags" ||
    value === "parent-project" ||
    value === "requester"
  ) {
    return value;
  }

  if (value === "custom-name") {
    return "project";
  }

  return DEFAULT_SETTINGS.defaultSortBy;
}

function normalizeSortDirection(value: unknown): ProjectSettings["defaultSortDirection"] {
  return value === "desc" ? "desc" : "asc";
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  return fallback;
}

function normalizeStartupView(value: unknown): ProjectSettings["startupView"] {
  if (value === "none") {
    return "none";
  }

  if (value === "projects" || value === "tasks" || value === "kanban") {
    return value;
  }

  if (
    value === "project-notes-grid" ||
    value === "project-notes-grid-custom" ||
    value === "project-notes-grid-bases"
  ) {
    return "projects";
  }

  if (
    value === "project-notes-kanban" ||
    value === "project-notes-kanban-custom" ||
    value === "project-notes-kanban-bases"
  ) {
    return "kanban";
  }

  return DEFAULT_SETTINGS.startupView;
}

export function makeNewArea(): AreaConfig {
  const id = uniqueId("area");
  return {
    id,
    name: "",
    slug: "",
    folderPath: "",
    includeMode: "recursive",
    propertyOverrides: [],
    disabledPropertyNames: [],
  };
}

export function parseSettings(data: Partial<ProjectSettings> | undefined): ProjectSettings {
  const defaultKanbanCardFieldIds = normalizeKanbanCardFieldIds(
    DEFAULT_SETTINGS.kanbanCardDefaultFieldIds,
    DEFAULT_SETTINGS.kanbanCardDefaultFieldIds,
  );
  const merged: ProjectSettings = {
    ...DEFAULT_SETTINGS,
    ...(data ?? {}),
    areas: [],
    statuses: normalizeList(data?.statuses, DEFAULT_SETTINGS.statuses),
    priorities: normalizeList(data?.priorities, DEFAULT_SETTINGS.priorities),
    defaultProperties: normalizePropertyTemplateList(data?.defaultProperties, DEFAULT_SETTINGS.defaultProperties),
    gridColumnsByArea: normalizeGridColumnsByArea(data?.gridColumnsByArea),
    kanbanCardDefaultFieldIds: normalizeKanbanCardFieldIds(data?.kanbanCardDefaultFieldIds, defaultKanbanCardFieldIds),
    kanbanCardFieldsByArea: normalizeStringListRecord(data?.kanbanCardFieldsByArea),
    kanbanCardDefaultNextTaskCount: normalizePositiveInteger(
      data?.kanbanCardDefaultNextTaskCount,
      DEFAULT_SETTINGS.kanbanCardDefaultNextTaskCount,
      1,
    ),
    kanbanCardNextTaskCountByArea: normalizeNumberRecord(data?.kanbanCardNextTaskCountByArea, 1),
    kanbanNotesPreviewWords: normalizePositiveInteger(data?.kanbanNotesPreviewWords, DEFAULT_SETTINGS.kanbanNotesPreviewWords, 1),
    kanbanNotesPreviewLines: normalizePositiveInteger(data?.kanbanNotesPreviewLines, DEFAULT_SETTINGS.kanbanNotesPreviewLines, 1),
    enableTriStateCheckboxes: normalizeBoolean(data?.enableTriStateCheckboxes, DEFAULT_SETTINGS.enableTriStateCheckboxes),
    startupView: normalizeStartupView(data?.startupView),
    defaultProjectStatuses: normalizeList(data?.defaultProjectStatuses, DEFAULT_SETTINGS.defaultProjectStatuses),
    defaultSortBy: normalizeSortBy(data?.defaultSortBy),
    defaultSortDirection: normalizeSortDirection(data?.defaultSortDirection),
    kanbanHiddenStatuses: normalizeList(data?.kanbanHiddenStatuses, DEFAULT_SETTINGS.kanbanHiddenStatuses),
  };

  const rawAreas = Array.isArray(data?.areas) ? data?.areas : [];
  const normalizedAreas = rawAreas
    .map((area) => normalizeArea(area))
    .filter((area): area is AreaConfig => area !== null);

  merged.areas = normalizedAreas;

  for (const area of merged.areas) {
    const override = merged.kanbanCardFieldsByArea[area.id];
    if (!override || override.length === 0) {
      continue;
    }

    const normalizedOverride = normalizeKanbanCardFieldIds(override, merged.kanbanCardDefaultFieldIds);
    merged.kanbanCardFieldsByArea[area.id] = normalizedOverride;
  }

  if (merged.cacheReconcileMinutes <= 0 || !Number.isFinite(merged.cacheReconcileMinutes)) {
    merged.cacheReconcileMinutes = DEFAULT_SETTINGS.cacheReconcileMinutes;
  }

  return merged;
}

export function parsePersistedData(raw: unknown): PluginPersistedData {
  const fallback: PluginPersistedData = {
    schemaVersion: 1,
    settings: parseSettings(DEFAULT_SETTINGS),
  };

  if (!raw || typeof raw !== "object") {
    return fallback;
  }

  const candidate = raw as Partial<PluginPersistedData>;

  return {
    schemaVersion: 1,
    settings: parseSettings(candidate.settings),
    snapshot: candidate.snapshot,
  };
}
