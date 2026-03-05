<script lang="ts">
  import { fromStore } from "svelte/store";
  import type { ProjectNote, ViewVariant } from "../lib/types";
  import type { ProjectViewStore } from "../lib/stores/projectViewStore";

  let { viewStore, variant } = $props<{ viewStore: ProjectViewStore; variant: ViewVariant }>();

  const state = $derived.by(() => fromStore(viewStore.state).current);

  let draggingPath = $state<string | null>(null);

  const statusOptions = $derived.by(() => {
    const values = new Set(state.statuses);
    if (state.projects.some((project) => project.statusIsUnknown)) {
      values.add("Unknown");
    }
    return Array.from(values);
  });

  const projectsByStatus = $derived.by(() => {
    const map = new Map<string, ProjectNote[]>();

    for (const status of statusOptions) {
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
      return statusOptions;
    }

    const hidden = new Set(state.hiddenKanbanStatuses);
    return statusOptions.filter((status) => !hidden.has(status));
  });

  const hiddenStatuses = $derived.by(() => {
    const hidden = new Set(state.hiddenKanbanStatuses);
    return statusOptions.filter((status) => hidden.has(status));
  });

  function allowDrop(event: DragEvent): void {
    event.preventDefault();
  }

  function handleDragStart(event: DragEvent, path: string): void {
    draggingPath = path;
    event.dataTransfer?.setData("text/project-path", path);
    event.dataTransfer?.setData("text/plain", path);
    event.dataTransfer?.setData("application/x-project-path", path);
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

  function handlePriorityChange(project: ProjectNote, event: Event): void {
    const value = (event.currentTarget as HTMLSelectElement).value;
    void viewStore.updateProject({
      path: project.path,
      key: "priority",
      value,
    });
  }
</script>

<div class={`opn-kanban opn-${variant}`}>
  <section class="opn-grid-controls" aria-label="Kanban controls">
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

      <button
        type="button"
        class="secondary"
        aria-label="Toggle hidden statuses in kanban"
        onclick={() => viewStore.toggleShowHiddenKanban()}
      >
        {state.showHiddenKanban ? "Hide Done/Cancelled columns" : "Show Done/Cancelled columns"}
      </button>
    </div>

    <div class="opn-filter-groups">
      <div class="opn-filter-group" aria-label="Status filters">
        <span>Status</span>
        <button type="button" class="secondary" onclick={() => viewStore.clearStatusFilter()}>Clear</button>
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

      {#if state.availableAreaTags.length > 0}
        <div class="opn-filter-group" aria-label="Area tag filters">
          <span>Area Tags</span>
          <button type="button" class="secondary" onclick={() => viewStore.clearAreaTagFilter()}>Clear</button>
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
  </section>

  <div class="opn-kanban-scroll">
    <div class="opn-kanban-columns" role="region" aria-label="Project kanban columns">
      {#each visibleStatuses as status (status)}
        <section
          class="opn-kanban-column"
          ondragover={allowDrop}
          ondrop={(event) => handleDrop(event, status)}
          aria-label={`Kanban status ${status}`}
        >
          <header>
            <h3>{status}</h3>
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
                <button
                  type="button"
                  class="link"
                  aria-label={`Open project note ${project.customName}`}
                  onclick={() => void viewStore.openProject(project.path)}
                >
                  {project.customName}
                </button>

                <div class="opn-card-meta">
                  <span>Due: {project.dueDate ?? ""}</span>
                  <span>Tasks: {project.tasks.filter((task) => !task.checked).length}</span>
                </div>

                <label>
                  Priority
                  <select value={project.priority} onchange={(event) => handlePriorityChange(project, event)}>
                    {#each state.priorities as priority (priority)}
                      <option value={priority}>{priority}</option>
                    {/each}
                  </select>
                </label>
              </article>
            {/each}
          </div>
        </section>
      {/each}
    </div>

    {#if !state.showHiddenKanban && hiddenStatuses.length > 0}
      <aside class="opn-kanban-dropzones" aria-label="Hidden status drop zones">
        {#each hiddenStatuses as status (status)}
          <div
            class="opn-kanban-dropzone"
            role="region"
            aria-label={`Drop projects into ${status}`}
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
