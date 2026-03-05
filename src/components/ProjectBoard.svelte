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
</script>

<div class={`opn-board opn-${variant}`}>
  <header class="opn-board-header">
    <div class="opn-board-title">
      <h2>{boardType === "grid" ? "Project Grid" : "Project Kanban"}</h2>
      <small>{state.projects.length} projects</small>
    </div>

    <div class="opn-board-actions">
      <button
        type="button"
        class="mod-cta"
        aria-label="Add project"
        onclick={() => void viewStore.createProjectNote()}
      >
        Add Project
      </button>

      <label>
        Area
        <select
          aria-label="Select area"
          value={state.currentAreaId ?? ""}
          onchange={handleAreaChange}
        >
          {#each state.areas as area (area.id)}
            <option value={area.id}>{area.name}</option>
          {/each}
        </select>
      </label>
    </div>
  </header>

  {#if state.areas.length === 0}
    <section class="opn-empty" aria-label="No areas configured">
      <h3>No Areas configured</h3>
      <p>Add an Area in plugin settings to start indexing projects.</p>
    </section>
  {:else if boardType === "grid"}
    <ProjectGrid {viewStore} {variant} />
  {:else}
    <ProjectKanban {viewStore} {variant} />
  {/if}
</div>
