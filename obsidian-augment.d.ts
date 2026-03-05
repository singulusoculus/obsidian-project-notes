import "obsidian";

declare module "obsidian" {
  interface Workspace {
    createLeafBySplit?(leaf: WorkspaceLeaf, direction: "vertical" | "horizontal", before?: boolean): WorkspaceLeaf;
  }
}
