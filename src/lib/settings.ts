import { DEFAULT_SETTINGS } from "./constants";
import type { AreaConfig, PluginPersistedData, ProjectSettings } from "./types";
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

  return normalized;
}

export function makeNewArea(): AreaConfig {
  const id = uniqueId("area");
  return {
    id,
    name: "",
    slug: "",
    folderPath: "",
    includeMode: "recursive",
  };
}

export function parseSettings(data: Partial<ProjectSettings> | undefined): ProjectSettings {
  const merged: ProjectSettings = {
    ...DEFAULT_SETTINGS,
    ...(data ?? {}),
    areas: [],
    statuses: normalizeList(data?.statuses, DEFAULT_SETTINGS.statuses),
    priorities: normalizeList(data?.priorities, DEFAULT_SETTINGS.priorities),
    defaultProjectStatuses: normalizeList(data?.defaultProjectStatuses, DEFAULT_SETTINGS.defaultProjectStatuses),
    kanbanHiddenStatuses: normalizeList(data?.kanbanHiddenStatuses, DEFAULT_SETTINGS.kanbanHiddenStatuses),
  };

  const rawAreas = Array.isArray(data?.areas) ? data?.areas : [];
  const normalizedAreas = rawAreas
    .map((area) => normalizeArea(area))
    .filter((area): area is AreaConfig => area !== null);

  merged.areas = normalizedAreas;

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
