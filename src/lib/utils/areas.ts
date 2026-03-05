import type { AreaConfig } from "../types";
import { normalizeFolderPath } from "./text";

function isTopLevelMatch(filePath: string, normalizedFolder: string): boolean {
  const prefix = `${normalizedFolder}/`;
  if (!filePath.startsWith(prefix)) {
    return false;
  }

  const remainder = filePath.slice(prefix.length);
  return !remainder.includes("/");
}

function isRecursiveMatch(filePath: string, normalizedFolder: string): boolean {
  return filePath.startsWith(`${normalizedFolder}/`);
}

export function areaMatchesPath(area: AreaConfig, filePath: string): boolean {
  const normalizedFolder = normalizeFolderPath(area.folderPath);
  const normalizedPath = normalizeFolderPath(filePath);

  if (normalizedFolder.length === 0) {
    return false;
  }

  if (area.includeMode === "top-level") {
    return isTopLevelMatch(normalizedPath, normalizedFolder);
  }

  return isRecursiveMatch(normalizedPath, normalizedFolder);
}

export function resolveAreaForPath(areas: AreaConfig[], filePath: string): AreaConfig | null {
  const candidates = areas.filter((area) => areaMatchesPath(area, filePath));
  if (candidates.length === 0) {
    return null;
  }

  // Pick the most specific (deepest folder) in case areas overlap.
  candidates.sort((a, b) => normalizeFolderPath(b.folderPath).length - normalizeFolderPath(a.folderPath).length);
  return candidates[0];
}
