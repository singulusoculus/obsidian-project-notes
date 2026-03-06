<script lang="ts">
  interface PickerItem {
    id: string;
    label: string;
    visible: boolean;
    hideable?: boolean;
    draggable?: boolean;
  }

  let {
    label = "Columns",
    items,
    onToggle,
    onReorder,
  } = $props<{
    label?: string;
    items: PickerItem[];
    onToggle: (id: string, visible: boolean) => void;
    onReorder: (orderedIds: string[]) => void;
  }>();

  let isOpen = $state(false);
  let draggingId = $state<string | null>(null);
  let orderedIds = $state<string[]>([]);
  let pickerWrap = $state<HTMLDivElement | null>(null);

  const itemById = $derived.by(() => new Map(items.map((item) => [item.id, item])));
  const orderedItems = $derived.by(() => {
    const baseOrder = orderedIds.length > 0 ? orderedIds : items.map((item) => item.id);
    return baseOrder
      .map((id) => itemById.get(id))
      .filter((item): item is PickerItem => item !== undefined);
  });

  $effect(() => {
    const availableIds = items.map((item) => item.id);
    if (orderedIds.length === 0) {
      orderedIds = [...availableIds];
      return;
    }

    const preserved = orderedIds.filter((id) => availableIds.includes(id));
    const missing = availableIds.filter((id) => !preserved.includes(id));
    const nextOrder = [...preserved, ...missing];
    if (
      nextOrder.length !== orderedIds.length ||
      nextOrder.some((id, index) => orderedIds[index] !== id)
    ) {
      orderedIds = nextOrder;
    }
  });

  $effect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (target instanceof Node && pickerWrap?.contains(target)) {
        return;
      }

      isOpen = false;
    };

    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        isOpen = false;
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
  }

  function handleVisibilityChange(id: string, event: Event): void {
    const visible = (event.currentTarget as HTMLInputElement).checked;
    onToggle(id, visible);
  }

  function handleDragStart(event: DragEvent, id: string): void {
    draggingId = id;
    if (event.dataTransfer) {
      event.dataTransfer.setData("text/plain", id);
      event.dataTransfer.effectAllowed = "move";
    }
  }

  function handleDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
  }

  function handleDrop(event: DragEvent, targetId: string): void {
    event.preventDefault();
    const sourceId = event.dataTransfer?.getData("text/plain") || draggingId;
    draggingId = null;
    if (!sourceId || sourceId === targetId) {
      return;
    }

    const currentIds = [...orderedIds];
    const sourceIndex = currentIds.indexOf(sourceId);
    const targetIndex = currentIds.indexOf(targetId);
    if (sourceIndex < 0 || targetIndex < 0) {
      return;
    }

    const nextIds = [...currentIds];
    const [moved] = nextIds.splice(sourceIndex, 1);
    nextIds.splice(targetIndex, 0, moved);
    orderedIds = nextIds;
    onReorder(nextIds);
  }

  function handleDragEnd(): void {
    draggingId = null;
  }
</script>

<div class="opn-column-picker-wrap" bind:this={pickerWrap}>
  <button
    type="button"
    class="secondary"
    aria-haspopup="dialog"
    aria-expanded={isOpen}
    onclick={toggleOpen}
  >
    {label}
  </button>

  {#if isOpen}
    <div class="opn-column-picker" role="dialog" aria-label={`${label} settings`}>
      <ul class="opn-column-order-list">
        {#each orderedItems as item (item.id)}
          <li
            draggable={item.draggable !== false}
            class:dragging={draggingId === item.id}
            ondragstart={(event) => handleDragStart(event, item.id)}
            ondragover={handleDragOver}
            ondrop={(event) => handleDrop(event, item.id)}
            ondragend={handleDragEnd}
          >
            <span class="opn-column-drag-handle" aria-hidden="true">{item.draggable === false ? "•" : "⋮⋮"}</span>
            <span class="opn-column-name">{item.label}</span>
            {#if item.hideable !== false}
              <input
                type="checkbox"
                checked={item.visible}
                class="opn-column-visibility-toggle"
                onchange={(event) => handleVisibilityChange(item.id, event)}
              />
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</div>
