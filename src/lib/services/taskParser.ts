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
import { createRawResolvedDates } from "../utils/inferredDates";
import { splitFrontmatter } from "../utils/markdown";
import { isIsoDate, todayIsoDate } from "../utils/text";

const CHECKBOX_REGEX = /^(\s*)[-*+]\s+\[( |x|X|\/)\]\s*(.*)$/;
const TASKS_HEADING_REGEX = /^##\s+tasks\b.*$/i;
const DONE_HEADING_REGEX = /^###\s+done\b.*$/i;
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

interface SimpleTaskMarkerChange {
  lineIndex: number;
  previousMatch: RegExpMatchArray;
  currentMatch: RegExpMatchArray;
}

interface TaskSectionNode {
  start: number;
  end: number;
  indent: number;
  state: TaskState;
  parentIndex: number | null;
}

interface ExtractedTaskBlocks {
  remainingLines: string[];
  movedBlocks: string[][];
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
        resolvedDates: createRawResolvedDates({
          scheduled: scheduledDate,
          start: startDate,
          due: dueDate,
        }),
        rawLine,
      });
    }

    return tasks;
  }

  async setTaskState(file: TFile, task: ProjectTask, state: TaskState): Promise<boolean> {
    const content = await this.app.vault.read(file);
    const updated = this.updateTaskContent(content, task, (match) => {
      const indent = match[1];
      const targetCheckmark = this.stateToMarker(state);
      const text = this.normalizeTaskTextForState(match[3], state);

      return `${indent}- [${targetCheckmark}] ${text}`;
    });

    if (!updated.changed) {
      return false;
    }

    await this.app.vault.modify(file, updated.content);
    return true;
  }

  async updateTaskDate(file: TFile, task: ProjectTask, field: TaskDateField, value: string | null): Promise<boolean> {
    if (value && !isIsoDate(value)) {
      return false;
    }

    const content = await this.app.vault.read(file);
    const updated = this.updateTaskContent(content, task, (match) => {
      const indent = match[1];
      const rebuilt = this.rebuildTaskTextWithDateUpdate(match[3], match[2], field, value);
      return `${indent}- [${rebuilt.marker}] ${rebuilt.text}`;
    });

    if (!updated.changed) {
      return false;
    }

    await this.app.vault.modify(file, updated.content);
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
    const doneHeadingIndex = lines.findIndex((line, index) =>
      index > tasksHeadingIndex && index < sectionEnd && DONE_HEADING_REGEX.test(line.trim())
    );

    let insertAt = doneHeadingIndex >= 0 ? doneHeadingIndex : sectionEnd;
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

    const sectionNormalized = this.normalizeTasksSectionLines(lines);
    if (sectionNormalized.changed) {
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
      content: `${frontmatter}${sectionNormalized.lines.join("\n")}`,
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

    const markerChange = this.findSimpleTaskMarkerChange(
      previousLines,
      currentLines,
      previousTasksHeadingIndex,
      currentTasksHeadingIndex,
    );

    if (!markerChange) {
      return {
        changed: false,
        content: currentContent,
      };
    }

    const previousState = this.markerToState(markerChange.previousMatch[2]);
    const currentState = this.markerToState(markerChange.currentMatch[2]);
    const desiredState = this.resolveTriStateFromEditorTransition(previousState, currentState);

    if (desiredState === currentState) {
      return {
        changed: false,
        content: currentContent,
      };
    }

    const checkmark = this.stateToMarker(desiredState);
    const text = this.normalizeTaskTextForState(markerChange.currentMatch[3], desiredState);
    currentLines[markerChange.lineIndex] = `${markerChange.currentMatch[1]}- [${checkmark}] ${text}`;

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

  private updateTaskContent(
    content: string,
    task: ProjectTask,
    update: (match: RegExpMatchArray) => string,
  ): { changed: boolean; content: string } {
    const { frontmatter, body, frontmatterLineCount } = splitFrontmatter(content);
    const lines = body.split(/\r?\n/);
    const lineIndex = this.findTaskLineIndex(lines, task, frontmatterLineCount);
    if (lineIndex < 0 || lineIndex >= lines.length) {
      return {
        changed: false,
        content,
      };
    }

    const currentLine = lines[lineIndex];
    const match = currentLine.match(CHECKBOX_REGEX);
    if (!match) {
      return {
        changed: false,
        content,
      };
    }

    lines[lineIndex] = update(match);
    const normalizedSection = this.normalizeTasksSectionLines(lines);
    const nextContent = `${frontmatter}${normalizedSection.lines.join("\n")}`;
    if (nextContent === content) {
      return {
        changed: false,
        content,
      };
    }

    return {
      changed: true,
      content: nextContent,
    };
  }

  private findTaskLineIndex(lines: string[], task: ProjectTask, frontmatterLineCount: number): number {
    let lineIndex = task.line - frontmatterLineCount - 1;
    if (lineIndex < 0 || lineIndex >= lines.length || !CHECKBOX_REGEX.test(lines[lineIndex])) {
      lineIndex = lines.findIndex((line) => line === task.rawLine);
    }

    return lineIndex;
  }

  private normalizeTasksSectionLines(lines: string[]): { changed: boolean; lines: string[] } {
    const tasksHeadingIndex = this.findTasksHeadingIndex(lines);
    if (tasksHeadingIndex < 0) {
      return {
        changed: false,
        lines,
      };
    }

    const sectionEnd = this.findTasksSectionEnd(lines, tasksHeadingIndex);
    const sectionLines = lines.slice(tasksHeadingIndex + 1, sectionEnd);
    const tasksHeading = lines[tasksHeadingIndex];
    const doneHeadingIndex = sectionLines.findIndex((line) => DONE_HEADING_REGEX.test(line.trim()));
    const doneHeading = doneHeadingIndex >= 0 ? sectionLines[doneHeadingIndex] : "### Done";
    const activeLines = doneHeadingIndex >= 0 ? sectionLines.slice(0, doneHeadingIndex) : sectionLines;
    const doneLines = doneHeadingIndex >= 0 ? sectionLines.slice(doneHeadingIndex + 1) : [];

    const activeNodes = this.parseTaskSectionNodes(activeLines);
    const doneNodes = this.parseTaskSectionNodes(doneLines);

    const completedRootNodeIndexes = activeNodes
      .map((node, index) => ({ node, index }))
      .filter(({ node }) => node.parentIndex === null && node.state === "checked")
      .map(({ index }) => index);
    const reopenedNodeIndexes = doneNodes
      .map((node, index) => ({ node, index }))
      .filter(({ node, index }) => node.state !== "checked" && !this.hasIncompleteAncestor(doneNodes, index))
      .map(({ index }) => index);

    if (completedRootNodeIndexes.length === 0 && reopenedNodeIndexes.length === 0) {
      return {
        changed: false,
        lines,
      };
    }

    const extractedCompleted = this.extractTaskBlocks(activeLines, activeNodes, completedRootNodeIndexes);
    const extractedReopened = this.extractTaskBlocks(doneLines, doneNodes, reopenedNodeIndexes);

    const completedBlocks = extractedCompleted.movedBlocks.map((block) => this.trimOuterBlankLines(block));
    const reopenedBlocks = extractedReopened.movedBlocks.map((block, index) =>
      this.outdentTaskBlock(this.trimOuterBlankLines(block), doneNodes[reopenedNodeIndexes[index]].indent)
    );

    const remainingActiveLines = completedBlocks.length > 0
      ? this.removeLeadingBlankLines(extractedCompleted.remainingLines)
      : extractedCompleted.remainingLines;
    const remainingDoneLines = reopenedBlocks.length > 0
      ? this.removeLeadingBlankLines(extractedReopened.remainingLines)
      : extractedReopened.remainingLines;

    const nextActiveLines = [...this.flattenTaskBlocks(reopenedBlocks), ...remainingActiveLines];
    const nextDoneLines = [...this.flattenTaskBlocks(completedBlocks), ...remainingDoneLines];
    const shouldIncludeDoneHeading = doneHeadingIndex >= 0 || nextDoneLines.length > 0;

    const rebuiltSectionLines = [tasksHeading];
    if (nextActiveLines.length > 0) {
      rebuiltSectionLines.push(...nextActiveLines);
    } else {
      rebuiltSectionLines.push("");
    }

    if (shouldIncludeDoneHeading) {
      if (rebuiltSectionLines[rebuiltSectionLines.length - 1]?.trim() !== "") {
        rebuiltSectionLines.push("");
      }

      rebuiltSectionLines.push(doneHeading);
      if (nextDoneLines.length > 0) {
        rebuiltSectionLines.push(...nextDoneLines);
      }
    }

    return {
      changed: true,
      lines: [...lines.slice(0, tasksHeadingIndex), ...rebuiltSectionLines, ...lines.slice(sectionEnd)],
    };
  }

  private parseTaskSectionNodes(lines: string[]): TaskSectionNode[] {
    const nodes: TaskSectionNode[] = [];
    const stack: number[] = [];

    for (let index = 0; index < lines.length; index += 1) {
      const match = lines[index].match(CHECKBOX_REGEX);
      if (!match) {
        continue;
      }

      const indent = match[1].length;
      while (stack.length > 0 && nodes[stack[stack.length - 1]].indent >= indent) {
        stack.pop();
      }

      const parentIndex = stack.length > 0 ? stack[stack.length - 1] : null;
      nodes.push({
        start: index,
        end: lines.length,
        indent,
        state: this.markerToState(match[2]),
        parentIndex,
      });
      stack.push(nodes.length - 1);
    }

    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      const nextSiblingOrAncestor = nodes.find((candidate, candidateIndex) =>
        candidateIndex > index && candidate.indent <= node.indent
      );
      node.end = nextSiblingOrAncestor?.start ?? lines.length;
    }

    return nodes;
  }

  private hasIncompleteAncestor(nodes: TaskSectionNode[], nodeIndex: number): boolean {
    let parentIndex = nodes[nodeIndex]?.parentIndex ?? null;
    while (parentIndex !== null) {
      if (nodes[parentIndex].state !== "checked") {
        return true;
      }

      parentIndex = nodes[parentIndex].parentIndex;
    }

    return false;
  }

  private extractTaskBlocks(lines: string[], nodes: TaskSectionNode[], selectedNodeIndexes: number[]): ExtractedTaskBlocks {
    if (selectedNodeIndexes.length === 0) {
      return {
        remainingLines: [...lines],
        movedBlocks: [],
      };
    }

    const selectedNodes = selectedNodeIndexes
      .map((index) => nodes[index])
      .sort((left, right) => left.start - right.start);

    const remainingLines: string[] = [];
    const movedBlocks: string[][] = [];
    let cursor = 0;

    for (const node of selectedNodes) {
      remainingLines.push(...lines.slice(cursor, node.start));
      movedBlocks.push(lines.slice(node.start, node.end));
      cursor = node.end;
    }

    remainingLines.push(...lines.slice(cursor));
    return {
      remainingLines,
      movedBlocks,
    };
  }

  private trimOuterBlankLines(lines: string[]): string[] {
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

  private removeLeadingBlankLines(lines: string[]): string[] {
    let start = 0;
    while (start < lines.length && lines[start].trim() === "") {
      start += 1;
    }

    return lines.slice(start);
  }

  private flattenTaskBlocks(blocks: string[][]): string[] {
    return blocks.flatMap((block) => block);
  }

  private outdentTaskBlock(lines: string[], indent: number): string[] {
    if (indent <= 0) {
      return lines;
    }

    return lines.map((line) => {
      if (line.trim() === "") {
        return "";
      }

      let removeCount = indent;
      let index = 0;
      while (index < line.length && removeCount > 0 && /\s/u.test(line[index])) {
        index += 1;
        removeCount -= 1;
      }

      return line.slice(index);
    });
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

  private findSimpleTaskMarkerChange(
    previousLines: string[],
    currentLines: string[],
    previousTasksHeadingIndex: number,
    currentTasksHeadingIndex: number,
  ): SimpleTaskMarkerChange | null {
    const previousSectionEnd = this.findTasksSectionEnd(previousLines, previousTasksHeadingIndex);
    const currentSectionEnd = this.findTasksSectionEnd(currentLines, currentTasksHeadingIndex);
    const previousLength = previousSectionEnd - previousTasksHeadingIndex;
    const currentLength = currentSectionEnd - currentTasksHeadingIndex;

    if (previousLength !== currentLength) {
      return null;
    }

    let changedLine: SimpleTaskMarkerChange | null = null;

    for (let offset = 1; offset < currentLength; offset += 1) {
      const previousLine = previousLines[previousTasksHeadingIndex + offset];
      const currentLine = currentLines[currentTasksHeadingIndex + offset];

      if (previousLine === currentLine) {
        continue;
      }

      const previousMatch = previousLine?.match(CHECKBOX_REGEX);
      const currentMatch = currentLine?.match(CHECKBOX_REGEX);
      if (!previousMatch || !currentMatch) {
        return null;
      }

      const isSameTaskLine =
        previousMatch[1] === currentMatch[1] &&
        previousMatch[3] === currentMatch[3];
      if (!isSameTaskLine) {
        return null;
      }

      if (changedLine) {
        return null;
      }

      changedLine = {
        lineIndex: currentTasksHeadingIndex + offset,
        previousMatch,
        currentMatch,
      };
    }

    return changedLine;
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
