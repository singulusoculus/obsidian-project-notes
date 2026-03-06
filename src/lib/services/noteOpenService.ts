import { type App, MarkdownView, TFile, type WorkspaceLeaf } from "obsidian";
import type { OpenTarget } from "../types";

export class NoteOpenService {
  private readonly app: App;
  private readonly getOpenTarget: () => OpenTarget;
  private readonly managedLeaves = new Map<OpenTarget, WorkspaceLeaf>();

  constructor(app: App, getOpenTarget: () => OpenTarget) {
    this.app = app;
    this.getOpenTarget = getOpenTarget;
  }

  async openProject(path: string): Promise<boolean> {
    const leaf = await this.openProjectInTarget(path);
    return leaf !== null;
  }

  async openProjectLink(linkText: string, sourcePath?: string): Promise<boolean> {
    const normalized = this.normalizeLinkPath(linkText);
    if (!normalized) {
      return false;
    }

    const resolved = this.app.metadataCache.getFirstLinkpathDest(normalized, sourcePath ?? "");
    if (resolved instanceof TFile) {
      return this.openProject(resolved.path);
    }

    const direct = this.app.vault.getAbstractFileByPath(normalized);
    if (direct instanceof TFile) {
      return this.openProject(direct.path);
    }

    const withExtension = normalized.endsWith(".md") ? normalized : `${normalized}.md`;
    const fallback = this.app.vault.getAbstractFileByPath(withExtension);
    if (fallback instanceof TFile) {
      return this.openProject(fallback.path);
    }

    return false;
  }

  async openProjectTask(path: string, lineNumber: number): Promise<boolean> {
    const leaf = await this.openProjectInTarget(path);
    if (!leaf) {
      return false;
    }

    this.scheduleTaskHighlight(leaf, lineNumber);
    return true;
  }

  private async openProjectInTarget(path: string): Promise<WorkspaceLeaf | null> {
    const abstractFile = this.app.vault.getAbstractFileByPath(path);
    if (!(abstractFile instanceof TFile)) {
      return null;
    }

    const target = this.getOpenTarget();
    let leaf = this.getTargetLeaf(target);
    try {
      await leaf.openFile(abstractFile, { active: true });
    } catch (error) {
      this.managedLeaves.delete(target);
      leaf = this.getTargetLeaf(target);
      await leaf.openFile(abstractFile, { active: true });
    }

    if (target !== "new-tab") {
      this.app.workspace.revealLeaf(leaf);
    }

    return leaf;
  }

  private scheduleTaskHighlight(leaf: WorkspaceLeaf, lineNumber: number): void {
    const targetLine = Math.max(0, lineNumber - 1);
    const attemptDelays = [0, 120, 300];

    for (const delay of attemptDelays) {
      window.setTimeout(() => {
        this.highlightTaskLine(leaf, targetLine);
      }, delay);
    }
  }

  private normalizeLinkPath(linkText: string): string {
    const text = linkText.trim();
    const wikiMatch = text.match(/^\[\[([^\]]+)\]\]$/u);
    const inner = wikiMatch ? wikiMatch[1] : text;
    const withoutAlias = inner.split("|", 1)[0] ?? "";
    const withoutHeading = withoutAlias.split("#", 1)[0] ?? "";
    return withoutHeading.trim();
  }

  private highlightTaskLine(leaf: WorkspaceLeaf, lineNumber: number): void {
    const view = leaf.view;
    if (!(view instanceof MarkdownView)) {
      return;
    }

    const editor = view.editor;
    if (!editor || editor.lineCount() === 0) {
      return;
    }

    const maxLine = Math.max(0, editor.lineCount() - 1);
    const clampedLine = Math.min(lineNumber, maxLine);
    const lineText = editor.getLine(clampedLine) ?? "";
    const from = { line: clampedLine, ch: 0 };
    const to = { line: clampedLine, ch: lineText.length };

    editor.setSelection(from, to);
    editor.scrollIntoView({ from, to }, true);

    window.setTimeout(() => {
      const currentView = leaf.view;
      if (!(currentView instanceof MarkdownView)) {
        return;
      }

      const currentEditor = currentView.editor;
      if (!currentEditor || currentEditor.lineCount() === 0) {
        return;
      }

      const currentMax = Math.max(0, currentEditor.lineCount() - 1);
      const currentLine = Math.min(clampedLine, currentMax);
      currentEditor.setCursor({ line: currentLine, ch: 0 });
    }, 1200);
  }

  private getTargetLeaf(target: OpenTarget): WorkspaceLeaf {
    if (target === "new-tab") {
      return this.app.workspace.getLeaf("tab");
    }

    const existingLeaf = this.managedLeaves.get(target);
    if (existingLeaf && this.isLeafAttached(existingLeaf)) {
      return existingLeaf;
    }
    this.managedLeaves.delete(target);

    const activeLeaf = this.app.workspace.getMostRecentLeaf() ?? this.app.workspace.getLeaf();
    let leaf: WorkspaceLeaf;

    if (target === "left-sidebar") {
      leaf = this.app.workspace.getLeftLeaf(false) ?? this.app.workspace.getLeftLeaf(true) ?? this.app.workspace.getLeaf("split");
    } else if (target === "right-sidebar") {
      leaf =
        this.app.workspace.getRightLeaf(false) ??
        this.app.workspace.getRightLeaf(true) ??
        this.app.workspace.getLeaf("split");
    } else if (target === "left-split") {
      leaf =
        this.app.workspace.createLeafBySplit?.(activeLeaf, "vertical", true) ??
        this.app.workspace.getLeaf("split");
    } else if (target === "right-split") {
      leaf =
        this.app.workspace.createLeafBySplit?.(activeLeaf, "vertical", false) ??
        this.app.workspace.getLeaf("split");
    } else {
      leaf =
        this.app.workspace.createLeafBySplit?.(activeLeaf, "horizontal", false) ??
        this.app.workspace.getLeaf("split");
    }

    this.managedLeaves.set(target, leaf);
    return leaf;
  }

  private isLeafAttached(leaf: WorkspaceLeaf): boolean {
    let found = false;
    this.app.workspace.iterateAllLeaves((candidate) => {
      if (candidate === leaf) {
        found = true;
      }
    });

    return found;
  }
}
