import type { App, TFile } from "obsidian";
import type { AddTaskRequest, NoteTaskPriority, ProjectTask, TaskDateField, TaskState } from "../types";
import {
  TASK_DUE_EMOJI,
  TASK_FINISHED_EMOJI,
  TASK_PRIORITY_EMOJIS,
  TASK_PRIORITY_METADATA,
  TASK_PRIORITY_ORDER,
  TASK_SCHEDULED_EMOJI,
  TASK_START_EMOJI,
} from "../constants";
import { splitFrontmatter } from "../utils/markdown";
import { isIsoDate, todayIsoDate } from "../utils/text";

const CHECKBOX_REGEX = /^(\s*)[-*+]\s+\[( |x|X|\/)\]\s*(.*)$/;
const TASKS_HEADING_REGEX = /^##\s+tasks\b.*$/i;
const SCHEDULED_REGEX = /⏳\s*(\d{4}-\d{2}-\d{2})/u;
const START_REGEX = /🛫\s*(\d{4}-\d{2}-\d{2})/u;
const START_REGEX_GLOBAL = /🛫\s*(\d{4}-\d{2}-\d{2})/gu;
const DUE_REGEX = /📅\s*(\d{4}-\d{2}-\d{2})/u;
const FINISHED_REGEX = /✅\s*(\d{4}-\d{2}-\d{2})/u;
const FINISHED_REGEX_GLOBAL = /✅\s*(\d{4}-\d{2}-\d{2})/gu;
const FINISHED_MARKER_REMOVE_REGEX = /\s*✅\s*\d{4}-\d{2}-\d{2}/gu;
const HAS_FINISHED_MARKER_REGEX = /✅\s*\d{4}-\d{2}-\d{2}/u;
const HAS_START_MARKER_REGEX = /🛫\s*\d{4}-\d{2}-\d{2}/u;
const ALL_DATE_MARKERS_REGEX = /\s*[⏳🛫📅✅]\s*\d{4}-\d{2}-\d{2}/gu;
const TASK_PRIORITY_REGEX = /[🔵🟢🔴🔥]/u;

export interface EditorTaskLineContext {
  lineText: string;
  taskText: string;
  lineIndex: number;
  state: TaskState;
  priority: NoteTaskPriority | null;
  scheduledDate: string | null;
  startDate: string | null;
  dueDate: string | null;
  finishedDate: string | null;
}

export class TaskParser {
  private readonly app: App;
  private readonly inFlight = new Set<string>();

  constructor(app: App) {
    this.app = app;
  }

  isSyncing(path: string): boolean {
    return this.inFlight.has(path);
  }

