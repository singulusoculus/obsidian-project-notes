import {
  KANBAN_CARD_BASE_FIELDS,
  PROJECT_GRID_BASE_COLUMNS,
} from "../constants";
import type {
  AreaConfig,
  KanbanCardField,
  ProjectGridColumn,
  ProjectSettings,
} from "../types";
import { canonicalPropertyName, resolveAreaPropertyTemplates } from "./properties";

const RESERVED_PROJECT_COLUMN_PROPERTY_KEYS = new Set<string>([
  "aliases",
  "status",
  "priority",
  "scheduled-date",
  "start-date",
  "finish-date",
  "due-date",
  "tags",
  "parent-project",
  "requester",
]);

export function buildAvailableProjectGridColumns(
  settings: ProjectSettings,
  area: AreaConfig | null,
): ProjectGridColumn[] {
  const columns: ProjectGridColumn[] = PROJECT_GRID_BASE_COLUMNS.map((column) => ({ ...column }));
  const seen = new Set(columns.map((column) => column.id));

  for (const template of resolveAreaPropertyTemplates(settings, area)) {
    const key = canonicalPropertyName(template.name);
    if (RESERVED_PROJECT_COLUMN_PROPERTY_KEYS.has(key)) {
      continue;
    }

    const id = `property:${key}`;
    if (seen.has(id)) {
      continue;
    }

    columns.push({
      id,
      label: template.name,
      kind: "property",
      sortable: false,
      propertyKey: key,
    });
    seen.add(id);
  }

  return columns;
}

export function normalizeVisibleProjectColumnIds(columnIds: string[], availableColumns: ProjectGridColumn[]): string[] {
  const availableIds = new Set(availableColumns.map((column) => column.id));
  const deduped: string[] = [];
  for (const id of columnIds) {
    if (!availableIds.has(id)) {
      continue;
    }
    if (deduped.includes(id)) {
      continue;
    }
    deduped.push(id);
  }

  if (!deduped.includes("project") && availableIds.has("project")) {
    deduped.unshift("project");
  }

  return deduped;
}

export function resolveDefaultProjectGridColumnIds(
  settings: ProjectSettings,
  areaId: string | null,
  area: AreaConfig | null,
): string[] {
  const available = buildAvailableProjectGridColumns(settings, area);
  if (!areaId) {
    return normalizeVisibleProjectColumnIds(
      available.map((column) => column.id),
      available,
    );
  }

  const saved = settings.gridColumnsByArea[areaId];
  if (Array.isArray(saved) && saved.length > 0) {
    return normalizeVisibleProjectColumnIds(saved, available);
  }

  return normalizeVisibleProjectColumnIds(
    available.map((column) => column.id),
    available,
  );
}

export function buildAvailableKanbanCardFields(
  settings: ProjectSettings,
  area: AreaConfig | null,
): KanbanCardField[] {
  const fields: KanbanCardField[] = KANBAN_CARD_BASE_FIELDS.map((field) => ({ ...field }));
  const seen = new Set(fields.map((field) => field.id));

  for (const template of resolveAreaPropertyTemplates(settings, area)) {
    const key = canonicalPropertyName(template.name);
    if (RESERVED_PROJECT_COLUMN_PROPERTY_KEYS.has(key)) {
      continue;
    }

    const id = `property:${key}`;
    if (seen.has(id)) {
      continue;
    }

    fields.push({
      id,
      label: template.name,
      kind: "property",
      propertyKey: key,
    });
    seen.add(id);
  }

  return fields;
}

export function normalizeKanbanCardFieldIds(fieldIds: string[], availableFields: KanbanCardField[]): string[] {
  const availableIds = new Set(availableFields.map((field) => field.id));
  const deduped: string[] = [];
  for (const id of fieldIds) {
    if (!availableIds.has(id)) {
      continue;
    }
    if (deduped.includes(id)) {
      continue;
    }
    deduped.push(id);
  }

  if (!deduped.includes("name") && availableIds.has("name")) {
    deduped.unshift("name");
  }

  return deduped;
}

export function resolveDefaultKanbanCardFieldIds(
  settings: ProjectSettings,
  areaId: string | null,
  area: AreaConfig | null,
): string[] {
  const available = buildAvailableKanbanCardFields(settings, area);
  const sourceIds =
    areaId && settings.kanbanCardFieldsByArea[areaId] && settings.kanbanCardFieldsByArea[areaId].length > 0
      ? settings.kanbanCardFieldsByArea[areaId]
      : settings.kanbanCardDefaultFieldIds;
  return normalizeKanbanCardFieldIds(sourceIds, available);
}

export function normalizeKanbanNextTaskCount(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.max(1, Math.floor(value));
}

export function resolveDefaultKanbanNextTaskCount(settings: ProjectSettings, areaId: string | null): number {
  if (!areaId) {
    return normalizeKanbanNextTaskCount(settings.kanbanCardDefaultNextTaskCount);
  }

  const override = settings.kanbanCardNextTaskCountByArea[areaId];
  if (typeof override === "number" && Number.isFinite(override) && override >= 1) {
    return normalizeKanbanNextTaskCount(override);
  }

  return normalizeKanbanNextTaskCount(settings.kanbanCardDefaultNextTaskCount);
}

export function resolveStatusesForArea(settings: ProjectSettings, areaId: string | null): string[] {
  if (!areaId) {
    return [...settings.statuses];
  }

  const area = settings.areas.find((candidate) => candidate.id === areaId);
  if (!area || !area.statusOverrides || area.statusOverrides.length === 0) {
    return [...settings.statuses];
  }

  return [...area.statusOverrides];
}
