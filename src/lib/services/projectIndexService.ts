import { type App, TFile } from "obsidian";
import { UNKNOWN_STATUS, SNAPSHOT_VERSION } from "../constants";
import type {
  AddTaskRequest,
  AreaConfig,
  ProjectIndexSnapshot,
  ProjectMetadataKey,
  ProjectMetadataUpdate,
  ProjectNote,
  ProjectQuerySpec,
  ProjectSettings,
  TaskDateUpdateRequest,
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
  todayIsoDate,
} from "../utils/text";
import { canonicalPropertyName, resolveAreaPropertyTemplates } from "../utils/properties";
import { parseH2Sections, splitFrontmatter } from "../utils/markdown";

interface ReconcileOptions {
  normalize: boolean;
}

interface FileChangeOptions {
  normalize: boolean;
  syncTaskCompletionMarkers: boolean;
}

const RESERVED_PROJECT_PROPERTY_KEYS = new Set<string>([
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
          project.scheduledDate ?? "",
          project.startDate ?? "",
          project.finishDate ?? "",
          project.dueDate ?? "",
          project.tags.join(" "),
          project.parentProject ?? "",
          project.requester.join(" "),
          ...Object.values(project.customProperties ?? {}),
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
          task.scheduledDate ?? "",
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

    const area = this.resolveArea(abstractFile.path);
    const normalizedValue = update.value.trim();

    await this.app.fileManager.processFrontMatter(abstractFile, (frontmatter) => {
      const updates = this.buildProjectMetadataUpdates(frontmatter, update.key, normalizedValue, area?.id ?? null);
      for (const [key, value] of Object.entries(updates)) {
        if (this.isListMetadataKey(key as ProjectMetadataKey)) {
          frontmatter[key] = value;
          continue;
        }

        frontmatter[key] = value;
      }
    });

    const changed = await this.handleFileChange(abstractFile, { normalize: false, syncTaskCompletionMarkers: false });
    if (changed) {
      this.rebuildTaskIndex();
      this.notifyAndPersist();
    }

    return changed;
  }

  async updateTaskDate(request: TaskDateUpdateRequest): Promise<boolean> {
    const task = this.tasksById.get(request.taskId);
    if (!task) {
      return false;
    }

    const abstractFile = this.app.vault.getAbstractFileByPath(task.projectPath);
    if (!(abstractFile instanceof TFile)) {
      return false;
    }

    const changed = await this.taskParser.updateTaskDate(abstractFile, task, request.field, request.value);
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
    const changed = !existing || !this.projectsAreEquivalent(existing, parsed);

    if (!changed) {
      return false;
    }

    this.projectsByPath.set(file.path, parsed);
    return true;
  }

  private projectsAreEquivalent(left: ProjectNote, right: ProjectNote): boolean {
    const stableLeft = {
      ...left,
      createdAt: 0,
      updatedAt: 0,
    };
    const stableRight = {
      ...right,
      createdAt: 0,
      updatedAt: 0,
    };

    return JSON.stringify(stableLeft) === JSON.stringify(stableRight);
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
    const customProperties = this.extractCustomProperties(frontmatter, area);
    const notesSectionText = this.extractNotesSectionText(content);

    const startDate = normalizeStringValue(frontmatter["start-date"]);
    const scheduledDate = normalizeStringValue(frontmatter["scheduled-date"]);
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
      scheduledDate: isIsoDate(scheduledDate) ? scheduledDate : null,
      startDate: isIsoDate(startDate) ? startDate : null,
      finishDate: isIsoDate(finishDate) ? finishDate : null,
      dueDate: isIsoDate(dueDate) ? dueDate : null,
      tags: Array.from(tagSet),
      parentProject,
      requester,
      customProperties,
      notesSectionText,
      createdAt: file.stat.ctime,
      updatedAt: file.stat.mtime,
      tasks,
    };
  }

  private extractNotesSectionText(content: string): string {
    const { body } = splitFrontmatter(content);
    const { sections } = parseH2Sections(body.split(/\r?\n/));
    const notesSection = sections.find((section) => section.titleNormalized === "notes");
    if (!notesSection) {
      return "";
    }

    return notesSection.lines
      .slice(1)
      .join("\n")
      .trim();
  }

  private extractCustomProperties(frontmatter: Record<string, unknown>, area: AreaConfig): Record<string, string> {
    const frontmatterByCanonical = new Map<string, unknown>();
    for (const [name, value] of Object.entries(frontmatter)) {
      frontmatterByCanonical.set(canonicalPropertyName(name), value);
    }

    const customProperties: Record<string, string> = {};
    const templates = resolveAreaPropertyTemplates(this.getSettings(), area);

    for (const template of templates) {
      const key = canonicalPropertyName(template.name);
      if (RESERVED_PROJECT_PROPERTY_KEYS.has(key)) {
        continue;
      }

      const rawValue = frontmatterByCanonical.get(key);
      customProperties[key] = this.stringifyFrontmatterValue(rawValue);
    }

    return customProperties;
  }

  private stringifyFrontmatterValue(value: unknown): string {
    if (value === null || value === undefined) {
      return "";
    }

    if (Array.isArray(value)) {
      return value
        .map((entry) => String(entry).trim())
        .filter((entry) => entry.length > 0)
        .join(", ");
    }

    if (typeof value === "object") {
      try {
        return JSON.stringify(value);
      } catch (_error) {
        return "";
      }
    }

    return String(value);
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
      case "timing-status":
        return this.projectTimingSortValue(project);
      case "scheduled-date":
        return project.scheduledDate;
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

  private projectTimingSortValue(project: ProjectNote): string | null {
    const statuses = this.projectTimingStatuses(project);
    if (statuses.length === 0) {
      return null;
    }

    return statuses.join("|");
  }

  private projectTimingStatuses(project: ProjectNote): string[] {
    const timing: string[] = [];
    const today = this.relativeLocalIsoDate(0);
    const tomorrow = this.relativeLocalIsoDate(1);
    const terminalStatus = this.isTerminalProjectStatus(project.status) || Boolean(project.finishDate);
    const plannedStartDate = project.scheduledDate ?? project.startDate;

    if (
      !terminalStatus &&
      plannedStartDate &&
      project.dueDate &&
      plannedStartDate <= today &&
      today <= project.dueDate
    ) {
      timing.push("Current");
    }

    if (!terminalStatus && project.dueDate === today) {
      timing.push("Due");
    }

    if (!terminalStatus && project.dueDate && today > project.dueDate) {
      timing.push("Overdue");
    }

    if (!terminalStatus && plannedStartDate === tomorrow) {
      timing.push("Tomorrow");
    }

    if (!terminalStatus && plannedStartDate && plannedStartDate > tomorrow) {
      timing.push("Future");
    }

    if (!terminalStatus && !plannedStartDate && !project.dueDate) {
      timing.push("Needs Timing");
    }

    return timing;
  }

  private isTerminalProjectStatus(status: string | undefined): boolean {
    const normalized = (status ?? "").trim().toLowerCase();
    return normalized === "done" || normalized === "cancelled" || normalized === "canceled";
  }

  private relativeLocalIsoDate(daysFromToday: number): string {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + daysFromToday);
    return this.localIsoDate(date);
  }

  private localIsoDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
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

  private isListMetadataKey(key: ProjectMetadataKey): boolean {
    return key === "status" || key === "priority";
  }

  private buildProjectMetadataUpdates(
    frontmatter: Record<string, unknown>,
    key: ProjectMetadataKey,
    value: string,
    areaId: string | null,
  ): Record<string, string | string[] | null> {
    const updates: Record<string, string | string[] | null> = {};
    const listValue = value.length > 0 ? [value] : null;
    updates[key] = this.isListMetadataKey(key) ? listValue : value.length > 0 ? value : null;

    const currentStatus = normalizeListOrStringValue(frontmatter.status);
    const currentStartDate = normalizeStringValue(frontmatter["start-date"]);
    const currentFinishDate = normalizeStringValue(frontmatter["finish-date"]);
    const doingStatus = this.resolveProjectStatusValue(areaId, "doing");
    const doneStatus = this.resolveProjectStatusValue(areaId, "done");

    if (key === "status") {
      const normalizedStatus = value.toLowerCase();
      if (normalizedStatus === "doing" && !currentStartDate) {
        updates["start-date"] = todayIsoDate();
      }

      if (normalizedStatus === "done" && !currentFinishDate) {
        updates["finish-date"] = todayIsoDate();
      }

      return updates;
    }

    if (key === "start-date" && value.length > 0 && currentStatus?.toLowerCase() !== "doing") {
      updates.status = [doingStatus];
      return updates;
    }

    if (key === "finish-date" && value.length > 0 && currentStatus?.toLowerCase() !== "done") {
      updates.status = [doneStatus];
    }

    return updates;
  }

  private resolveProjectStatusValue(areaId: string | null, target: "doing" | "done"): string {
    const match = this.getStatusesForArea(areaId).find((status) => status.trim().toLowerCase() === target);
    if (match) {
      return match;
    }

    return target === "doing" ? "Doing" : "Done";
  }
}
