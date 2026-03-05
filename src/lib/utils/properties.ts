import type { TFile } from "obsidian";
import { DEFAULT_PROJECT_PROPERTIES, LOCKED_PROPERTY_DEFAULTS, LOCKED_PROPERTY_NAMES, PROJECT_PROPERTY_TYPE_OPTIONS } from "../constants";
import type { AreaConfig, ProjectPropertyTemplate, ProjectPropertyType, ProjectSettings } from "../types";

const VALID_PROPERTY_TYPES = new Set<ProjectPropertyType>(PROJECT_PROPERTY_TYPE_OPTIONS.map((option) => option.value));

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function toIsoLocalDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function toIsoLocalDateTime(date: Date): string {
  return `${toIsoLocalDate(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function plusDays(base: Date, days: number): Date {
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  return next;
}

function parseCommaSeparated(value: string): string[] {
  return value
    .split(",")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

export function normalizePropertyName(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  if (trimmed.toLowerCase() === "custom-name") {
    return "aliases";
  }

  return trimmed;
}

export function canonicalPropertyName(value: string): string {
  return value.trim().toLowerCase();
}

export function isLockedPropertyName(value: string): boolean {
  return LOCKED_PROPERTY_NAMES.has(canonicalPropertyName(value));
}

export function normalizePropertyType(value: unknown): ProjectPropertyType {
  if (typeof value !== "string") {
    return "text";
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "list") {
    return "multitext";
  }

  if (normalized === "date-time") {
    return "datetime";
  }

  if (VALID_PROPERTY_TYPES.has(normalized as ProjectPropertyType)) {
    return normalized as ProjectPropertyType;
  }

  return "text";
}

export function normalizePropertyTemplate(raw: unknown): ProjectPropertyTemplate | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const candidate = raw as Partial<ProjectPropertyTemplate>;
  const name = normalizePropertyName(candidate.name);
  if (name.length === 0) {
    return null;
  }

  return {
    name,
    type: normalizePropertyType(candidate.type),
    defaultValue: typeof candidate.defaultValue === "string" ? candidate.defaultValue : "",
  };
}

function dedupeTemplates(templates: ProjectPropertyTemplate[]): ProjectPropertyTemplate[] {
  const deduped: ProjectPropertyTemplate[] = [];
  const indexByName = new Map<string, number>();

  for (const template of templates) {
    const canonical = canonicalPropertyName(template.name);
    const existingIndex = indexByName.get(canonical);
    if (existingIndex === undefined) {
      deduped.push(template);
      indexByName.set(canonical, deduped.length - 1);
      continue;
    }

    deduped[existingIndex] = template;
  }

  return deduped;
}

export function ensureLockedPropertyTemplates(templates: ProjectPropertyTemplate[]): ProjectPropertyTemplate[] {
  const lockedByName = new Map<string, ProjectPropertyTemplate>(
    LOCKED_PROPERTY_DEFAULTS.map((property) => [canonicalPropertyName(property.name), property]),
  );

  const normalized = dedupeTemplates(templates);
  const output: ProjectPropertyTemplate[] = [];
  const seen = new Set<string>();

  for (const template of normalized) {
    const canonical = canonicalPropertyName(template.name);
    if (seen.has(canonical)) {
      continue;
    }

    if (LOCKED_PROPERTY_NAMES.has(canonical)) {
      const locked = lockedByName.get(canonical);
      if (locked) {
        output.push({
          name: locked.name,
          type: locked.type,
          defaultValue: typeof template.defaultValue === "string" ? template.defaultValue : locked.defaultValue,
        });
        seen.add(canonical);
      }
      continue;
    }

    output.push(template);
    seen.add(canonical);
  }

  for (const locked of LOCKED_PROPERTY_DEFAULTS) {
    const canonical = canonicalPropertyName(locked.name);
    if (seen.has(canonical)) {
      continue;
    }
    output.push({ ...locked });
    seen.add(canonical);
  }

  return output;
}

export function normalizePropertyTemplateList(raw: unknown, fallback: ProjectPropertyTemplate[]): ProjectPropertyTemplate[] {
  const source = Array.isArray(raw) ? raw : fallback;
  const parsed = source
    .map((item) => normalizePropertyTemplate(item))
    .filter((item): item is ProjectPropertyTemplate => item !== null);

  if (parsed.length === 0) {
    return ensureLockedPropertyTemplates(DEFAULT_PROJECT_PROPERTIES.map((property) => ({ ...property })));
  }

  return ensureLockedPropertyTemplates(parsed);
}

export function normalizeDisabledPropertyNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const normalized = raw
    .map((value) => normalizePropertyName(value))
    .map((value) => canonicalPropertyName(value))
    .filter((value) => value.length > 0)
    .filter((value) => !LOCKED_PROPERTY_NAMES.has(value));

  return Array.from(new Set(normalized));
}

export function resolveAreaPropertyTemplates(settings: ProjectSettings, area: AreaConfig | null): ProjectPropertyTemplate[] {
  const globalTemplates = ensureLockedPropertyTemplates(
    (settings.defaultProperties ?? DEFAULT_PROJECT_PROPERTIES).map((property) => ({ ...property })),
  );

  const disabledGlobal = new Set<string>(
    (area?.disabledPropertyNames ?? [])
      .map((value) => canonicalPropertyName(value))
      .filter((value) => !LOCKED_PROPERTY_NAMES.has(value)),
  );

  const output: ProjectPropertyTemplate[] = [];
  const indexByName = new Map<string, number>();

  const upsert = (template: ProjectPropertyTemplate): void => {
    const canonical = canonicalPropertyName(template.name);
    const existingIndex = indexByName.get(canonical);
    if (existingIndex === undefined) {
      output.push(template);
      indexByName.set(canonical, output.length - 1);
      return;
    }

    output[existingIndex] = template;
  };

  for (const template of globalTemplates) {
    const canonical = canonicalPropertyName(template.name);
    if (disabledGlobal.has(canonical)) {
      continue;
    }
    upsert(template);
  }

  for (const override of area?.propertyOverrides ?? []) {
    const canonical = canonicalPropertyName(override.name);
    if (LOCKED_PROPERTY_NAMES.has(canonical)) {
      continue;
    }
    upsert(override);
  }

  return output;
}

export function buildConfiguredPropertyTypeMap(settings: ProjectSettings): Record<string, ProjectPropertyType> {
  const typeMap: Record<string, ProjectPropertyType> = {};

  for (const property of ensureLockedPropertyTemplates(settings.defaultProperties ?? DEFAULT_PROJECT_PROPERTIES)) {
    typeMap[property.name] = property.type;
  }

  for (const area of settings.areas) {
    for (const property of area.propertyOverrides ?? []) {
      const canonical = canonicalPropertyName(property.name);
      if (LOCKED_PROPERTY_NAMES.has(canonical)) {
        continue;
      }
      typeMap[property.name] = property.type;
    }
  }

  return typeMap;
}

function resolveDynamicTokens(value: string, area: AreaConfig, file: TFile): string {
  const now = new Date();
  const tokenValues: Record<string, string> = {
    today: toIsoLocalDate(now),
    date: toIsoLocalDate(now),
    tomorrow: toIsoLocalDate(plusDays(now, 1)),
    yesterday: toIsoLocalDate(plusDays(now, -1)),
    now: toIsoLocalDateTime(now),
    "area-name": area.name,
    "area-slug": area.slug,
    "file-title": file.basename,
    "file-name": file.basename,
  };

  return value.replace(/\{\{\s*([a-z0-9-]+)\s*\}\}/gi, (match, token) => {
    const key = String(token).toLowerCase();
    return key in tokenValues ? tokenValues[key] : match;
  });
}

export function resolvePropertyDefaultValue(template: ProjectPropertyTemplate, area: AreaConfig, file: TFile): unknown {
  const resolvedRaw = resolveDynamicTokens(template.defaultValue ?? "", area, file).trim();

  switch (template.type) {
    case "number": {
      if (resolvedRaw.length === 0) {
        return null;
      }
      const parsed = Number(resolvedRaw);
      return Number.isFinite(parsed) ? parsed : null;
    }
    case "checkbox": {
      if (resolvedRaw.length === 0) {
        return false;
      }

      const normalized = resolvedRaw.toLowerCase();
      if (["true", "1", "yes", "y", "on"].includes(normalized)) {
        return true;
      }

      if (["false", "0", "no", "n", "off"].includes(normalized)) {
        return false;
      }

      return false;
    }
    case "date": {
      if (resolvedRaw.length === 0) {
        return null;
      }

      return /^\d{4}-\d{2}-\d{2}/.test(resolvedRaw) ? resolvedRaw.slice(0, 10) : resolvedRaw;
    }
    case "datetime": {
      if (resolvedRaw.length === 0) {
        return null;
      }

      if (/^\d{4}-\d{2}-\d{2}$/.test(resolvedRaw)) {
        return `${resolvedRaw}T00:00`;
      }

      return resolvedRaw;
    }
    case "multitext":
    case "tags":
    case "aliases":
      return parseCommaSeparated(resolvedRaw);
    case "text":
    default:
      return resolvedRaw;
  }
}
