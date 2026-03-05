export interface FrontmatterSplit {
  frontmatter: string;
  body: string;
  frontmatterLineCount: number;
}

export interface SectionBlock {
  heading: string;
  title: string;
  titleNormalized: string;
  lines: string[];
}

const FRONTMATTER_REGEX = /^---\n[\s\S]*?\n---\n?/;

export function splitFrontmatter(content: string): FrontmatterSplit {
  const match = content.match(FRONTMATTER_REGEX);
  if (!match) {
    return {
      frontmatter: "",
      body: content,
      frontmatterLineCount: 0,
    };
  }

  const frontmatter = match[0];
  const frontmatterLineCount = frontmatter.split(/\r?\n/).length - 1;
  return {
    frontmatter,
    body: content.slice(frontmatter.length),
    frontmatterLineCount,
  };
}

export function splitPreambleAndRest(body: string): { preambleLines: string[]; restLines: string[] } {
  const lines = body.split(/\r?\n/);
  const firstHeadingIndex = lines.findIndex((line) => /^\s*#{1,6}\s+\S/.test(line));

  if (firstHeadingIndex === -1) {
    return {
      preambleLines: lines,
      restLines: [],
    };
  }

  return {
    preambleLines: lines.slice(0, firstHeadingIndex),
    restLines: lines.slice(firstHeadingIndex),
  };
}

export function parseH2Sections(lines: string[]): { prefixLines: string[]; sections: SectionBlock[] } {
  const firstH2Index = lines.findIndex((line) => /^##\s+\S/.test(line));

  if (firstH2Index === -1) {
    return {
      prefixLines: lines,
      sections: [],
    };
  }

  const prefixLines = lines.slice(0, firstH2Index);
  const sectionLines = lines.slice(firstH2Index);

  const sections: SectionBlock[] = [];
  let current: SectionBlock | null = null;

  for (const line of sectionLines) {
    const match = line.match(/^##\s+(.+)\s*$/);
    if (match) {
      if (current) {
        sections.push(current);
      }

      const title = match[1].trim();
      current = {
        heading: line,
        title,
        titleNormalized: title.toLowerCase(),
        lines: [line],
      };
      continue;
    }

    if (!current) {
      // Should not happen due to firstH2Index, but preserve content safely.
      current = {
        heading: "## Misc",
        title: "Misc",
        titleNormalized: "misc",
        lines: ["## Misc", line],
      };
      continue;
    }

    current.lines.push(line);
  }

  if (current) {
    sections.push(current);
  }

  return {
    prefixLines,
    sections,
  };
}

function trimOuterBlank(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;

  while (start < end && lines[start].trim() === "") {
    start += 1;
  }

  while (end > start && lines[end - 1].trim() === "") {
    end -= 1;
  }

  return lines.slice(start, end);
}

export function joinBlocksWithSpacing(blocks: string[][]): string {
  const sanitized = blocks
    .map((block) => trimOuterBlank(block))
    .filter((block) => block.length > 0);

  if (sanitized.length === 0) {
    return "";
  }

  return `${sanitized.map((block) => block.join("\n")).join("\n\n")}\n`;
}
