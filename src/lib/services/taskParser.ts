import type { App, TFile } from "obsidian";
import type { AddTaskRequest, ProjectTask } from "../types";
import { TASK_FINISHED_EMOJI } from "../constants";
import { splitFrontmatter } from "../utils/markdown";
import { isIsoDate, todayIsoDate } from "../utils/text";

const CHECKBOX_REGEX = /^(\s*)- \[( |x|X)\] (.*)$/;
const START_REGEX = /🛫\s*(\d{4}-\d{2}-\d{2})/u;
const DUE_REGEX = /📅\s*(\d{4}-\d{2}-\d{2})/u;
const FINISHED_REGEX = /✅\s*(\d{4}-\d{2}-\d{2})/u;
const FINISHED_REGEX_GLOBAL = /✅\s*(\d{4}-\d{2}-\d{2})/gu;
const FINISHED_MARKER_REMOVE_REGEX = /\s*✅\s*\d{4}-\d{2}-\d{2}/gu;

export class TaskParser {
  private readonly app: App;
  private readonly inFlight = new Set<string>();

  constructor(app: App) {
    this.app = app;
  }

  isSyncing(path: string): boolean {
    return this.inFlight.has(path);
  }

  parseTasks(content: string, file: TFile, projectName: string): ProjectTask[] {
    const { body, frontmatterLineCount } = splitFrontmatter(content);
    const lines = body.split(/\r?\n/);

    const tasksHeadingIndex = lines.findIndex((line) => /^##\s+tasks\s*$/i.test(line.trim()));
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

      const checked = match[2].toLowerCase() === "x";
      const text = match[3];
      const startDate = this.extractDate(START_REGEX, text);
      const dueDate = this.extractDate(DUE_REGEX, text);
      const finishedDate = this.extractDate(FINISHED_REGEX, text);
      const fullLine = frontmatterLineCount + index + 1;

      tasks.push({
        id: `${file.path}:${fullLine}`,
        projectPath: file.path,
        projectName,
        line: fullLine,
        text,
        checked,
        startDate,
        dueDate,
        finishedDate,
        rawLine,
      });
    }

    return tasks;
  }

  async toggleTask(file: TFile, task: ProjectTask, checked: boolean): Promise<boolean> {
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
    const targetCheckmark = checked ? "x" : " ";

    if (checked) {
      if (!FINISHED_REGEX.test(text)) {
        text = `${text} ${TASK_FINISHED_EMOJI} ${todayIsoDate()}`.trim();
      }
    } else {
      text = text.replace(/\s*✅\s*\d{4}-\d{2}-\d{2}/u, "").trim();
    }

    lines[lineIndex] = `${indent}- [${targetCheckmark}] ${text}`;

    await this.app.vault.modify(file, lines.join("\n"));
    return true;
  }

  async addTask(file: TFile, request: AddTaskRequest): Promise<boolean> {
    if (!isIsoDate(request.startDate)) {
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

    const tasksHeadingIndex = lines.findIndex((line) => /^##\s+tasks\s*$/i.test(line.trim()));
    if (tasksHeadingIndex < 0) {
      return false;
    }

    const nextHeadingIndex = lines.findIndex((line, index) => index > tasksHeadingIndex && /^##\s+\S/.test(line));
    const sectionEnd = nextHeadingIndex >= 0 ? nextHeadingIndex : lines.length;

    let insertAt = sectionEnd;
    while (insertAt > tasksHeadingIndex + 1 && lines[insertAt - 1].trim() === "") {
      insertAt -= 1;
    }

    const duePart = request.dueDate ? ` 📅 ${request.dueDate}` : "";
    const taskLine = `- [ ] ${text} 🛫 ${request.startDate}${duePart}`;
    lines.splice(insertAt, 0, taskLine);

    await this.app.vault.modify(file, `${frontmatter}${lines.join("\n")}`);
    return true;
  }

  async reconcileCompletedDateMarkers(file: TFile): Promise<boolean> {
    if (this.inFlight.has(file.path)) {
      return false;
    }

    const content = await this.app.vault.read(file);
    const { frontmatter, body } = splitFrontmatter(content);
    const lines = body.split(/\r?\n/);

    const tasksHeadingIndex = lines.findIndex((line) => /^##\s+tasks\s*$/i.test(line.trim()));
    if (tasksHeadingIndex < 0) {
      return false;
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
      const checked = match[2].toLowerCase() === "x";
      const checkmark = checked ? "x" : " ";
      const text = match[3];
      const normalizedText = checked ? this.ensureFinishedDateMarker(text) : this.removeFinishedDateMarkers(text);

      if (normalizedText === text) {
        continue;
      }

      lines[index] = `${indent}- [${checkmark}] ${normalizedText}`;
      changed = true;
    }

    if (!changed) {
      return false;
    }

    this.inFlight.add(file.path);
    try {
      await this.app.vault.modify(file, `${frontmatter}${lines.join("\n")}`);
    } finally {
      this.inFlight.delete(file.path);
    }

    return true;
  }

  private extractDate(pattern: RegExp, text: string): string | null {
    const match = text.match(pattern);
    if (!match) {
      return null;
    }

    const value = match[1];
    return isIsoDate(value) ? value : null;
  }

  static extractAreaTags(tags: string[], areaSlug: string): string[] {
    const prefix = `area/${areaSlug}`;
    return tags.filter((tag) => tag.startsWith(prefix));
  }

  static hasStrictTaskDateMarkers(taskText: string): boolean {
    const allMatches = [...taskText.matchAll(/[🛫📅✅]\s*(\S+)/gu)];

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
    return text.replace(FINISHED_MARKER_REMOVE_REGEX, "").replace(/\s{2,}/g, " ").trim();
  }
}
