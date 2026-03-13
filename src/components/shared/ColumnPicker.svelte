<script lang="ts">
  import type { Snippet } from "svelte";

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
    onReorder = () => undefined,
    allowReorder = true,
    extraContent,
  } = $props<{
    label?: string;
    items: PickerItem[];
    onToggle: (id: string, visible: boolean) => void;
    onReorder?: (orderedIds: string[]) => void;
    allowReorder?: boolean;
    extraContent?: Snippet;
  }>();

  let isOpen = $state(false);
  let draggingId = $state<string | null>(null);
  let dropIndicatorId = $state<string | null>(null);
  let dropIndicatorPosition = $state<"before" | "after" | null>(null);
  let orderedIds = $state<string[]>([]);
  let pickerWrap = $state<HTMLDivElement | null>(null);
  let dragImageElement = $state<HTMLElement | null>(null);

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

  function clearDropIndicator(): void {
    dropIndicatorId = null;
    dropIndicatorPosition = null;
  }

  function cleanupDragState(): void {
    draggingId = null;
    clearDropIndicator();
    dragImageElement?.remove();
    dragImageElement = null;
  }

  function createDragImage(source: HTMLElement): HTMLElement {
    const rect = source.getBoundingClientRect();
    const clone = source.cloneNode(true);
    const dragImage = clone instanceof HTMLElement ? clone : source;
    dragImage.classList.add("opn-column-drag-image");
    dragImage.style.position = "fixed";
    dragImage.style.left = "-10000px";
    dragImage.style.top = "-10000px";
    dragImage.style.width = `${rect.width}px`;
    dragImage.style.height = `${rect.height}px`;
    dragImage.style.pointerEvents = "none";
    dragImage.style.margin = "0";
    dragImage.style.boxSizing = "border-box";
    document.body.appendChild(dragImage);
    return dragImage;
  }

  function handleDragStart(event: DragEvent, id: string): void {
    if (!allowReorder) {
      return;
    }
    draggingId = id;
    if (event.dataTransfer) {
      event.dataTransfer.setData("text/plain", id);
      event.dataTransfer.effectAllowed = "move";
      const dragSource = event.currentTarget;
      if (dragSource instanceof HTMLElement) {
        const rect = dragSource.getBoundingClientRect();
        dragImageElement = createDragImage(dragSource);
        event.dataTransfer.setDragImage(
          dragImageElement,
          Math.max(0, event.clientX - rect.left),
          Math.max(0, event.clientY - rect.top),
        );
      }
    }
  }

  function handleDragOver(event: DragEvent, targetId: string): void {
    if (!allowReorder) {
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }

    if (draggingId === null || draggingId === targetId) {
      clearDropIndicator();
      return;
    }

    const dropTarget = event.currentTarget;
    if (!(dropTarget instanceof HTMLElement)) {
      clearDropIndicator();
      return;
    }

    const bounds = dropTarget.getBoundingClientRect();
    dropIndicatorId = targetId;
    dropIndicatorPosition = event.clientY >= bounds.top + bounds.height / 2 ? "after" : "before";
  }

  function handleDrop(event: DragEvent, targetId: string): void {
    if (!allowReorder) {
      return;
    }
    event.preventDefault();
    const sourceId = event.dataTransfer?.getData("text/plain") || draggingId;
    const insertAfter = dropIndicatorId === targetId && dropIndicatorPosition === "after";
    cleanupDragState();
    if (!sourceId) {
      return;
    }

    const currentIds = [...orderedIds];
    const sourceIndex = currentIds.indexOf(sourceId);
    const targetIndex = currentIds.indexOf(targetId);
    if (sourceIndex < 0 || targetIndex < 0) {
      return;
    }

    let insertIndex = insertAfter ? targetIndex + 1 : targetIndex;
    if (sourceIndex < insertIndex) {
      insertIndex -= 1;
    }
    if (sourceIndex === insertIndex) {
      return;
    }

    const nextIds = [...currentIds];
    const [moved] = nextIds.splice(sourceIndex, 1);
    nextIds.splice(insertIndex, 0, moved);
    orderedIds = nextIds;
    onReorder(nextIds);
  }

  function handleDragEnd(): void {
    if (!allowReorder) {
      return;
    }
    cleanupDragState();
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
    <div class="opn-column-picker" role="dialog">
      <ul class="opn-column-order-list">
        {#each orderedItems as item (item.id)}
          <li
            draggable={allowReorder && item.draggable !== false}
            class:dragging={draggingId === item.id}
            class:is-drop-before={dropIndicatorId === item.id && dropIndicatorPosition === "before"}
            class:is-drop-after={dropIndicatorId === item.id && dropIndicatorPosition === "after"}
            ondragstart={(event) => handleDragStart(event, item.id)}
            ondragover={(event) => handleDragOver(event, item.id)}
            ondrop={(event) => handleDrop(event, item.id)}
            ondragend={handleDragEnd}
          >
            <span class="opn-column-drag-handle" aria-hidden="true">
              {allowReorder && item.draggable !== false ? "⋮⋮" : "•"}
            </span>
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
      {@render extraContent?.()}
    </div>
  {/if}
</div>
