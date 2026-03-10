import * as chrono from "chrono-node";
import { App, type Editor, EditorSuggest, type EditorPosition, type EditorSuggestContext, type EditorSuggestTriggerInfo, TFile } from "obsidian";
import {
  TASK_DUE_EMOJI,
  TASK_PRIORITY_METADATA,
  TASK_PRIORITY_ORDER,
  TASK_SCHEDULED_EMOJI,
  TASK_START_EMOJI,
} from "../constants";
import type { NoteTaskPriority, ProjectSettings, TaskDateField } from "../types";
import { isIsoDate, localDateToIsoDate } from "../utils/text";
import { resolveAreaForPath } from "../utils/areas";
import { TaskParser, type EditorTaskLineContext } from "./taskParser";

interface SuggestionEntry {
  displayText: string;
  appendText: string;
  insertAt: number;
  replaceTo: number;
}

interface ActiveDateContext {
  emoji: string;
  field: TaskDateField;
  query: string;
  insertAt: number;
  replaceTo: number;
}

const DATE_SUGGESTION_LABELS = [
  "today",
  "tomorrow",
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "next week",
  "next month",
  "next year",
];

const DATE_FIELD_LABELS: Array<{ field: TaskDateField; emoji: string; label: string }> = [
  { field: "due", emoji: TASK_DUE_EMOJI, label: "due date" },
  { field: "start", emoji: TASK_START_EMOJI, label: "start date" },
  { field: "scheduled", emoji: TASK_SCHEDULED_EMOJI, label: "scheduled date" },
];

export class TaskEditorSuggest extends EditorSuggest<SuggestionEntry> {
  private readonly getSettings: () => ProjectSettings;
  private readonly taskParser: TaskParser;

  constructor(app: App, getSettings: () => ProjectSettings, taskParser: TaskParser) {
    super(app);
    this.getSettings = getSettings;
    this.taskParser = taskParser;
  }

  onTrigger(cursor: EditorPosition, editor: Editor, file: TFile): EditorSuggestTriggerInfo | null {
    const settings = this.getSettings();
    if (!settings.enableTaskAutoSuggest) {
      return null;
    }

    if (!resolveAreaForPath(settings.areas, file.path)) {
      return null;
    }

    const content = editor.getValue();
    const context = this.taskParser.getEditorTaskLineContext(content, cursor.line);
    if (!context) {
      return null;
    }

    const suggestions = this.buildSuggestions(editor.getLine(cursor.line), cursor.ch, context, settings);
    if (suggestions.length === 0) {
      return null;
    }

    return {
      start: { line: cursor.line, ch: 0 },
      end: { line: cursor.line, ch: editor.getLine(cursor.line).length },
      query: editor.getLine(cursor.line),
    };
  }

  getSuggestions(context: EditorSuggestContext): SuggestionEntry[] {
    const settings = this.getSettings();
    if (!settings.enableTaskAutoSuggest || !context.file) {
      return [];
    }

    if (!resolveAreaForPath(settings.areas, context.file.path)) {
      return [];
    }

    const taskContext = this.taskParser.getEditorTaskLineContext(context.editor.getValue(), context.start.line);
    if (!taskContext) {
      return [];
    }

    return this.buildSuggestions(context.editor.getLine(context.start.line), context.editor.getCursor().ch, taskContext, settings);
  }

  renderSuggestion(value: SuggestionEntry, el: HTMLElement): void {
    el.createDiv({ text: value.displayText });
  }

  selectSuggestion(value: SuggestionEntry, _evt: MouseEvent | KeyboardEvent): void {
    const editor = this.context?.editor;
    if (!editor) {
      return;
    }

    const cursor = editor.getCursor();
    editor.replaceRange(
      value.appendText,
      { line: cursor.line, ch: value.insertAt },
      { line: cursor.line, ch: value.replaceTo },
    );
    editor.setCursor({ line: cursor.line, ch: value.insertAt + value.appendText.length });
  }

  private buildSuggestions(
    line: string,
    cursorCh: number,
    taskContext: EditorTaskLineContext,
    settings: ProjectSettings,
  ): SuggestionEntry[] {
    const prefix = line.slice(0, cursorCh);
    const activeDateContext = this.findActiveDateContext(prefix);
    const suggestions = activeDateContext
      ? this.buildDateSuggestions(activeDateContext, settings)
      : this.buildPropertySuggestions(prefix, cursorCh, taskContext, settings);

    return suggestions.slice(0, settings.taskAutoSuggestMaxSuggestions);
  }

