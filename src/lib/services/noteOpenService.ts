import { type App, TFile, type WorkspaceLeaf } from "obsidian";
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
    const abstractFile = this.app.vault.getAbstractFileByPath(path);
    if (!(abstractFile instanceof TFile)) {
      return false;
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

    return true;
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
