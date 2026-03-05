export function slugifyAreaName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "area";
}

export function normalizeFolderPath(path: string): string {
  return path.trim().replace(/^\/+|\/+$/g, "");
}

export function normalizeArrayValue(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input
      .map((value) => String(value).trim())
      .filter((value) => value.length > 0);
  }

  if (typeof input === "string") {
    const trimmed = input.trim();
    return trimmed.length > 0 ? [trimmed] : [];
  }

  return [];
}

export function normalizeStringValue(input: unknown): string | null {
  if (typeof input !== "string") {
    return null;
  }

  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeListOrStringValue(input: unknown): string | null {
  if (typeof input === "string") {
    const trimmed = input.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (Array.isArray(input)) {
    for (const value of input) {
      if (typeof value !== "string") {
        continue;
      }

      const trimmed = value.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }

  return null;
}

export function isIsoDate(input: string | null | undefined): input is string {
  if (!input) {
    return false;
  }

  return /^\d{4}-\d{2}-\d{2}$/.test(input);
}

export function formatTimestamp(timestamp: number): string {
  if (!Number.isFinite(timestamp)) {
    return "";
  }

  return new Date(timestamp).toISOString().replace("T", " ").slice(0, 16);
}

export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}
