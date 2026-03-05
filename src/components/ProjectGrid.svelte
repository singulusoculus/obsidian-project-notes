<script lang="ts">
  import { fromStore } from "svelte/store";
  import type {
    ProjectNote,
    ProjectSortField,
    ProjectTask,
    SortDirection,
    ViewVariant,
  } from "../lib/types";
  import type { ProjectViewStore } from "../lib/stores/projectViewStore";
  import { formatTimestamp } from "../lib/utils/text";

  let { viewStore, variant } = $props<{ viewStore: ProjectViewStore; variant: ViewVariant }>();

  const state = $derived.by(() => fromStore(viewStore.state).current);

  let expandedProjects = $state<Record<string, boolean>>({});
  let showCompletedTasks = $state<Record<string, boolean>>({});
  let sortField = $state<ProjectSortField>("due-date");
  let sortDirection = $state<SortDirection>("asc");

  $effect(() => {
    sortField = state.sortBy;
    sortDirection = state.sortDirection;
  });

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

  function handleSortChange(): void {
    viewStore.setSort(sortField, sortDirection);
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

        <label>
          Sort by
          <select bind:value={sortField} onchange={handleSortChange}>
            <option value="project">Project</option>
            <option value="custom-name">Custom Name</option>
            <option value="status">Status</option>
            <option value="priority">Priority</option>
            <option value="start-date">Start Date</option>
            <option value="finish-date">Finish Date</option>
            <option value="due-date">Due Date</option>
            <option value="tags">Tags</option>
            <option value="parent-project">Parent Project</option>
            <option value="requester">Requester</option>
            <option value="created-at">Created At</option>
            <option value="updated-at">Updated At</option>
          </select>
        </label>

        <label>
          Direction
          <select bind:value={sortDirection} onchange={handleSortChange}>
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
        </label>
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
      </div>
    {/if}
  </section>

  {#if state.gridTab === "projects"}
    <table class="opn-table" aria-label="Projects grid">
      <thead>
        <tr>
          <th></th>
          <th>Project</th>
          <th>Custom Name</th>
          <th>Status</th>
          <th>Priority</th>
          <th>Start</th>
          <th>Finish</th>
          <th>Due</th>
          <th>Tags</th>
          <th>Parent</th>
          <th>Requester</th>
          <th>Created</th>
          <th>Updated</th>
        </tr>
      </thead>
      <tbody>
        {#each state.projects as project (project.path)}
          <tr>
            <td>
              <button
                type="button"
                class="secondary"
                aria-label={`Toggle tasks for ${project.customName}`}
                onclick={() => toggleExpand(project.path)}
              >
                {expandedProjects[project.path] ? "▾" : "▸"}
              </button>
            </td>
            <td>
              <button
                type="button"
                class="link"
                aria-label={`Open project note ${project.customName}`}
                onclick={() => void viewStore.openProject(project.path)}
              >
                {project.title}
              </button>
            </td>
            <td>{project.customName}</td>
            <td>
              <select value={project.status} onchange={(event) => handleStatusChange(project, event)}>
                {#each statusOptions as status (status)}
                  <option value={status}>{status}</option>
                {/each}
              </select>
            </td>
            <td>
              <select value={project.priority} onchange={(event) => handlePriorityChange(project, event)}>
                {#each state.priorities as priority (priority)}
                  <option value={priority}>{priority}</option>
                {/each}
              </select>
            </td>
            <td>{project.startDate ?? ""}</td>
            <td>{project.finishDate ?? ""}</td>
            <td>{project.dueDate ?? ""}</td>
            <td>{project.tags.join(", ")}</td>
            <td>{project.parentProject ?? ""}</td>
            <td>{project.requester.join(", ")}</td>
            <td>{formatTimestamp(project.createdAt)}</td>
            <td>{formatTimestamp(project.updatedAt)}</td>
          </tr>

          {#if expandedProjects[project.path]}
            <tr class="opn-row-detail">
              <td colspan="13">
                <div class="opn-task-detail-header">
                  <strong>Tasks</strong>
                  <button
                    type="button"
                    class="secondary"
                    onclick={() => toggleCompleted(project.path)}
                    aria-label={`Toggle completed tasks for ${project.customName}`}
                  >
                    {showCompletedTasks[project.path] ? "Hide completed" : "Show completed"}
                  </button>
                </div>

                <ul class="opn-task-list">
                  {#each sortedTasksByProject.get(project.path) ?? [] as task (task.id)}
                    {#if shouldShowTask(project.path, task)}
                      <li>
                        <label>
                          <input
                            type="checkbox"
                            checked={task.checked}
                            onchange={(event) => void viewStore.toggleTask(task.id, (event.currentTarget as HTMLInputElement).checked)}
                          />
                          <span>{task.text}</span>
                        </label>
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
                checked={task.checked}
                onchange={(event) => void viewStore.toggleTask(task.id, (event.currentTarget as HTMLInputElement).checked)}
              />
            </td>
            <td>{getTaskDisplayText(task)}</td>
            <td>
              <button
                type="button"
                class="link"
                aria-label={`Open project note ${task.projectName}`}
                onclick={() => void viewStore.openProject(task.projectPath)}
              >
                {task.projectName}
              </button>
            </td>
            <td>{task.startDate ?? ""}</td>
            <td>{task.dueDate ?? ""}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>
