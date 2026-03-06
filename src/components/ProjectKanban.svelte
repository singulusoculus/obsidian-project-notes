<script lang="ts">
  import { fromStore } from "svelte/store";
  import type { ProjectNote, ViewVariant } from "../lib/types";
  import type { ProjectViewStore } from "../lib/stores/projectViewStore";
  import ColumnPicker from "./shared/ColumnPicker.svelte";
  import SearchInput from "./shared/SearchInput.svelte";

  let { viewStore, variant } = $props<{ viewStore: ProjectViewStore; variant: ViewVariant }>();

  const state = $derived.by(() => fromStore(viewStore.state).current);

  let draggingPath = $state<string | null>(null);
  let statusColumnOrder = $state<string[]>([]);

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

  function handleProjectLinkClick(event: MouseEvent, path: string): void {
    event.preventDefault();
    void viewStore.openProject(path);
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
</script>

<div class={`opn-kanban opn-${variant}`}>
  <section class="opn-grid-controls" aria-label="Kanban controls">
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

      </div>

      <div class="opn-grid-filter-right">
        <button type="button" class="mod-cta" onclick={() => void viewStore.createProjectNote()}>
          Add Project
        </button>
      </div>
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
            <div class="opn-kanban-column-title">
              <h3>{status}</h3>
              <button
                type="button"
                class="secondary opn-kanban-add"
                aria-label={`Add project in ${status}`}
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
                <a
                  href={encodeURI(project.path)}
                  class="opn-link"
                  aria-label={`Open project note ${project.displayName}`}
                  onclick={(event) => handleProjectLinkClick(event, project.path)}
                >
                  {project.displayName}
                </a>

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
