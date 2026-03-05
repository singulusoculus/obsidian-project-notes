import type { App, TFile } from "obsidian";
import type { AreaConfig } from "../types";
import { joinBlocksWithSpacing, parseH2Sections, splitFrontmatter, splitPreambleAndRest } from "../utils/markdown";

function isNonEmptyString(input: unknown): input is string {
  return typeof input === "string" && input.trim().length > 0;
}

function firstStringValue(input: unknown): string | null {
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

export class ProjectNormalizer {
  private readonly app: App;
  private readonly inFlight = new Set<string>();

  constructor(app: App) {
    this.app = app;
  }

  isNormalizing(path: string): boolean {
    return this.inFlight.has(path);
  }

  async normalizeFile(file: TFile, _area: AreaConfig): Promise<boolean> {
    if (this.inFlight.has(file.path)) {
      return false;
    }

    this.inFlight.add(file.path);

    try {
      let frontmatterChanged = false;
      await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
        if (!isNonEmptyString(frontmatter["custom-name"])) {
          frontmatter["custom-name"] = file.basename;
          frontmatterChanged = true;
        }

        const statusValue = firstStringValue(frontmatter.status) ?? "To Do";
        if (!Array.isArray(frontmatter.status) || frontmatter.status[0] !== statusValue || frontmatter.status.length !== 1) {
          frontmatter.status = [statusValue];
          frontmatterChanged = true;
        }

        const priorityValue = firstStringValue(frontmatter.priority) ?? "Medium";
        if (
          !Array.isArray(frontmatter.priority) ||
          frontmatter.priority[0] !== priorityValue ||
          frontmatter.priority.length !== 1
        ) {
          frontmatter.priority = [priorityValue];
          frontmatterChanged = true;
        }

        if (!("start-date" in frontmatter)) {
          frontmatter["start-date"] = null;
          frontmatterChanged = true;
        }

        if (!("finish-date" in frontmatter)) {
          frontmatter["finish-date"] = null;
          frontmatterChanged = true;
        }

        if (!("due-date" in frontmatter)) {
          frontmatter["due-date"] = null;
          frontmatterChanged = true;
        }

        if (!("parent-project" in frontmatter)) {
          frontmatter["parent-project"] = "";
          frontmatterChanged = true;
        }

        if (!Array.isArray(frontmatter.requester)) {
          const requesterValue = firstStringValue(frontmatter.requester);
          frontmatter.requester = requesterValue ? [requesterValue] : [];
          frontmatterChanged = true;
        }

        if (!isNonEmptyString(frontmatter["created-at"])) {
          frontmatter["created-at"] = new Date(file.stat.ctime).toISOString();
          frontmatterChanged = true;
        }

        if (!isNonEmptyString(frontmatter["updated-at"])) {
          frontmatter["updated-at"] = new Date(file.stat.mtime).toISOString();
          frontmatterChanged = true;
        }

      });

      const content = await this.app.vault.cachedRead(file);
      const { frontmatter, body } = splitFrontmatter(content);
      const normalizedBody = this.normalizeSections(body);

      if (normalizedBody !== body) {
        await this.app.vault.modify(file, `${frontmatter}${normalizedBody}`);
        return true;
      }

      return frontmatterChanged;
    } finally {
      this.inFlight.delete(file.path);
    }
  }

  private normalizeSections(body: string): string {
    const { preambleLines, restLines } = splitPreambleAndRest(body);
    const { prefixLines, sections } = parseH2Sections(restLines);

    const tasksSection = sections.find((section) => section.titleNormalized === "tasks");
    const hasNotes = sections.some((section) => section.titleNormalized === "notes");
    const hasLinks = sections.some((section) => section.titleNormalized === "links");

    const otherSections = sections.filter((section) => section.titleNormalized !== "tasks");

    const blocks: string[][] = [];
    if (preambleLines.length > 0) {
      blocks.push(preambleLines);
    }

    blocks.push(tasksSection ? tasksSection.lines : ["## Tasks", ""]);

    if (prefixLines.length > 0) {
      blocks.push(prefixLines);
    }

    for (const section of otherSections) {
      blocks.push(section.lines);
    }

    if (!hasNotes) {
      blocks.push(["## Notes", ""]);
    }

    if (!hasLinks) {
      blocks.push(["## Links", ""]);
    }

    return joinBlocksWithSpacing(blocks);
  }
}
