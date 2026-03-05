import { type App, TFile } from "obsidian";
import { UNKNOWN_STATUS, SNAPSHOT_VERSION } from "../constants";
import type {
  AddTaskRequest,
  AreaConfig,
  ProjectIndexSnapshot,
  ProjectMetadataUpdate,
  ProjectNote,
  ProjectQuerySpec,
  ProjectSettings,
  ProjectTask,
  TaskQuerySpec,
  TaskToggleRequest,
} from "../types";
import { ProjectNormalizer } from "./projectNormalizer";
import { TaskParser } from "./taskParser";
import { resolveAreaForPath } from "../utils/areas";
import {
  isIsoDate,
  normalizeArrayValue,
  normalizeListOrStringValue,
  normalizeStringValue,
} from "../utils/text";

interface ReconcileOptions {
  normalize: boolean;
}

interface FileChangeOptions {
  normalize: boolean;
  syncTaskCompletionMarkers: boolean;
}

export class ProjectIndexService {
  private readonly app: App;
  private readonly getSettings: () => ProjectSettings;
  private readonly normalizer: ProjectNormalizer;
  private readonly taskParser: TaskParser;
  private readonly onDirty: () => void;

  private readonly projectsByPath = new Map<string, ProjectNote>();
  private readonly tasksById = new Map<string, ProjectTask>();
  private readonly listeners = new Set<() => void>();

  constructor(
    app: App,
    getSettings: () => ProjectSettings,
    normalizer: ProjectNormalizer,
    taskParser: TaskParser,
    onDirty: () => void,
  ) {
    this.app = app;
    this.getSettings = getSettings;
    this.normalizer = normalizer;
    this.taskParser = taskParser;
    this.onDirty = onDirty;
  }

