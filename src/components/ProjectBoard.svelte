<script lang="ts">
  import { fromStore } from "svelte/store";
  import ProjectGrid from "./ProjectGrid.svelte";
  import ProjectKanban from "./ProjectKanban.svelte";
  import type { BoardType, ViewVariant } from "../lib/types";
  import type { ProjectViewStore } from "../lib/stores/projectViewStore";

  let { viewStore, variant, boardType } = $props<{
    viewStore: ProjectViewStore;
    variant: ViewVariant;
    boardType: BoardType;
  }>();

  const state = $derived.by(() => fromStore(viewStore.state).current);

  function handleAreaChange(event: Event): void {
    const value = (event.currentTarget as HTMLSelectElement).value;
    viewStore.setArea(value);
  }

  function setGridTab(tab: "projects" | "tasks" | "kanban"): void {
    viewStore.setGridTab(tab);
  }

  function handleGridTabKeydown(event: KeyboardEvent, tab: "projects" | "tasks" | "kanban"): void {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setGridTab(tab);
    }
  }

  function openSettings(): void {
    viewStore.openPluginSettings();
  }
</script>

<div class={`opn-board opn-${variant}`}>
  <header class="opn-board-header">
    <div class="opn-board-header-left">
      <select
        aria-label="Select area"
        value={state.currentAreaId ?? ""}
        onchange={handleAreaChange}
      >
        {#each state.areas as area (area.id)}
          <option value={area.id}>{area.name}</option>
        {/each}
      </select>
    </div>

    <div class="opn-board-header-center">
      <div class="opn-grid-tabs" role="tablist" aria-label="Project notes views">
        <span
          class="opn-grid-tab"
          role="tab"
          tabindex={state.gridTab === "projects" ? 0 : -1}
          aria-selected={state.gridTab === "projects"}
          class:active={state.gridTab === "projects"}
          onclick={() => setGridTab("projects")}
          onkeydown={(event) => handleGridTabKeydown(event, "projects")}
        >
          Projects
        </span>
        <span
          class="opn-grid-tab"
          role="tab"
          tabindex={state.gridTab === "tasks" ? 0 : -1}
          aria-selected={state.gridTab === "tasks"}
          class:active={state.gridTab === "tasks"}
          onclick={() => setGridTab("tasks")}
          onkeydown={(event) => handleGridTabKeydown(event, "tasks")}
        >
          Tasks
        </span>
        <span
          class="opn-grid-tab"
          role="tab"
          tabindex={state.gridTab === "kanban" ? 0 : -1}
          aria-selected={state.gridTab === "kanban"}
          class:active={state.gridTab === "kanban"}
          onclick={() => setGridTab("kanban")}
          onkeydown={(event) => handleGridTabKeydown(event, "kanban")}
        >
          Kanban
        </span>
      </div>
    </div>

    <div class="opn-board-header-right">
      <button
        type="button"
        class="secondary opn-settings-shortcut"
        aria-label="Open Project Notes settings"
        title="Project Notes settings"
        onclick={openSettings}
      >
        ⚙
      </button>
    </div>
  </header>

  {#if state.areas.length === 0}
    <section class="opn-empty" aria-label="No areas configured">
      <h3>No Areas configured</h3>
      <p>Add an Area in plugin settings to start indexing projects.</p>
    </section>
  {:else if state.gridTab === "kanban"}
    <ProjectKanban {viewStore} {variant} />
  {:else}
    <ProjectGrid {viewStore} {variant} />
  {/if}
</div>
