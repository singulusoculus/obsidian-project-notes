<script lang="ts">
  import { fromStore } from "svelte/store";
  import type {
    ProjectGridColumn,
    ProjectNote,
    ProjectSortField,
    ProjectTask,
    TaskState,
    ViewVariant,
  } from "../lib/types";
  import type { ProjectViewStore } from "../lib/stores/projectViewStore";

  let { viewStore, variant } = $props<{ viewStore: ProjectViewStore; variant: ViewVariant }>();

  const state = $derived.by(() => fromStore(viewStore.state).current);

  let expandedProjects = $state<Record<string, boolean>>({});
  let showCompletedTasks = $state<Record<string, boolean>>({});
  let showColumnPicker = $state(false);
  let draggingVisibleColumnId = $state<string | null>(null);
  let columnPickerOrder = $state<string[]>([]);

  const statusOptions = $derived.by(() => {
    const values = new Set(state.statuses);
    if (state.projects.some((project) => project.statusIsUnknown)) {
      values.add("Unknown");
    }
    return Array.from(values);
  });

  const sortedTasksByProject = $derived.by(() => {
    const result = new Map<string, ProjectTask[]>();
    for (const project of state.projects) {
      const tasks = [...project.tasks].sort((left, right) => {
        if (left.checked !== right.checked) {
          return left.checked ? 1 : -1;
        }

        if (left.finishedDate && right.finishedDate) {
          return right.finishedDate.localeCompare(left.finishedDate);
        }

        return left.line - right.line;
      });

      result.set(project.path, tasks);
    }
    return result;
  });

  const orderedPickerColumns = $derived.by(() => {
    const availableById = new Map(state.availableProjectGridColumns.map((column) => [column.id, column]));
    const orderedIds = columnPickerOrder.length > 0
      ? columnPickerOrder
      : [
          ...state.projectGridColumns.map((column) => column.id),
          ...state.availableProjectGridColumns
            .map((column) => column.id)
            .filter((id) => !state.projectGridColumns.some((visible) => visible.id === id)),
        ];

    return orderedIds
      .map((id) => availableById.get(id))
      .filter((column): column is ProjectGridColumn => column !== undefined);
  });

  $effect(() => {
    const availableIds = state.availableProjectGridColumns.map((column) => column.id);

    if (columnPickerOrder.length === 0) {
      columnPickerOrder = [...availableIds];
      return;
    }

    const preserved = columnPickerOrder.filter((id) => availableIds.includes(id));
    const missing = availableIds.filter((id) => !preserved.includes(id));
    const nextOrder = [...preserved, ...missing];

    if (
      nextOrder.length !== columnPickerOrder.length ||
      nextOrder.some((id, index) => columnPickerOrder[index] !== id)
    ) {
      columnPickerOrder = nextOrder;
    }
  });

  function toggleExpand(path: string): void {
    expandedProjects[path] = !expandedProjects[path];
  }

  function toggleCompleted(path: string): void {
    showCompletedTasks[path] = !showCompletedTasks[path];
  }

  function shouldShowTask(path: string, task: ProjectTask): boolean {
    if (!task.checked) {
      return true;
    }

    return showCompletedTasks[path] ?? false;
  }

  function sortByColumn(field: ProjectSortField): void {
    const nextDirection = state.sortBy === field && state.sortDirection === "asc" ? "desc" : "asc";
    viewStore.setSort(field, nextDirection);
  }

  function sortMarker(field: ProjectSortField): string {
    if (state.sortBy !== field) {
      return "";
    }
    return state.sortDirection === "asc" ? "↑" : "↓";
  }

  function headerSortState(field: ProjectSortField): "ascending" | "descending" | "none" {
    if (state.sortBy !== field) {
      return "none";
    }
    return state.sortDirection === "asc" ? "ascending" : "descending";
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

  function handleTaskCheckboxClick(event: MouseEvent, task: ProjectTask): void {
    event.preventDefault();
    const nextState = nextTaskState(task);
    const target = event.currentTarget;
    if (target instanceof HTMLInputElement) {
      applyCheckboxVisual(target, nextState);
    }
    void viewStore.setTaskState(task.id, nextState);
  }

  function handleSortHeaderKeydown(event: KeyboardEvent, field: ProjectSortField): void {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      sortByColumn(field);
    }
  }

  function toggleColumnPicker(): void {
    showColumnPicker = !showColumnPicker;
  }

  function isColumnVisible(columnId: string): boolean {
    return state.projectGridColumns.some((column) => column.id === columnId);
  }

  function setColumnVisibility(columnId: string, checked: boolean): void {
    const visible = new Set(state.projectGridColumns.map((column) => column.id));
    if (checked) {
      visible.add(columnId);
    } else {
      visible.delete(columnId);
    }

    const nextVisibleIds = columnPickerOrder.filter((id) => visible.has(id));
    void viewStore.setProjectGridColumns(nextVisibleIds);
  }

  function handleColumnVisibilityChange(columnId: string, event: Event): void {
    const checked = (event.currentTarget as HTMLInputElement).checked;
    setColumnVisibility(columnId, checked);
  }

  function handleVisibleColumnDragStart(event: DragEvent, columnId: string): void {
    draggingVisibleColumnId = columnId;
    if (event.dataTransfer) {
      event.dataTransfer.setData("text/plain", columnId);
      event.dataTransfer.effectAllowed = "move";
    }
  }

  function handleVisibleColumnDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
  }

  function handleVisibleColumnDrop(event: DragEvent, targetColumnId: string): void {
    event.preventDefault();
    const sourceColumnId = event.dataTransfer?.getData("text/plain") || draggingVisibleColumnId;
    draggingVisibleColumnId = null;
    if (!sourceColumnId || sourceColumnId === targetColumnId) {
      return;
    }

    const currentIds = [...columnPickerOrder];
    const sourceIndex = currentIds.indexOf(sourceColumnId);
    const targetIndex = currentIds.indexOf(targetColumnId);
    if (sourceIndex < 0 || targetIndex < 0) {
      return;
    }

    const nextIds = [...currentIds];
    const [moved] = nextIds.splice(sourceIndex, 1);
    nextIds.splice(targetIndex, 0, moved);
    columnPickerOrder = nextIds;

    const visible = new Set(state.projectGridColumns.map((column) => column.id));
    const nextVisibleIds = nextIds.filter((id) => visible.has(id));
    void viewStore.setProjectGridColumns(nextVisibleIds);
  }

  function handleVisibleColumnDragEnd(): void {
    draggingVisibleColumnId = null;
  }

  function handleStatusChange(project: ProjectNote, event: Event): void {
    const value = (event.currentTarget as HTMLSelectElement).value;
    void viewStore.updateProject({
      path: project.path,
      key: "status",
      value,
    });
  }

  function handlePriorityChange(project: ProjectNote, event: Event): void {
    const value = (event.currentTarget as HTMLSelectElement).value;
    void viewStore.updateProject({
      path: project.path,
      key: "priority",
      value,
    });
  }

  function handleProjectLinkClick(event: MouseEvent, path: string): void {
    event.preventDefault();
    void viewStore.openProject(path);
  }

  function customPropertyValue(project: ProjectNote, column: ProjectGridColumn): string {
    const key = column.propertyKey;
    if (!key) {
      return "";
    }

    return project.customProperties?.[key] ?? "";
  }

  const TASK_DATE_TOKEN_REGEX = /(?:🛫|📅|✅)\s*\d{4}-\d{2}-\d{2}/gu;

  function getTaskDisplayText(task: ProjectTask): string {
    const displayText = task.text.replace(TASK_DATE_TOKEN_REGEX, "").replace(/\s{2,}/g, " ").trim();
    return displayText.length > 0 ? displayText : task.text;
  }