  async initialize(snapshot?: ProjectIndexSnapshot): Promise<void> {
    if (snapshot && snapshot.version === SNAPSHOT_VERSION) {
      for (const project of snapshot.projects) {
        this.projectsByPath.set(project.path, project);
      }
      this.rebuildTaskIndex();
      this.notify();
    }

    await this.reconcileAllAreas({ normalize: true });
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async reconcileAllAreas(options: ReconcileOptions = { normalize: false }): Promise<void> {
    const markdownFiles = this.app.vault.getMarkdownFiles();
    const seen = new Set<string>();
    let changed = false;

    for (const file of markdownFiles) {
      const fileChanged = await this.handleFileChange(file, {
        normalize: options.normalize,
        syncTaskCompletionMarkers: true,
      });
      if (fileChanged) {
        changed = true;
      }

      const area = this.resolveArea(file.path);
      if (area) {
        seen.add(file.path);
      }
    }

    for (const path of Array.from(this.projectsByPath.keys())) {
      if (!seen.has(path)) {
        this.projectsByPath.delete(path);
        changed = true;
      }
    }

    if (changed) {
      this.rebuildTaskIndex();
      this.notifyAndPersist();
    }
  }

  async onFileCreated(file: TFile): Promise<void> {
    const changed = await this.handleFileChange(file, { normalize: true, syncTaskCompletionMarkers: true });
    if (changed) {
      this.rebuildTaskIndex();
      this.notifyAndPersist();
    }
  }

  async onFileModified(file: TFile): Promise<void> {
    if (this.normalizer.isNormalizing(file.path) || this.taskParser.isSyncing(file.path)) {
      return;
    }

    const changed = await this.handleFileChange(file, { normalize: false, syncTaskCompletionMarkers: true });
    if (changed) {
      this.rebuildTaskIndex();
      this.notifyAndPersist();
    }
  }

  async onFileMetadataChanged(file: TFile): Promise<void> {
    if (this.normalizer.isNormalizing(file.path) || this.taskParser.isSyncing(file.path)) {
      return;
    }

    const changed = await this.handleFileChange(file, { normalize: false, syncTaskCompletionMarkers: true });
    if (changed) {
      this.rebuildTaskIndex();
      this.notifyAndPersist();
    }
  }

  onFileDeleted(path: string): void {
    if (!this.projectsByPath.has(path)) {
      return;
    }

    this.projectsByPath.delete(path);
    this.rebuildTaskIndex();
    this.notifyAndPersist();
  }

  async onFileRenamed(file: TFile, oldPath: string): Promise<void> {
    if (oldPath !== file.path && this.projectsByPath.has(oldPath)) {
      this.projectsByPath.delete(oldPath);
    }

    const changed = await this.handleFileChange(file, { normalize: true, syncTaskCompletionMarkers: true });
    if (changed || oldPath !== file.path) {
      this.rebuildTaskIndex();
      this.notifyAndPersist();
    }
  }

  queryProjects(spec: ProjectQuerySpec = {}): ProjectNote[] {
    const search = spec.search?.trim().toLowerCase() ?? "";
    const statusFilter = (spec.statuses ?? []).map((status) => status.toLowerCase());
    const priorityFilter = (spec.priorities ?? []).map((priority) => priority.toLowerCase());
    const areaTagFilter = (spec.areaTags ?? []).map((tag) => tag.toLowerCase());

    const filtered = Array.from(this.projectsByPath.values()).filter((project) => {
      if (spec.areaId && project.areaId !== spec.areaId) {
        return false;
      }

      if (statusFilter.length > 0 && !statusFilter.includes(project.status.toLowerCase())) {
        return false;
      }

      if (priorityFilter.length > 0 && !priorityFilter.includes(project.priority.toLowerCase())) {
        return false;
      }

      if (areaTagFilter.length > 0) {
        const lowerTags = project.tags.map((tag) => tag.toLowerCase());
        const hasAtLeastOne = areaTagFilter.some((tag) => lowerTags.includes(tag));
        if (!hasAtLeastOne) {
          return false;
        }
      }

      if (search.length > 0) {
        const searchable = [
          project.title,
          project.displayName,
          project.aliases.join(" "),
          project.status,
          project.priority,
          project.startDate ?? "",
          project.finishDate ?? "",
          project.dueDate ?? "",
          project.tags.join(" "),
          project.parentProject ?? "",
          project.requester.join(" "),
        ]
          .join(" ")
          .toLowerCase();

        if (!searchable.includes(search)) {
          return false;
        }
      }

      return true;
    });

    const sortBy = spec.sortBy ?? this.getSettings().defaultSortBy;
    const sortDirection = spec.sortDirection ?? this.getSettings().defaultSortDirection;

    filtered.sort((left, right) => this.compareProjects(left, right, sortBy, sortDirection));
    return filtered;
  }

  queryTasks(spec: TaskQuerySpec = {}): ProjectTask[] {
    const search = spec.search?.trim().toLowerCase() ?? "";
    const includeCompleted = spec.includeCompleted ?? false;

    let tasks = this.queryProjects({ areaId: spec.areaId }).flatMap((project) => project.tasks);

    if (!includeCompleted) {
      tasks = tasks.filter((task) => task.state !== "checked");
    }

    if (search.length > 0) {
      tasks = tasks.filter((task) => {
        const searchable = [
          task.text,
          task.projectName,
          (task.projectRequester ?? []).join(" "),
          task.startDate ?? "",
          task.dueDate ?? "",
          task.finishedDate ?? "",
        ]
          .join(" ")
          .toLowerCase();

        return searchable.includes(search);
      });
    }

    const sortBy = spec.sortBy ?? "due-date";
    const sortDirection = spec.sortDirection ?? "asc";
    tasks.sort((left, right) => this.compareTasks(left, right, sortBy, sortDirection));

    return tasks;
  }

  getAllProjects(): ProjectNote[] {
    return Array.from(this.projectsByPath.values());
  }

  notifyExternalChange(): void {
    this.notify();
  }

  getProject(path: string): ProjectNote | undefined {
    return this.projectsByPath.get(path);
  }

  getStatusesForArea(areaId: string | null): string[] {
    const settings = this.getSettings();
    if (!areaId) {
      return settings.statuses;
    }

    const area = settings.areas.find((candidate) => candidate.id === areaId);
    if (!area) {
      return settings.statuses;
    }

    if (area.statusOverrides && area.statusOverrides.length > 0) {
      return area.statusOverrides;
    }

    return settings.statuses;
  }

  getPrioritiesForArea(areaId: string | null): string[] {
    const settings = this.getSettings();
    if (!areaId) {
      return settings.priorities;
    }

    const area = settings.areas.find((candidate) => candidate.id === areaId);
    if (!area) {
      return settings.priorities;
    }

    if (area.priorityOverrides && area.priorityOverrides.length > 0) {
      return area.priorityOverrides;
    }

    return settings.priorities;
  }

  async updateProjectMetadata(update: ProjectMetadataUpdate): Promise<boolean> {
    const abstractFile = this.app.vault.getAbstractFileByPath(update.path);
    if (!(abstractFile instanceof TFile)) {
      return false;
    }

    await this.app.fileManager.processFrontMatter(abstractFile, (frontmatter) => {
      if (update.key === "status" || update.key === "priority") {
        frontmatter[update.key] = [update.value];
        return;
      }

      frontmatter[update.key] = update.value;
    });

    const changed = await this.handleFileChange(abstractFile, { normalize: false, syncTaskCompletionMarkers: false });
    if (changed) {
      this.rebuildTaskIndex();
      this.notifyAndPersist();
    }

    return changed;
  }

  async toggleTask(request: TaskToggleRequest): Promise<boolean> {
    const task = this.tasksById.get(request.taskId);
    if (!task) {
      return false;
    }

    const abstractFile = this.app.vault.getAbstractFileByPath(task.projectPath);
    if (!(abstractFile instanceof TFile)) {
      return false;
    }

    const changed = await this.taskParser.setTaskState(abstractFile, task, request.state);
    if (!changed) {
      return false;
    }

    const refreshed = await this.handleFileChange(abstractFile, { normalize: false, syncTaskCompletionMarkers: false });
    if (refreshed) {
      this.rebuildTaskIndex();
      this.notifyAndPersist();
    }

    return refreshed;
  }

  async addTask(request: AddTaskRequest): Promise<boolean> {
    const abstractFile = this.app.vault.getAbstractFileByPath(request.projectPath);
    if (!(abstractFile instanceof TFile)) {
      return false;
    }

    const area = this.resolveArea(abstractFile.path);
    if (!area) {
      return false;
    }

    await this.normalizer.normalizeFile(abstractFile, area);

    const changed = await this.taskParser.addTask(abstractFile, request);
    if (!changed) {
      return false;
    }

    const refreshed = await this.handleFileChange(abstractFile, { normalize: false, syncTaskCompletionMarkers: false });
    if (refreshed) {
      this.rebuildTaskIndex();
      this.notifyAndPersist();
    }

    return refreshed;
  }

  createSnapshot(): ProjectIndexSnapshot {
    return {
      version: SNAPSHOT_VERSION,
      generatedAt: Date.now(),
      projects: Array.from(this.projectsByPath.values()).sort((left, right) => left.path.localeCompare(right.path)),
    };
  }

  private async handleFileChange(file: TFile, options: FileChangeOptions): Promise<boolean> {
    const area = this.resolveArea(file.path);

    if (!area) {
      if (!this.projectsByPath.has(file.path)) {
        return false;
      }

      this.projectsByPath.delete(file.path);
      return true;
    }

    if (options.normalize) {
      await this.normalizer.normalizeFile(file, area);
    }

    if (options.syncTaskCompletionMarkers) {
      await this.taskParser.reconcileCompletedDateMarkers(file);
    }

    const parsed = await this.parseProject(file, area);
    const existing = this.projectsByPath.get(file.path);
    const changed = !existing || JSON.stringify(existing) !== JSON.stringify(parsed);

    if (!changed) {
      return false;
    }

    this.projectsByPath.set(file.path, parsed);
    return true;
  }

  private async parseProject(file: TFile, area: AreaConfig): Promise<ProjectNote> {
    const content = await this.app.vault.read(file);
    const fileCache = this.app.metadataCache.getFileCache(file);
    const frontmatter = (fileCache?.frontmatter as Record<string, unknown> | undefined) ?? {};

    const statuses = this.getStatusesForArea(area.id);
    const priorities = this.getPrioritiesForArea(area.id);

    const aliases = normalizeArrayValue(frontmatter.aliases);
    const displayName = aliases[0] ?? file.basename;
    const rawStatus = normalizeListOrStringValue(frontmatter.status) ?? "To Do";
    const statusIsUnknown = !statuses.includes(rawStatus);

    const rawPriority = normalizeListOrStringValue(frontmatter.priority) ?? priorities[0] ?? "Medium";
    const priority = priorities.includes(rawPriority) ? rawPriority : priorities[0] ?? "Medium";

    const tagSet = new Set<string>();

    for (const tag of normalizeArrayValue(frontmatter.tags)) {
      tagSet.add(tag.startsWith("#") ? tag.slice(1) : tag);
    }

    for (const tag of fileCache?.tags ?? []) {
      const normalized = tag.tag.startsWith("#") ? tag.tag.slice(1) : tag.tag;
      if (normalized.length > 0) {
        tagSet.add(normalized);
      }
    }

    const requester = normalizeArrayValue(frontmatter.requester);
    const parentProject = normalizeStringValue(frontmatter["parent-project"]);

    const startDate = normalizeStringValue(frontmatter["start-date"]);
    const finishDate = normalizeStringValue(frontmatter["finish-date"]);
    const dueDate = normalizeStringValue(frontmatter["due-date"]);

    const tasks = this.taskParser.parseTasks(content, file, displayName, requester);

    return {
      path: file.path,
      title: file.basename,
      aliases,
      displayName,
      areaId: area.id,
      areaName: area.name,
      status: statusIsUnknown ? UNKNOWN_STATUS : rawStatus,
      statusIsUnknown,
      priority,
      startDate: isIsoDate(startDate) ? startDate : null,
      finishDate: isIsoDate(finishDate) ? finishDate : null,
      dueDate: isIsoDate(dueDate) ? dueDate : null,
      tags: Array.from(tagSet),
      parentProject,
      requester,
      createdAt: file.stat.ctime,
      updatedAt: file.stat.mtime,
      tasks,
    };
  }

  private resolveArea(path: string): AreaConfig | null {
    return resolveAreaForPath(this.getSettings().areas, path);
  }

  private compareProjects(
    left: ProjectNote,
    right: ProjectNote,
    sortBy: ProjectQuerySpec["sortBy"],
    direction: ProjectQuerySpec["sortDirection"],
  ): number {
    const sortField = sortBy ?? this.getSettings().defaultSortBy;
    const sortDirection = direction ?? this.getSettings().defaultSortDirection;

    const leftValue = this.projectSortValue(left, sortField);
    const rightValue = this.projectSortValue(right, sortField);

    const compare = this.compareSortableValues(leftValue, rightValue);
    return sortDirection === "asc" ? compare : -compare;
  }

  private projectSortValue(project: ProjectNote, sortBy: NonNullable<ProjectQuerySpec["sortBy"]>): string | number | null {
    switch (sortBy) {
      case "project":
        return project.displayName;
      case "status":
        return project.status;
      case "priority":
        return project.priority;
      case "start-date":
        return project.startDate;
      case "finish-date":
        return project.finishDate;
      case "due-date":
        return project.dueDate;
      case "tags":
        return project.tags.join(" ");
      case "parent-project":
        return project.parentProject;
      case "requester":
        return project.requester.join(" ");
      default:
        return project.dueDate;
    }
  }

  private compareSortableValues(left: string | number | null, right: string | number | null): number {
    if (left === null && right === null) {
      return 0;
    }

    if (left === null) {
      return 1;
    }

    if (right === null) {
      return -1;
    }

    if (typeof left === "number" && typeof right === "number") {
      return left - right;
    }

    return String(left).localeCompare(String(right));
  }

  private compareTasks(
    left: ProjectTask,
    right: ProjectTask,
    sortBy: NonNullable<TaskQuerySpec["sortBy"]>,
    sortDirection: NonNullable<TaskQuerySpec["sortDirection"]>,
  ): number {
    const leftValue = this.taskSortValue(left, sortBy);
    const rightValue = this.taskSortValue(right, sortBy);
    const compare = this.compareSortableValues(leftValue, rightValue);

    return sortDirection === "asc" ? compare : -compare;
  }

  private taskSortValue(task: ProjectTask, sortBy: TaskQuerySpec["sortBy"]): string | number | null {
    if (sortBy === "project") {
      return task.projectName;
    }

    if (sortBy === "updated-at") {
      const project = this.projectsByPath.get(task.projectPath);
      return project?.updatedAt ?? null;
    }

    return task.dueDate;
  }

  private rebuildTaskIndex(): void {
    this.tasksById.clear();

    for (const project of this.projectsByPath.values()) {
      for (const task of project.tasks) {
        this.tasksById.set(task.id, task);
      }
    }
  }

  private notifyAndPersist(): void {
    this.notify();
    this.onDirty();
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
