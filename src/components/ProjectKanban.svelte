<script lang="ts">
  import { Component, MarkdownRenderer } from "obsidian";
  import { fromStore } from "svelte/store";
  import { fade, slide } from "svelte/transition";
  import type { ProjectNote, ProjectTask, TaskState, ViewVariant } from "../lib/types";
  import type { ProjectViewStore } from "../lib/stores/projectViewStore";
  import ColumnPicker from "./shared/ColumnPicker.svelte";
  import SearchInput from "./shared/SearchInput.svelte";

  interface CellSegment {
    text: string;
    linkReference: string | null;
    target: string | null;
    externalUrl: string | null;
  }

  type LinkMatchType = "wiki" | "markdown-external" | "external-url";

  const TASK_DATE_TOKEN_REGEX = /(?:🛫|📅|✅)\s*\d{4}-\d{2}-\d{2}/gu;
  const WIKI_LINK_REGEX = /\[\[([^\]]+)\]\]/gu;
  const MARKDOWN_EXTERNAL_LINK_REGEX = /\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^)]+)\)/giu;
  const EXTERNAL_URL_REGEX = /\b(?:https?:\/\/|mailto:)[^\s<>()]+/giu;

  interface MarkdownRenderParams {
    markdown: string;
    sourcePath: string;
    onRendered?: (host: HTMLElement) => void;
  }

  let { viewStore, variant } = $props<{ viewStore: ProjectViewStore; variant: ViewVariant }>();

  const state = $derived.by(() => fromStore(viewStore.state).current);

  let draggingPath = $state<string | null>(null);
  let statusColumnOrder = $state<string[]>([]);
  let expandedNotesByPath = $state<Record<string, boolean>>({});
  let notesLineOverflowByPath = $state<Record<string, boolean>>({});
  let completingTaskIds = $state<string[]>([]);

  const statusOptions = $derived.by(() => {
    const values = new Set(state.statuses);
    if (state.projects.some((project) => project.statusIsUnknown)) {
      values.add("Unknown");
    }
    return Array.from(values);
  });

  const orderedStatuses = $derived.by(() => {
    const order = statusColumnOrder.length > 0 ? statusColumnOrder : statusOptions;
    const byStatus = new Set(statusOptions);
    return order.filter((status) => byStatus.has(status));
  });

  const projectsByStatus = $derived.by(() => {
    const map = new Map<string, ProjectNote[]>();
    for (const status of orderedStatuses) {
      map.set(status, []);
    }

    for (const project of state.projects) {
      const status = project.status;
      if (!map.has(status)) {
        map.set(status, []);
      }
      map.get(status)?.push(project);
    }

    return map;
  });

  const visibleStatuses = $derived.by(() => {
    if (state.showHiddenKanban) {
      return orderedStatuses;
    }

    const hidden = new Set(state.hiddenKanbanStatuses);
    return orderedStatuses.filter((status) => !hidden.has(status));
  });

  const hiddenStatuses = $derived.by(() => {
    const hidden = new Set(state.hiddenKanbanStatuses);
    return orderedStatuses.filter((status) => hidden.has(status));
  });

  const kanbanColumnPickerItems = $derived.by(() => {
    const hidden = new Set(state.hiddenKanbanStatuses);
    return orderedStatuses.map((status) => ({
      id: status,
      label: status,
      visible: !hidden.has(status),
      hideable: true,
    }));
  });

  const kanbanCardPickerItems = $derived.by(() =>
    state.availableKanbanCardFields.map((field) => ({
      id: field.id,
      label: field.label,
      visible: state.kanbanCardFields.some((visibleField) => visibleField.id === field.id),
      hideable: field.id !== "name",
      draggable: false,
    }))
  );

  $effect(() => {
    if (statusColumnOrder.length === 0) {
      statusColumnOrder = [...statusOptions];
      return;
    }

    const preserved = statusColumnOrder.filter((status) => statusOptions.includes(status));
    const missing = statusOptions.filter((status) => !preserved.includes(status));
    const nextOrder = [...preserved, ...missing];
    if (
      nextOrder.length !== statusColumnOrder.length ||
      nextOrder.some((status, index) => statusColumnOrder[index] !== status)
    ) {
      statusColumnOrder = nextOrder;
    }
  });

  function allowDrop(event: DragEvent): void {
    event.preventDefault();
  }

  function handleDragStart(event: DragEvent, path: string): void {
    draggingPath = path;
    event.dataTransfer?.setData("text/project-path", path);
    event.dataTransfer?.setData("text/plain", path);
    event.dataTransfer?.setData("application/x-project-path", path);
    const dragSource = event.currentTarget;
    if (event.dataTransfer && dragSource instanceof HTMLElement) {
      const rect = dragSource.getBoundingClientRect();
      const rawOffsetX = event.clientX - rect.left;
      const rawOffsetY = event.clientY - rect.top;
      const fallbackOffset = 12;
      const offsetX = Number.isFinite(rawOffsetX)
        ? Math.min(Math.max(rawOffsetX, 0), Math.max(rect.width - 1, 0))
        : fallbackOffset;
      const offsetY = Number.isFinite(rawOffsetY)
        ? Math.min(Math.max(rawOffsetY, 0), Math.max(rect.height - 1, 0))
        : fallbackOffset;
      event.dataTransfer.setDragImage(dragSource, offsetX, offsetY);
    }
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
    }
  }

  function handleDragEnd(): void {
    draggingPath = null;
  }

  function handleDrop(event: DragEvent, status: string): void {
    event.preventDefault();
    const droppedPath =
      event.dataTransfer?.getData("text/project-path") ||
      event.dataTransfer?.getData("application/x-project-path") ||
      draggingPath;

    if (!droppedPath) {
      return;
    }

    void viewStore.updateProject({
      path: droppedPath,
      key: "status",
      value: status,
    });

    draggingPath = null;
  }

  function handleProjectLinkClick(event: MouseEvent, path: string): void {
    event.preventDefault();
    void viewStore.openProject(path);
  }

  function handleCellLinkClick(event: MouseEvent, linkReference: string, sourcePath: string): void {
    event.preventDefault();
    void viewStore.openProjectLink(linkReference, sourcePath);
  }

  function handleAddProjectInStatus(status: string): void {
    void viewStore.createProjectNoteInCurrentAreaWithStatus(status);
  }

  function handleKanbanColumnVisibility(status: string, visible: boolean): void {
    const hidden = new Set(state.hiddenKanbanStatuses);
    if (visible) {
      hidden.delete(status);
    } else {
      hidden.add(status);
    }

    void viewStore.setKanbanHiddenStatuses(Array.from(hidden));
  }

  function handleKanbanColumnOrder(orderedIds: string[]): void {
    statusColumnOrder = [...orderedIds];
  }

  function handleKanbanCardFieldVisibility(fieldId: string, visible: boolean): void {
    const selected = new Set(state.kanbanCardFields.map((field) => field.id));
    if (visible) {
      selected.add(fieldId);
    } else {
      selected.delete(fieldId);
    }

    const nextIds = state.availableKanbanCardFields
      .map((field) => field.id)
      .filter((id) => selected.has(id));
    void viewStore.setKanbanCardFields(nextIds);
  }

  function handleKanbanNextTaskCountChange(event: Event): void {
    const rawValue = Number((event.currentTarget as HTMLInputElement).value);
    if (!Number.isFinite(rawValue) || rawValue < 1) {
      return;
    }

    void viewStore.setKanbanNextTaskCount(rawValue);
  }

  function checkboxVisualState(node: HTMLInputElement, taskState: TaskState): { update: (nextState: TaskState) => void } {
    applyCheckboxVisual(node, taskState);

    return {
      update(nextState: TaskState): void {
        applyCheckboxVisual(node, nextState);
      },
    };
  }

  function nextTaskState(task: ProjectTask): TaskState {
    if (!state.triStateCheckboxes) {
      return task.state === "checked" ? "unchecked" : "checked";
    }

    if (task.state === "unchecked") {
      return "in-progress";
    }

    if (task.state === "in-progress") {
      return "checked";
    }

    return "unchecked";
  }

  function applyCheckboxVisual(node: HTMLInputElement, taskState: TaskState): void {
    node.dataset.taskState = taskState;
    node.checked = taskState === "checked";
    node.indeterminate = taskState === "in-progress";
    if (taskState === "in-progress") {
      node.setAttribute("aria-checked", "mixed");
    } else {
      node.setAttribute("aria-checked", taskState === "checked" ? "true" : "false");
    }
  }

  function handleNextTaskCheckboxClick(event: MouseEvent, task: ProjectTask): void {
    event.preventDefault();
    const nextState = nextTaskState(task);
    if (nextState === "checked" && completingTaskIds.includes(task.id)) {
      return;
    }

    const target = event.currentTarget;
    if (target instanceof HTMLInputElement) {
      applyCheckboxVisual(target, nextState);
    }

    if (nextState === "checked") {
      completingTaskIds = [...completingTaskIds, task.id];
    } else {
      completingTaskIds = completingTaskIds.filter((taskId) => taskId !== task.id);
    }

    void viewStore.setTaskState(task.id, nextState).finally(() => {
      completingTaskIds = completingTaskIds.filter((taskId) => taskId !== task.id);
    });
  }

  function incompleteTasks(project: ProjectNote): ProjectTask[] {
    return project.tasks.filter((task) => task.state !== "checked" && !completingTaskIds.includes(task.id));
  }

  function nextTasks(project: ProjectNote): ProjectTask[] {
    return incompleteTasks(project).slice(0, state.kanbanNextTaskCount);
  }

  function nextTasksLabel(shownCount: number, totalCount: number): string {
    const safeShownCount = Math.max(0, shownCount);
    const safeTotalCount = Math.max(0, totalCount);
    const base = safeShownCount === 1 ? "Next Task" : `Next ${safeShownCount} Tasks`;
    if (safeTotalCount > safeShownCount) {
      return `${base} (out of ${safeTotalCount})`;
    }

    return base;
  }

  function getTaskDisplayText(task: ProjectTask): string {
    const displayText = task.text.replace(TASK_DATE_TOKEN_REGEX, "").replace(/\s{2,}/g, " ").trim();
    return displayText.length > 0 ? displayText : task.text;
  }

  function customPropertyValue(project: ProjectNote, fieldId: string): string {
    const propertyKey = fieldId.startsWith("property:") ? fieldId.slice("property:".length) : "";
    if (!propertyKey) {
      return "";
    }

    return project.customProperties?.[propertyKey] ?? "";
  }

  function normalizeWhitespace(value: string): string {
    return value
      .replace(/\r?\n/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function truncateWords(value: string, maxWords: number): { truncated: boolean } {
    const normalized = normalizeWhitespace(value);
    if (normalized.length === 0) {
      return { truncated: false };
    }

    const words = normalized.split(" ");
    const safeLimit = Math.max(1, Math.floor(maxWords));
    return { truncated: words.length > safeLimit };
  }

  function exceedsLineLimit(markdown: string, maxLines: number): boolean {
    const safeLimit = Math.max(1, Math.floor(maxLines));
    const nonEmptyLines = markdown.split(/\r?\n/u).filter((line) => line.trim().length > 0);
    return nonEmptyLines.length > safeLimit;
  }

  function notesMarkdownText(project: ProjectNote): string {
    return (project.notesSectionText ?? "").trim();
  }

  function notesPreview(project: ProjectNote): { truncated: boolean } {
    const markdown = notesMarkdownText(project);
    const wordTruncated = truncateWords(markdown, state.kanbanNotesPreviewWords).truncated;
    const lineTruncated = exceedsLineLimit(markdown, state.kanbanNotesPreviewLines);
    const measuredOverflow = notesLineOverflowByPath[project.path] === true;
    return { truncated: wordTruncated || lineTruncated || measuredOverflow };
  }

  function setNotesLineOverflow(path: string, overflow: boolean): void {
    if (notesLineOverflowByPath[path] === overflow) {
      return;
    }

    notesLineOverflowByPath = {
      ...notesLineOverflowByPath,
      [path]: overflow,
    };
  }

  function measureNotesLineOverflow(path: string, host: HTMLElement): void {
    const preview = host.closest(".opn-kanban-notes-preview");
    if (!(preview instanceof HTMLElement)) {
      return;
    }

    requestAnimationFrame(() => {
      const overflow = preview.scrollHeight > preview.clientHeight + 1;
      setNotesLineOverflow(path, overflow);
    });
  }

  function renderMarkdown(node: HTMLElement, params: MarkdownRenderParams): {
    update: (next: MarkdownRenderParams) => void;
    destroy: () => void;
  } {
    const component = new Component();
    component.load();

    let destroyed = false;
    let activeHost: HTMLElement | null = null;

    const render = async (next: MarkdownRenderParams): Promise<void> => {
      const host = document.createElement("div");
      host.classList.add("markdown-rendered");
      node.replaceChildren(host);
      activeHost = host;

      const markdown = next.markdown.trim();
      if (markdown.length === 0) {
        next.onRendered?.(host);
        return;
      }

      await MarkdownRenderer.renderMarkdown(markdown, host, next.sourcePath, component);

      if (destroyed || activeHost !== host) {
        host.replaceChildren();
        return;
      }

      next.onRendered?.(host);
    };

    void render(params);

    return {
      update(next: MarkdownRenderParams): void {
        void render(next);
      },
      destroy(): void {
        destroyed = true;
        activeHost = null;
        node.replaceChildren();
        component.unload();
      },
    };
  }

  function localIsoDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function relativeLocalIsoDate(daysFromToday: number): string {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + daysFromToday);
    return localIsoDate(date);
  }

  function isTerminalProjectStatus(status: string | undefined): boolean {
    const normalized = (status ?? "").trim().toLowerCase();
    return normalized === "done" || normalized === "cancelled" || normalized === "canceled";
  }

  function projectTimingStatuses(project: ProjectNote): string[] {
    const timing: string[] = [];
    const today = relativeLocalIsoDate(0);
    const tomorrow = relativeLocalIsoDate(1);
    const terminalStatus = isTerminalProjectStatus(project.status) || Boolean(project.finishDate);

    if (
      !terminalStatus &&
      project.startDate &&
      project.dueDate &&
      project.startDate <= today &&
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

    if (!terminalStatus && project.startDate === tomorrow) {
      timing.push("Tomorrow");
    }

    if (!terminalStatus && project.startDate && project.startDate > tomorrow) {
      timing.push("Future");
    }

    if (!terminalStatus && !project.startDate && !project.dueDate) {
      timing.push("Needs Timing");
    }

    return timing;
  }

  function badgeToken(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function toggleNotesExpanded(path: string): void {
    expandedNotesByPath[path] = !expandedNotesByPath[path];
  }

  function isNotesExpanded(path: string): boolean {
    return expandedNotesByPath[path] === true;
  }

  function parseWikiLink(value: string): { target: string; label: string; reference: string } | null {
    const trimmed = value.trim();
    const match = trimmed.match(/^\[\[([^\]]+)\]\]$/u);
    if (!match) {
      return null;
    }

    const inner = match[1];
    const [targetRaw = "", aliasRaw = ""] = inner.split("|", 2);
    const target = (targetRaw.split("#", 1)[0] ?? "").trim();
    if (target.length === 0) {
      return null;
    }

    const alias = aliasRaw.trim();
    return {
      target,
      label: alias.length > 0 ? alias : target,
      reference: `[[${inner}]]`,
    };
  }

  function parseCellSegments(value: string): CellSegment[] {
    const segments: CellSegment[] = [];
    let cursor = 0;

    while (cursor < value.length) {
      const nextWiki = findRegexMatchFrom(WIKI_LINK_REGEX, value, cursor);
      const nextMarkdownExternal = findRegexMatchFrom(MARKDOWN_EXTERNAL_LINK_REGEX, value, cursor);
      const nextExternalUrl = findRegexMatchFrom(EXTERNAL_URL_REGEX, value, cursor);
      const nextMatch = earliestSegmentMatch(nextWiki, nextMarkdownExternal, nextExternalUrl);

      if (!nextMatch) {
        segments.push({
          text: value.slice(cursor),
          linkReference: null,
          target: null,
          externalUrl: null,
        });
        cursor = value.length;
        break;
      }

      if (nextMatch.start > cursor) {
        segments.push({
          text: value.slice(cursor, nextMatch.start),
          linkReference: null,
          target: null,
          externalUrl: null,
        });
      }

      if (nextMatch.type === "wiki") {
        const parsed = parseWikiLink(nextMatch.text);
        if (parsed) {
          segments.push({
            text: parsed.label,
            linkReference: parsed.reference,
            target: parsed.target,
            externalUrl: null,
          });
        } else {
          segments.push({
            text: nextMatch.text,
            linkReference: null,
            target: null,
            externalUrl: null,
          });
        }
      } else if (nextMatch.type === "markdown-external") {
        const [, labelRaw = "", hrefRaw = ""] = nextMatch.match;
        const label = labelRaw.trim();
        const href = hrefRaw.trim();
        if (href.length > 0) {
          segments.push({
            text: label.length > 0 ? label : href,
            linkReference: null,
            target: null,
            externalUrl: href,
          });
        } else {
          segments.push({
            text: nextMatch.text,
            linkReference: null,
            target: null,
            externalUrl: null,
          });
        }
      } else {
        const urlMatch = splitTrailingUrlPunctuation(nextMatch.text);
        segments.push({
          text: urlMatch.url,
          linkReference: null,
          target: null,
          externalUrl: urlMatch.url,
        });
        if (urlMatch.trailing.length > 0) {
          segments.push({
            text: urlMatch.trailing,
            linkReference: null,
            target: null,
            externalUrl: null,
          });
        }
      }

      cursor = nextMatch.end;
    }

    if (segments.length === 0) {
      segments.push({
        text: value,
        linkReference: null,
        target: null,
        externalUrl: null,
      });
    }

    return segments;
  }

  function findRegexMatchFrom(regex: RegExp, value: string, fromIndex: number): RegExpExecArray | null {
    regex.lastIndex = fromIndex;
    return regex.exec(value);
  }

  function earliestSegmentMatch(
    wiki: RegExpExecArray | null,
    markdownExternal: RegExpExecArray | null,
    externalUrl: RegExpExecArray | null,
  ): { type: LinkMatchType; start: number; end: number; text: string; match: RegExpExecArray } | null {
    const candidates: Array<{ type: LinkMatchType; start: number; end: number; text: string; match: RegExpExecArray }> = [];

    if (wiki && typeof wiki.index === "number") {
      candidates.push({
        type: "wiki",
        start: wiki.index,
        end: wiki.index + wiki[0].length,
        text: wiki[0],
        match: wiki,
      });
    }

    if (markdownExternal && typeof markdownExternal.index === "number") {
      candidates.push({
        type: "markdown-external",
        start: markdownExternal.index,
        end: markdownExternal.index + markdownExternal[0].length,
        text: markdownExternal[0],
        match: markdownExternal,
      });
    }

    if (externalUrl && typeof externalUrl.index === "number") {
      candidates.push({
        type: "external-url",
        start: externalUrl.index,
        end: externalUrl.index + externalUrl[0].length,
        text: externalUrl[0],
        match: externalUrl,
      });
    }

    if (candidates.length === 0) {
      return null;
    }

    candidates.sort((left, right) => left.start - right.start);
    return candidates[0];
  }

  function splitTrailingUrlPunctuation(value: string): { url: string; trailing: string } {
    const match = value.match(/^(.*?)([.,!?;:]+)?$/u);
    if (!match) {
      return { url: value, trailing: "" };
    }

    const url = match[1] || value;
    const trailing = match[2] || "";
    return { url, trailing };
  }
</script>

{#snippet cardPickerExtra()}
  <div class="opn-column-picker-extra">
    <label class="opn-inline-select">
      <span>Next Task(s)</span>
      <input
        type="number"
        min="1"
        value={String(state.kanbanNextTaskCount)}
        onchange={handleKanbanNextTaskCountChange}
      />
    </label>
  </div>
{/snippet}

<div class={`opn-kanban opn-${variant}`}>
  <section class="opn-grid-controls">
    <div class="opn-grid-filter-row opn-projects-controls">
      <div class="opn-grid-filter-left">
        <SearchInput
          ariaLabel="Search projects"
          placeholder="Search Projects"
          value={state.projectSearch}
          onChange={(value) => viewStore.setProjectSearch(value)}
        />

        <ColumnPicker
          label="Columns"
          items={kanbanColumnPickerItems}
          onToggle={handleKanbanColumnVisibility}
          onReorder={handleKanbanColumnOrder}
        />
        <ColumnPicker
          label="Card"
          items={kanbanCardPickerItems}
          onToggle={handleKanbanCardFieldVisibility}
          allowReorder={false}
          extraContent={cardPickerExtra}
        />
      </div>

      <div class="opn-grid-filter-right">
        <button type="button" class="mod-cta" onclick={() => void viewStore.createProjectNote()}>
          Add Project
        </button>
      </div>
    </div>
  </section>

  <div class="opn-kanban-scroll">
    <div class="opn-kanban-columns" role="region">
      {#each visibleStatuses as status (status)}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <section
          class="opn-kanban-column"
          ondragover={allowDrop}
          ondrop={(event) => handleDrop(event, status)}
        >
          <header>
            <div class="opn-kanban-column-title">
              <h3>{status}</h3>
              <button
                type="button"
                class="secondary opn-kanban-add"
                onclick={() => handleAddProjectInStatus(status)}
              >
                +
              </button>
            </div>
            <span>{projectsByStatus.get(status)?.length ?? 0}</span>
          </header>

          <div class="opn-kanban-cards">
            {#each projectsByStatus.get(status) ?? [] as project (project.path)}
              <article
                class="opn-kanban-card"
                draggable="true"
                ondragstart={(event) => handleDragStart(event, project.path)}
                ondragend={handleDragEnd}
              >
                {#each state.kanbanCardFields as field (field.id)}
                  {#if field.id === "name"}
                    <a
                      href={encodeURI(project.path)}
                      class="opn-link"
                      draggable="false"
                      onclick={(event) => handleProjectLinkClick(event, project.path)}
                    >
                      {project.displayName}
                    </a>
                  {:else if field.id === "priority" || field.id === "timing-status"}
                    {""}
                  {:else if field.id === "start-date"}
                    {#if project.startDate}
                      <div class="opn-kanban-field-row">
                        <span class="opn-kanban-field-label">Start</span>
                        <span class="opn-kanban-field-value">{project.startDate}</span>
                      </div>
                    {/if}
                  {:else if field.id === "due-date"}
                    {#if project.dueDate}
                      <div class="opn-kanban-field-row">
                        <span class="opn-kanban-field-label">Due</span>
                        <span class="opn-kanban-field-value">{project.dueDate}</span>
                      </div>
                    {/if}
                  {:else if field.id === "finish-date"}
                    {#if project.finishDate}
                      <div class="opn-kanban-field-row">
                        <span class="opn-kanban-field-label">Finish</span>
                        <span class="opn-kanban-field-value">{project.finishDate}</span>
                      </div>
                    {/if}
                  {:else if field.id === "requester"}
                    {@const requesterValue = project.requester
                      .map((entry) => entry.trim())
                      .filter((entry) => entry.length > 0)
                      .join(", ")}
                    {#if requesterValue.length > 0}
                      <div class="opn-kanban-field-row">
                        <span class="opn-kanban-field-label">Requester</span>
                        <span class="opn-kanban-field-value">
                          {#each parseCellSegments(requesterValue) as segment, index (`${project.path}:requester:${index}`)}
                            {#if segment.linkReference}
                              <a
                                href={encodeURI(segment.target ?? "")}
                                class="opn-link"
                                onclick={(event) => handleCellLinkClick(event, segment.linkReference ?? "", project.path)}
                              >
                                {segment.text}
                              </a>
                            {:else if segment.externalUrl}
                              <a
                                href={segment.externalUrl}
                                class="opn-link"
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                {segment.text}
                              </a>
                            {:else}
                              {segment.text}
                            {/if}
                          {/each}
                        </span>
                      </div>
                    {/if}
                  {:else if field.id === "count-tasks"}
                    <div class="opn-kanban-field-row">
                      <span class="opn-kanban-field-label">Tasks</span>
                      <span class="opn-kanban-field-value">{project.tasks.length}</span>
                    </div>
                  {:else if field.id === "next-tasks"}
                    {@const availableTasks = incompleteTasks(project)}
                    {@const tasks = nextTasks(project)}
                    {#if tasks.length > 0}
                      <div class="opn-kanban-field-row opn-kanban-next-tasks">
                        <span class="opn-kanban-field-label">{nextTasksLabel(tasks.length, availableTasks.length)}</span>
                        <span class="opn-kanban-field-value">
                          <ul>
                            {#each tasks as task (task.id)}
                              <li>
                                <input
                                  type="checkbox"
                                  class="opn-task-checkbox"
                                  checked={task.state === "checked"}
                                  use:checkboxVisualState={task.state}
                                  onclick={(event) => handleNextTaskCheckboxClick(event, task)}
                                />
                                <span>{getTaskDisplayText(task)}</span>
                              </li>
                            {/each}
                          </ul>
                        </span>
                      </div>
                    {/if}
                  {:else if field.id === "notes"}
                    {@const fullNotes = notesMarkdownText(project)}
                    {@const preview = notesPreview(project)}
                    {@const expanded = isNotesExpanded(project.path)}
                    {#if fullNotes.length > 0}
                      <div class="opn-kanban-notes-block">
                        <span class="opn-kanban-field-label">Notes</span>
                        <div class="opn-kanban-notes">
                          {#if preview.truncated}
                            {#if expanded}
                              <div class="opn-kanban-notes-full" transition:slide>
                                <div
                                  class="opn-kanban-markdown"
                                  use:renderMarkdown={{ markdown: fullNotes, sourcePath: project.path }}
                                ></div>
                              </div>
                              <button
                                type="button"
                                class="opn-link-button opn-kanban-notes-toggle"
                                onclick={() => toggleNotesExpanded(project.path)}
                              >
                                Read Less
                              </button>
                            {:else}
                              <div
                                class="opn-kanban-notes-preview"
                                style={`--opn-notes-preview-lines: ${state.kanbanNotesPreviewLines};`}
                                transition:fade
                              >
                                <div
                                  class="opn-kanban-markdown"
                                  use:renderMarkdown={{
                                    markdown: fullNotes,
                                    sourcePath: project.path,
                                    onRendered: (host) => measureNotesLineOverflow(project.path, host),
                                  }}
                                ></div>
                              </div>
                              <button
                                type="button"
                                class="opn-link-button opn-kanban-notes-toggle"
                                onclick={() => toggleNotesExpanded(project.path)}
                              >
                                Read More
                              </button>
                            {/if}
                          {:else}
                            <div class="opn-kanban-notes-full">
                              <div
                                class="opn-kanban-markdown"
                                use:renderMarkdown={{ markdown: fullNotes, sourcePath: project.path }}
                              ></div>
                            </div>
                          {/if}
                        </div>
                      </div>
                    {/if}
                  {:else if field.id.startsWith("property:")}
                    {@const propertyValue = customPropertyValue(project, field.id).trim()}
                    {#if propertyValue.length > 0}
                      <div class="opn-kanban-field-row">
                        <span class="opn-kanban-field-label">{field.label}</span>
                        <span class="opn-kanban-field-value">
                          {#each parseCellSegments(propertyValue) as segment, index (`${project.path}:${field.id}:${index}`)}
                            {#if segment.linkReference}
                              <a
                                href={encodeURI(segment.target ?? "")}
                                class="opn-link"
                                onclick={(event) => handleCellLinkClick(event, segment.linkReference ?? "", project.path)}
                              >
                                {segment.text}
                              </a>
                            {:else if segment.externalUrl}
                              <a
                                href={segment.externalUrl}
                                class="opn-link"
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                {segment.text}
                              </a>
                            {:else}
                              {segment.text}
                            {/if}
                          {/each}
                        </span>
                      </div>
                    {/if}
                  {/if}
                {/each}

                {#if state.kanbanCardFields.some((field) => field.id === "timing-status") || state.kanbanCardFields.some((field) => field.id === "priority")}
                  <div class="opn-kanban-card-footer">
                    <div class="opn-kanban-card-footer-left">
                      {#if state.kanbanCardFields.some((field) => field.id === "timing-status")}
                        {@const timingStatuses = projectTimingStatuses(project)}
                        {#if timingStatuses.length > 0}
                          <div class="opn-task-timing-badges">
                            {#each timingStatuses as timing (timing)}
                              <span class={`opn-task-timing-badge opn-task-timing-${badgeToken(timing)}`}>
                                {timing}
                              </span>
                            {/each}
                          </div>
                        {/if}
                      {/if}
                    </div>
                    <div class="opn-kanban-card-footer-right">
                      {#if state.kanbanCardFields.some((field) => field.id === "priority") && project.priority.trim().length > 0}
                        <span class="opn-card-priority-text">
                          {project.priority}
                        </span>
                      {/if}
                    </div>
                  </div>
                {/if}
              </article>
            {/each}
          </div>
        </section>
      {/each}
    </div>

    {#if !state.showHiddenKanban && hiddenStatuses.length > 0}
      <aside class="opn-kanban-dropzones">
        {#each hiddenStatuses as status (status)}
          <div
            class="opn-kanban-dropzone"
            role="region"
            ondragover={allowDrop}
            ondrop={(event) => handleDrop(event, status)}
          >
            <strong>{status}</strong>
            <span>Drop here</span>
          </div>
        {/each}
      </aside>
    {/if}
  </div>
</div>