  parseTasks(content: string, file: TFile, projectName: string, projectRequester: string[]): ProjectTask[] {
    const { body, frontmatterLineCount } = splitFrontmatter(content);
    const lines = body.split(/\r?\n/);

    const tasksHeadingIndex = this.findTasksHeadingIndex(lines);
    if (tasksHeadingIndex < 0) {
      return [];
    }

    const nextHeadingIndex = lines.findIndex((line, index) => index > tasksHeadingIndex && /^##\s+\S/.test(line));
    const endIndex = nextHeadingIndex >= 0 ? nextHeadingIndex : lines.length;

    const tasks: ProjectTask[] = [];

    for (let index = tasksHeadingIndex + 1; index < endIndex; index += 1) {
      const rawLine = lines[index];
      const match = rawLine.match(CHECKBOX_REGEX);
      if (!match) {
        continue;
      }

      const state = this.markerToState(match[2]);
      const checked = state === "checked";
      const text = match[3];
      const priority = this.extractPriority(text);
      const scheduledDate = this.extractDate(SCHEDULED_REGEX, text);
      const startDate = this.extractDate(START_REGEX, text);
      const dueDate = this.extractDate(DUE_REGEX, text);
      const finishedDate = this.extractDate(FINISHED_REGEX, text);
      const fullLine = frontmatterLineCount + index + 1;

      tasks.push({
        id: `${file.path}:${fullLine}`,
        projectPath: file.path,
        projectName,
        projectRequester: [...projectRequester],
        line: fullLine,
        text,
        state,
        checked,
        priority,
        scheduledDate,
        startDate,
        dueDate,
        finishedDate,
        rawLine,
      });
    }

    return tasks;
  }

  async setTaskState(file: TFile, task: ProjectTask, state: TaskState): Promise<boolean> {
    const content = await this.app.vault.read(file);
    const lines = content.split(/\r?\n/);

    let lineIndex = task.line - 1;
    if (lineIndex < 0 || lineIndex >= lines.length || !CHECKBOX_REGEX.test(lines[lineIndex])) {
      lineIndex = lines.findIndex((line) => line === task.rawLine);
    }

    if (lineIndex < 0 || lineIndex >= lines.length) {
      return false;
    }

    const currentLine = lines[lineIndex];
    const match = currentLine.match(CHECKBOX_REGEX);
    if (!match) {
      return false;
    }

    const indent = match[1];
    let text = match[3];
    const targetCheckmark = this.stateToMarker(state);

    if (state === "checked") {
      if (!FINISHED_REGEX.test(text)) {
        text = `${text} ${TASK_FINISHED_EMOJI} ${todayIsoDate()}`.trim();
      }
    } else if (state === "in-progress") {
      text = this.ensureStartDateMarker(this.removeFinishedDateMarkers(text));
    } else {
      text = text.replace(/\s*✅\s*\d{4}-\d{2}-\d{2}/u, "").trim();
    }

    lines[lineIndex] = `${indent}- [${targetCheckmark}] ${text}`;

    await this.app.vault.modify(file, lines.join("\n"));
    return true;
  }

  async updateTaskDate(file: TFile, task: ProjectTask, field: TaskDateField, value: string | null): Promise<boolean> {
    if (value && !isIsoDate(value)) {
      return false;
    }

    const content = await this.app.vault.read(file);
    const lines = content.split(/\r?\n/);

    let lineIndex = task.line - 1;
    if (lineIndex < 0 || lineIndex >= lines.length || !CHECKBOX_REGEX.test(lines[lineIndex])) {
      lineIndex = lines.findIndex((line) => line === task.rawLine);
    }

    if (lineIndex < 0 || lineIndex >= lines.length) {
      return false;
    }

    const currentLine = lines[lineIndex];
    const match = currentLine.match(CHECKBOX_REGEX);
    if (!match) {
      return false;
    }

    const indent = match[1];
    const marker = match[2];
    const rebuilt = this.rebuildTaskTextWithDateUpdate(match[3], match[2], field, value);

    lines[lineIndex] = `${indent}- [${rebuilt.marker}] ${rebuilt.text}`;
    await this.app.vault.modify(file, lines.join("\n"));
    return true;
  }

  async addTask(file: TFile, request: AddTaskRequest): Promise<boolean> {
    if (!isIsoDate(request.scheduledDate)) {
      return false;
    }

    if (request.startDate && !isIsoDate(request.startDate)) {
      return false;
    }

    if (request.dueDate && !isIsoDate(request.dueDate)) {
      return false;
    }

    const text = request.text.trim();
    if (text.length === 0) {
      return false;
    }

    const content = await this.app.vault.read(file);
    const { frontmatter, body } = splitFrontmatter(content);
    const lines = body.split(/\r?\n/);

    const tasksHeadingIndex = this.findTasksHeadingIndex(lines);
    if (tasksHeadingIndex < 0) {
      return false;
    }

    const nextHeadingIndex = lines.findIndex((line, index) => index > tasksHeadingIndex && /^##\s+\S/.test(line));
    const sectionEnd = nextHeadingIndex >= 0 ? nextHeadingIndex : lines.length;

    let insertAt = sectionEnd;
    while (insertAt > tasksHeadingIndex + 1 && lines[insertAt - 1].trim() === "") {
      insertAt -= 1;
    }

    const scheduledPart = ` ${TASK_SCHEDULED_EMOJI} ${request.scheduledDate}`;
    const startPart = request.startDate ? ` ${TASK_START_EMOJI} ${request.startDate}` : "";
    const duePart = request.dueDate ? ` ${TASK_DUE_EMOJI} ${request.dueDate}` : "";
    const taskLine = `- [ ] ${text}${scheduledPart}${startPart}${duePart}`;
    lines.splice(insertAt, 0, taskLine);

    await this.app.vault.modify(file, `${frontmatter}${lines.join("\n")}`);
    return true;
  }

  async reconcileCompletedDateMarkers(file: TFile): Promise<boolean> {
    if (this.inFlight.has(file.path)) {
      return false;
    }

    const content = await this.app.vault.read(file);
    const reconciled = this.reconcileCompletedDateMarkersInContent(content);
    if (!reconciled.changed) {
      return false;
    }

    this.inFlight.add(file.path);
    try {
      await this.app.vault.modify(file, reconciled.content);
    } finally {
      this.inFlight.delete(file.path);
    }

    return true;
  }

  reconcileCompletedDateMarkersInContent(content: string): { changed: boolean; content: string } {
    const { frontmatter, body } = splitFrontmatter(content);
    const lines = body.split(/\r?\n/);

    const tasksHeadingIndex = this.findTasksHeadingIndex(lines);
    if (tasksHeadingIndex < 0) {
      return {
        changed: false,
        content,
      };
    }

    const nextHeadingIndex = lines.findIndex((line, index) => index > tasksHeadingIndex && /^##\s+\S/.test(line));
    const sectionEnd = nextHeadingIndex >= 0 ? nextHeadingIndex : lines.length;

    let changed = false;

    for (let index = tasksHeadingIndex + 1; index < sectionEnd; index += 1) {
      const line = lines[index];
      const match = line.match(CHECKBOX_REGEX);
      if (!match) {
        continue;
      }

      const indent = match[1];
      const state = this.markerToState(match[2]);
      const checkmark = this.stateToMarker(state);
      const text = match[3];
      let normalizedText: string;
      if (state === "checked") {
        normalizedText = this.ensureFinishedDateMarker(text);
      } else if (state === "in-progress") {
        normalizedText = this.ensureStartDateMarker(this.removeFinishedDateMarkers(text));
      } else {
        normalizedText = this.removeFinishedDateMarkers(text);
      }

      if (normalizedText === text && match[2] === checkmark) {
        continue;
      }

      lines[index] = `${indent}- [${checkmark}] ${normalizedText}`;
      changed = true;
    }

    if (!changed) {
      return {
        changed: false,
        content,
      };
    }

    return {
      changed: true,
      content: `${frontmatter}${lines.join("\n")}`,
    };
  }

  reconcileTriStateTransitionsInContent(
    previousContent: string,
    currentContent: string,
    triStateEnabled: boolean,
  ): { changed: boolean; content: string } {
    if (!triStateEnabled) {
      return {
        changed: false,
        content: currentContent,
      };
    }

    const previous = splitFrontmatter(previousContent);
    const current = splitFrontmatter(currentContent);
    const previousLines = previous.body.split(/\r?\n/);
    const currentLines = current.body.split(/\r?\n/);

    const previousTasksHeadingIndex = this.findTasksHeadingIndex(previousLines);
    const currentTasksHeadingIndex = this.findTasksHeadingIndex(currentLines);
    if (previousTasksHeadingIndex < 0 || currentTasksHeadingIndex < 0) {
      return {
        changed: false,
        content: currentContent,
      };
    }

    const previousSectionEnd = this.findTasksSectionEnd(previousLines, previousTasksHeadingIndex);
    const currentSectionEnd = this.findTasksSectionEnd(currentLines, currentTasksHeadingIndex);
    const maxSharedIndex = Math.min(previousSectionEnd, currentSectionEnd);

    let changed = false;

    for (let index = currentTasksHeadingIndex + 1; index < maxSharedIndex; index += 1) {
      const currentLine = currentLines[index];
      const currentMatch = currentLine.match(CHECKBOX_REGEX);
      if (!currentMatch) {
        continue;
      }

      const previousLine = previousLines[index];
      const previousMatch = previousLine?.match(CHECKBOX_REGEX);
      if (!previousMatch) {
        continue;
      }

      const previousState = this.markerToState(previousMatch[2]);
      const currentState = this.markerToState(currentMatch[2]);

      if (previousState === currentState) {
        continue;
      }

      const desiredState = this.resolveTriStateFromEditorTransition(previousState, currentState);
      if (desiredState === currentState) {
        continue;
      }

      const checkmark = this.stateToMarker(desiredState);
      const text = this.normalizeTaskTextForState(currentMatch[3], desiredState);

      currentLines[index] = `${currentMatch[1]}- [${checkmark}] ${text}`;
      changed = true;
    }

    if (!changed) {
      return {
        changed: false,
        content: currentContent,
      };
    }

    return {
      changed: true,
      content: `${current.frontmatter}${currentLines.join("\n")}`,
    };
  }

  private extractDate(pattern: RegExp, text: string): string | null {
    const match = text.match(pattern);
    if (!match) {
      return null;
    }

    const value = match[1];
    return isIsoDate(value) ? value : null;
  }

  extractPriority(text: string): NoteTaskPriority | null {
    for (const priority of TASK_PRIORITY_ORDER) {
      if (text.includes(TASK_PRIORITY_METADATA[priority].emoji)) {
        return priority;
      }
    }

    return null;
  }

  hasTaskPriority(text: string): boolean {
    return TASK_PRIORITY_REGEX.test(text);
  }

  getEditorTaskLineContext(content: string, lineIndex: number): EditorTaskLineContext | null {
    const { body, frontmatterLineCount } = splitFrontmatter(content);
    const bodyLineIndex = lineIndex - frontmatterLineCount;
    if (bodyLineIndex < 0) {
      return null;
    }

    const lines = body.split(/\r?\n/);
    if (bodyLineIndex >= lines.length) {
      return null;
    }

    const tasksHeadingIndex = this.findTasksHeadingIndex(lines);
    if (tasksHeadingIndex < 0) {
      return null;
    }

    const sectionEnd = this.findTasksSectionEnd(lines, tasksHeadingIndex);
    if (bodyLineIndex <= tasksHeadingIndex || bodyLineIndex >= sectionEnd) {
      return null;
    }

    const lineText = lines[bodyLineIndex];
    const match = lineText.match(CHECKBOX_REGEX);
    if (!match) {
      return null;
    }

    const taskText = match[3];

    return {
      lineText,
      taskText,
      lineIndex,
      state: this.markerToState(match[2]),
      priority: this.extractPriority(taskText),
      scheduledDate: this.extractDate(SCHEDULED_REGEX, taskText),
      startDate: this.extractDate(START_REGEX, taskText),
      dueDate: this.extractDate(DUE_REGEX, taskText),
      finishedDate: this.extractDate(FINISHED_REGEX, taskText),
    };
  }

  static extractAreaTags(tags: string[], areaSlug: string): string[] {
    const prefix = `area/${areaSlug}`;
    return tags.filter((tag) => tag.startsWith(prefix));
  }

  static hasStrictTaskDateMarkers(taskText: string): boolean {
    const allMatches = [...taskText.matchAll(/[⏳🛫📅✅]\s*(\S+)/gu)];

    return allMatches.every((match) => {
      const maybeDate = match[1];
      return isIsoDate(maybeDate);
    });
  }

  private ensureFinishedDateMarker(text: string): string {
    const firstExistingDate = [...text.matchAll(FINISHED_REGEX_GLOBAL)][0]?.[1] ?? todayIsoDate();
    const withoutFinishedMarkers = this.removeFinishedDateMarkers(text);
    return `${withoutFinishedMarkers} ${TASK_FINISHED_EMOJI} ${firstExistingDate}`.trim();
  }

  private removeFinishedDateMarkers(text: string): string {
    if (!HAS_FINISHED_MARKER_REGEX.test(text)) {
      return text;
    }

    return text.replace(FINISHED_MARKER_REMOVE_REGEX, "").replace(/\s{2,}/g, " ").trim();
  }

  private ensureStartDateMarker(text: string): string {
    if (HAS_START_MARKER_REGEX.test(text)) {
      return text;
    }

    const existingFinishedDate = [...text.matchAll(FINISHED_REGEX_GLOBAL)][0]?.[1];
    const existingStartDate = [...text.matchAll(START_REGEX_GLOBAL)][0]?.[1] ?? todayIsoDate();
    let normalized = text;
    if (existingFinishedDate) {
      normalized = this.removeFinishedDateMarkers(normalized);
    }

    return `${normalized} ${TASK_START_EMOJI} ${existingStartDate}`.trim();
  }

  private rebuildTaskTextWithDateUpdate(
    text: string,
    currentMarker: string,
    field: TaskDateField,
    value: string | null,
  ): { marker: string; text: string } {
    const dates = {
      scheduled: this.extractDate(SCHEDULED_REGEX, text),
      start: this.extractDate(START_REGEX, text),
      due: this.extractDate(DUE_REGEX, text),
      finish: this.extractDate(FINISHED_REGEX, text),
    };
    const priority = this.extractPriority(text);

    dates[field] = value;

    const baseText = text
      .replace(ALL_DATE_MARKERS_REGEX, "")
      .replace(this.priorityRemovalRegex(), "")
      .replace(/\s{2,}/g, " ")
      .trim();
    const parts = [baseText];

    if (dates.scheduled) {
      parts.push(`${TASK_SCHEDULED_EMOJI} ${dates.scheduled}`);
    }

    if (dates.start) {
      parts.push(`${TASK_START_EMOJI} ${dates.start}`);
    }

    if (dates.due) {
      parts.push(`${TASK_DUE_EMOJI} ${dates.due}`);
    }

    if (dates.finish) {
      parts.push(`${TASK_FINISHED_EMOJI} ${dates.finish}`);
    }

    if (priority) {
      parts.push(TASK_PRIORITY_METADATA[priority].emoji);
    }

    const nextText = parts.filter((part) => part.length > 0).join(" ").trim();
    let marker = currentMarker;
    if (field === "finish") {
      marker = value ? "x" : " ";
    }

    return {
      marker,
      text: nextText,
    };
  }

  private findTasksHeadingIndex(lines: string[]): number {
    return lines.findIndex((line) => TASKS_HEADING_REGEX.test(line.trim()));
  }

  private findTasksSectionEnd(lines: string[], tasksHeadingIndex: number): number {
    const nextHeadingIndex = lines.findIndex((line, index) => index > tasksHeadingIndex && /^##\s+\S/.test(line));
    return nextHeadingIndex >= 0 ? nextHeadingIndex : lines.length;
  }

  private markerToState(marker: string): TaskState {
    if (marker === "/") {
      return "in-progress";
    }

    if (marker.toLowerCase() === "x") {
      return "checked";
    }

    return "unchecked";
  }

  private stateToMarker(state: TaskState): string {
    if (state === "checked") {
      return "x";
    }

    if (state === "in-progress") {
      return "/";
    }

    return " ";
  }

  private resolveTriStateFromEditorTransition(previous: TaskState, current: TaskState): TaskState {
    if (previous === "unchecked" && current === "checked") {
      return "in-progress";
    }

    if (previous === "in-progress" && current === "unchecked") {
      return "checked";
    }

    return current;
  }

  private normalizeTaskTextForState(text: string, state: TaskState): string {
    if (state === "checked") {
      return this.ensureFinishedDateMarker(text);
    }

    if (state === "in-progress") {
      return this.ensureStartDateMarker(this.removeFinishedDateMarkers(text));
    }

    return this.removeFinishedDateMarkers(text);
  }

  private priorityRemovalRegex(): RegExp {
    const escaped = TASK_PRIORITY_EMOJIS.join("");
    return new RegExp(`\\s*[${escaped}]`, "gu");
  }
}