  private buildPropertySuggestions(
    prefix: string,
    cursorCh: number,
    taskContext: EditorTaskLineContext,
    settings: ProjectSettings,
  ): SuggestionEntry[] {
    const searchMatch = /([^\s⏳🛫📅✅🔵🟢🔴🔥]*)$/u.exec(prefix);
    const query = searchMatch?.[1]?.toLowerCase() ?? "";
    const insertAt = cursorCh - (searchMatch?.[1]?.length ?? 0);

    if (query.length < settings.taskAutoSuggestMinMatch && !(query.length === 0 && settings.taskAutoSuggestMinMatch === 0)) {
      return [];
    }

    const suggestions: SuggestionEntry[] = [];
    for (const field of DATE_FIELD_LABELS) {
      if (field.field === "due" && taskContext.dueDate) {
        continue;
      }
      if (field.field === "start" && taskContext.startDate) {
        continue;
      }
      if (field.field === "scheduled" && taskContext.scheduledDate) {
        continue;
      }

      const displayText = `${field.emoji} ${field.label}`;
      if (!this.matchesQuery(displayText, field.label, query)) {
        continue;
      }

      suggestions.push({
        displayText,
        appendText: `${field.emoji} `,
        insertAt,
        replaceTo: cursorCh,
      });
    }

    if (!taskContext.priority) {
      for (const priority of TASK_PRIORITY_ORDER) {
        const metadata = TASK_PRIORITY_METADATA[priority];
        const displayText = `${metadata.emoji} ${metadata.label.toLowerCase()} priority`;
        const textToMatch = [metadata.label, ...metadata.searchTerms, metadata.emoji, "priority"].join(" ");
        if (!this.matchesQuery(displayText, textToMatch, query)) {
          continue;
        }

        suggestions.push({
          displayText,
          appendText: `${metadata.emoji} `,
          insertAt,
          replaceTo: cursorCh,
        });
      }
    }

    return suggestions;
  }

  private buildDateSuggestions(context: ActiveDateContext, settings: ProjectSettings): SuggestionEntry[] {
    const normalizedQuery = context.query.trim().toLowerCase();
    if (
      normalizedQuery.length < settings.taskAutoSuggestMinMatch &&
      !(normalizedQuery.length === 0 && settings.taskAutoSuggestMinMatch === 0)
    ) {
      return [];
    }

    const suggestions = new Map<string, SuggestionEntry>();
    if (normalizedQuery.length > 0) {
      const parsedDate = this.parseNaturalLanguageDate(context.query);
      if (parsedDate) {
        suggestions.set(parsedDate, {
          displayText: `${context.query.trim()} (${parsedDate})`,
          appendText: `${context.emoji} ${parsedDate} `,
          insertAt: context.insertAt,
          replaceTo: context.replaceTo,
        });
      }
    }

    for (const label of DATE_SUGGESTION_LABELS) {
      if (!this.matchesQuery(label, label, normalizedQuery)) {
        continue;
      }

      const parsedDate = this.parseNaturalLanguageDate(label);
      if (!parsedDate) {
        continue;
      }

      suggestions.set(`${label}:${parsedDate}`, {
        displayText: `${label} (${parsedDate})`,
        appendText: `${context.emoji} ${parsedDate} `,
        insertAt: context.insertAt,
        replaceTo: context.replaceTo,
      });
    }

    return Array.from(suggestions.values());
  }

  private findActiveDateContext(prefix: string): ActiveDateContext | null {
    const match = /([⏳🛫📅])\s*([^⏳🛫📅✅🔵🟢🔴🔥]*)$/u.exec(prefix);
    if (!match) {
      return null;
    }

    const query = match[2] ?? "";
    if (isIsoDate(query.trim())) {
      return null;
    }

    const emoji = match[1];
    const field = this.fieldForEmoji(emoji);
    if (!field) {
      return null;
    }

    return {
      emoji,
      field,
      query,
      insertAt: match.index,
      replaceTo: prefix.length,
    };
  }

  private fieldForEmoji(emoji: string): TaskDateField | null {
    if (emoji === TASK_DUE_EMOJI) {
      return "due";
    }

    if (emoji === TASK_START_EMOJI) {
      return "start";
    }

    if (emoji === TASK_SCHEDULED_EMOJI) {
      return "scheduled";
    }

    return null;
  }

  private parseNaturalLanguageDate(input: string): string | null {
    const parsed = chrono.parseDate(input.trim(), new Date(), { forwardDate: true });
    return parsed ? localDateToIsoDate(parsed) : null;
  }

  private matchesQuery(displayText: string, searchText: string, query: string): boolean {
    if (query.length === 0) {
      return true;
    }

    const haystack = `${displayText} ${searchText}`.toLowerCase();
    return haystack.includes(query);
  }
}