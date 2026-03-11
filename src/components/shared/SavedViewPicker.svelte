<script lang="ts">
  import type { SavedViewListItem } from "../../lib/types";

  let {
    currentLabel = "Default",
    items,
    onSelect,
    onDelete,
  } = $props<{
    currentLabel?: string;
    items: SavedViewListItem[];
    onSelect: (id: string) => void;
    onDelete: (id: string) => void;
  }>();

  let isOpen = $state(false);
  let pendingDeleteId = $state<string | null>(null);
  let pickerWrap = $state<HTMLDivElement | null>(null);

  $effect(() => {
    if (!isOpen) {
      pendingDeleteId = null;
      return;
    }

    const handlePointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && pickerWrap?.contains(event.target)) {
        return;
      }

      isOpen = false;
      pendingDeleteId = null;
    };

    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        isOpen = false;
        pendingDeleteId = null;
      }
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleEscape);
    };
  });

  function toggleOpen(): void {
    isOpen = !isOpen;
    if (!isOpen) {
      pendingDeleteId = null;
    }
  }

  function handleSelect(id: string): void {
    onSelect(id);
    isOpen = false;
    pendingDeleteId = null;
  }

  function handleDeleteClick(id: string): void {
    if (pendingDeleteId === id) {
      onDelete(id);
      pendingDeleteId = null;
      return;
    }

    pendingDeleteId = id;
  }
</script>

<div class="opn-saved-view-picker-wrap" bind:this={pickerWrap}>
  <button
    type="button"
    class="secondary opn-saved-view-trigger"
    aria-haspopup="dialog"
    aria-expanded={isOpen}
    onclick={toggleOpen}
  >
    {currentLabel}
  </button>

  {#if isOpen}
    <div class="opn-saved-view-picker" role="dialog">
      <ul class="opn-saved-view-list">
        {#each items as item (item.id)}
          <li class="opn-saved-view-item">
            <button
              type="button"
              class="opn-saved-view-option"
              onclick={() => handleSelect(item.id)}
            >
              {item.label}
            </button>
            {#if item.deletable}
              <button
                type="button"
                class={`opn-saved-view-delete ${pendingDeleteId === item.id ? "is-confirm" : ""}`}
                onclick={() => handleDeleteClick(item.id)}
              >
                {pendingDeleteId === item.id ? "Confirm" : "X"}
              </button>
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</div>
