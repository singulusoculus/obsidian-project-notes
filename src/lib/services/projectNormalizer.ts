import type { App, TFile } from "obsidian";
import type { AreaConfig, ProjectSettings } from "../types";
import { joinBlocksWithSpacing, parseH2Sections, splitFrontmatter, splitPreambleAndRest } from "../utils/markdown";
import { canonicalPropertyName, resolveAreaPropertyTemplates, resolvePropertyDefaultValue } from "../utils/properties";

export class ProjectNormalizer {
  private readonly app: App;
  private readonly getSettings: () => ProjectSettings;
  private readonly inFlight = new Set<string>();

  constructor(app: App, getSettings: () => ProjectSettings) {
    this.app = app;
    this.getSettings = getSettings;
  }

  isNormalizing(path: string): boolean {
    return this.inFlight.has(path);
  }

  async normalizeFile(file: TFile, area: AreaConfig): Promise<boolean> {
    if (this.inFlight.has(file.path)) {
      return false;
    }

    this.inFlight.add(file.path);

    try {
      const templates = resolveAreaPropertyTemplates(this.getSettings(), area);
      let frontmatterChanged = false;
      await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
        const existingNames = new Set<string>(
          Object.keys(frontmatter).map((name) => canonicalPropertyName(name)),
        );

        for (const template of templates) {
          const key = canonicalPropertyName(template.name);
          if (existingNames.has(key)) {
            continue;
          }

          frontmatter[template.name] = resolvePropertyDefaultValue(template, area, file);
          existingNames.add(key);
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