</script>

<div class={`opn-grid opn-${variant}`}>
  <section class="opn-grid-controls" aria-label="Grid controls">
    <div class="opn-grid-tabs" role="tablist" aria-label="Grid tabs">
      <button
        type="button"
        role="tab"
        aria-selected={state.gridTab === "projects"}
        class:active={state.gridTab === "projects"}
        onclick={() => viewStore.setGridTab("projects")}
      >
        Projects
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={state.gridTab === "tasks"}
        class:active={state.gridTab === "tasks"}
        onclick={() => viewStore.setGridTab("tasks")}
      >
        Tasks
      </button>
    </div>

    {#if state.gridTab === "projects"}
      <div class="opn-grid-filter-row">
        <label>
          Search all columns
          <input
            aria-label="Search all project columns"
            type="text"
            value={state.projectSearch}
            oninput={(event) => viewStore.setProjectSearch((event.currentTarget as HTMLInputElement).value)}
          />
        </label>

        <div class="opn-column-picker-wrap">
          <button
            type="button"
            class="secondary"
            aria-haspopup="dialog"
            aria-expanded={showColumnPicker}
            onclick={toggleColumnPicker}
          >
            Columns
          </button>

          {#if showColumnPicker}
            <div class="opn-column-picker" role="dialog" aria-label="Project grid column settings">
              <section>
                <strong>Columns</strong>
                <ul class="opn-column-order-list">
                  {#each orderedPickerColumns as column (column.id)}
                    <li
                      draggable={column.id !== "project"}
                      class:dragging={draggingVisibleColumnId === column.id}
                      ondragstart={(event) => handleVisibleColumnDragStart(event, column.id)}
                      ondragover={handleVisibleColumnDragOver}
                      ondrop={(event) => handleVisibleColumnDrop(event, column.id)}
                      ondragend={handleVisibleColumnDragEnd}
                    >
                      <span class="opn-column-drag-handle" aria-hidden="true">{column.id === "project" ? "•" : "⋮⋮"}</span>
                      <span class="opn-column-name">{column.label}</span>
                      <input
                        type="checkbox"
                        checked={isColumnVisible(column.id)}
                        class="opn-column-visibility-toggle"
                        disabled={column.id === "project"}
                        onchange={(event) => handleColumnVisibilityChange(column.id, event)}
                      />
                    </li>
                  {/each}
                </ul>
              </section>
            </div>
          {/if}
        </div>
      </div>

      <div class="opn-filter-groups">
        <div class="opn-filter-group" aria-label="Status filters">
          <span>Status</span>
          <button type="button" class="secondary" onclick={() => viewStore.clearStatusFilter()}>
            Clear
          </button>
          {#each statusOptions as status (status)}
            <label>
              <input
                type="checkbox"
                checked={state.statusFilter.includes(status)}
                onchange={() => viewStore.toggleStatusFilter(status)}
              />
              {status}
            </label>
          {/each}
        </div>

        <div class="opn-filter-group" aria-label="Priority filters">
          <span>Priority</span>
          <button type="button" class="secondary" onclick={() => viewStore.clearPriorityFilter()}>
            Clear
          </button>
          {#each state.priorities as priority (priority)}
            <label>
              <input
                type="checkbox"
                checked={state.priorityFilter.includes(priority)}
                onchange={() => viewStore.togglePriorityFilter(priority)}
              />
              {priority}
            </label>
          {/each}
        </div>

        {#if state.availableAreaTags.length > 0}
          <div class="opn-filter-group" aria-label="Area tag filters">
            <span>Area Tags</span>
            <button type="button" class="secondary" onclick={() => viewStore.clearAreaTagFilter()}>
              Clear
            </button>
            {#each state.availableAreaTags as tag (tag)}
              <label>
                <input
                  type="checkbox"
                  checked={state.areaTagFilter.includes(tag)}
                  onchange={() => viewStore.toggleAreaTagFilter(tag)}
                />
                {tag}
              </label>
            {/each}
          </div>
        {/if}
      </div>
    {:else}
      <div class="opn-grid-filter-row">
        <label>
          Search tasks
          <input
            aria-label="Search tasks"
            type="text"
            value={state.taskSearch}
            oninput={(event) => viewStore.setTaskSearch((event.currentTarget as HTMLInputElement).value)}
          />
        </label>

        <button type="button" class="mod-cta" onclick={() => void viewStore.createTaskInCurrentArea()}>
          Add Task
        </button>

        <button
          type="button"
          class="secondary"
          onclick={() => viewStore.toggleTaskViewCompletedVisibility()}
        >
          {state.showCompletedTasksInTaskView ? "Hide completed" : "Show completed"}
        </button>
      </div>
    {/if}
  </section>

  {#if state.gridTab === "projects"}
    <table class="opn-table" aria-label="Projects grid">
      <thead>
        <tr>
          <th></th>
          {#each state.projectGridColumns as column (column.id)}
            <th aria-sort={column.sortField ? headerSortState(column.sortField) : undefined}>
              {#if column.sortField}
                <span
                  class="opn-sort-header"
                  role="button"
                  tabindex="0"
                  onclick={() => sortByColumn(column.sortField)}
                  onkeydown={(event) => handleSortHeaderKeydown(event, column.sortField)}
                >
                  <span>{column.label}</span>
                  <span class="opn-sort-marker">{sortMarker(column.sortField)}</span>
                </span>
              {:else}
                <span>{column.label}</span>
              {/if}
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each state.projects as project (project.path)}
          <tr>
            <td>
              {#if project.tasks.length > 0}
                <button
                  type="button"
                  class="secondary"
                  aria-label={`Toggle tasks for ${project.displayName}`}
                  onclick={() => toggleExpand(project.path)}
                >
                  {expandedProjects[project.path] ? "▾" : "▸"}
                </button>
              {/if}
            </td>
            {#each state.projectGridColumns as column (column.id)}
              <td>
                {#if column.id === "project"}
                  <a
                    href={encodeURI(project.path)}
                    class="opn-link"
                    aria-label={`Open project note ${project.displayName}`}
                    onclick={(event) => handleProjectLinkClick(event, project.path)}
                  >
                    {project.displayName}
                  </a>
                {:else if column.id === "status"}
                  <select value={project.status} onchange={(event) => handleStatusChange(project, event)}>
                    {#each statusOptions as status (status)}
                      <option value={status}>{status}</option>
                    {/each}
                  </select>
                {:else if column.id === "priority"}
                  <select value={project.priority} onchange={(event) => handlePriorityChange(project, event)}>
                    {#each state.priorities as priority (priority)}
                      <option value={priority}>{priority}</option>
                    {/each}
                  </select>
                {:else if column.id === "start-date"}
                  {project.startDate ?? ""}
                {:else if column.id === "finish-date"}
                  {project.finishDate ?? ""}
                {:else if column.id === "due-date"}
                  {project.dueDate ?? ""}
                {:else if column.id === "tags"}
                  {project.tags.join(", ")}
                {:else if column.id === "parent-project"}
                  {project.parentProject ?? ""}
                {:else if column.id === "requester"}
                  {project.requester.join(", ")}
                {:else if column.kind === "property"}
                  {customPropertyValue(project, column)}
                {:else}
                  {""}
                {/if}
              </td>
            {/each}
          </tr>

          {#if project.tasks.length > 0 && expandedProjects[project.path]}
            <tr class="opn-row-detail">
              <td colspan={state.projectGridColumns.length + 1}>
                <div class="opn-task-detail-header">
                  <strong>Tasks</strong>
                  <button
                    type="button"
                    class="secondary"
                    onclick={() => toggleCompleted(project.path)}
                    aria-label={`Toggle completed tasks for ${project.displayName}`}
                  >
                    {showCompletedTasks[project.path] ? "Hide completed" : "Show completed"}
                  </button>
                </div>

                <ul class="opn-task-list">
                  {#each sortedTasksByProject.get(project.path) ?? [] as task (task.id)}
                    {#if shouldShowTask(project.path, task)}
                      <li>
                        <input
                          type="checkbox"
                          class="opn-task-checkbox"
                          aria-label={`Toggle task ${getTaskDisplayText(task)}`}
                          checked={task.state === "checked"}
                          use:checkboxVisualState={task.state}
                          onclick={(event) => handleTaskCheckboxClick(event, task)}
                        />
                        <span>{task.text}</span>
                      </li>
                    {/if}
                  {/each}
                </ul>
              </td>
            </tr>
          {/if}
        {/each}
      </tbody>
    </table>
  {:else}
    <table class="opn-table" aria-label="Tasks grid">
      <thead>
        <tr>
          <th>Done</th>
          <th>Task</th>
          <th>Project</th>
          <th>Requester</th>
          <th>Start</th>
          <th>Due</th>
        </tr>
      </thead>
      <tbody>
        {#each state.tasks as task (task.id)}
          <tr>
            <td>
              <input
                aria-label={`Toggle task ${getTaskDisplayText(task)}`}
                type="checkbox"
                class="opn-task-checkbox"
                checked={task.state === "checked"}
                use:checkboxVisualState={task.state}
                onclick={(event) => handleTaskCheckboxClick(event, task)}
              />
            </td>
            <td>{getTaskDisplayText(task)}</td>
            <td>
              <a
                href={encodeURI(task.projectPath)}
                class="opn-link"
                aria-label={`Open project note ${task.projectName}`}
                onclick={(event) => handleProjectLinkClick(event, task.projectPath)}
              >
                {task.projectName}
              </a>
            </td>
            <td>{(task.projectRequester ?? []).join(", ")}</td>
            <td>{task.startDate ?? ""}</td>
            <td>{task.dueDate ?? ""}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>
