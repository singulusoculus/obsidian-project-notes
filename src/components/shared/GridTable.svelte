<script lang="ts">
  import type { Snippet } from "svelte";

  export interface GridTableColumn {
    id: string;
    label: string;
    sortable?: boolean;
    sortKey?: string;
  }

  let {
    ariaLabel,
    columns,
    sortBy = "",
    sortDirection = "asc",
    onSort,
    showLeadingColumn = false,
    leadingColumnLabel = "",
    children,
  } = $props<{
    ariaLabel: string;
    columns: GridTableColumn[];
    sortBy?: string;
    sortDirection?: "asc" | "desc";
    onSort?: (sortKey: string) => void;
    showLeadingColumn?: boolean;
    leadingColumnLabel?: string;
    children?: Snippet;
  }>();

  function markerFor(column: GridTableColumn): string {
    if (!column.sortable || !column.sortKey || sortBy !== column.sortKey) {
      return "";
    }

    return sortDirection === "asc" ? "↑" : "↓";
  }

  function ariaSortFor(column: GridTableColumn): "ascending" | "descending" | "none" | undefined {
    if (!column.sortable || !column.sortKey) {
      return undefined;
    }

    if (sortBy !== column.sortKey) {
      return "none";
    }

    return sortDirection === "asc" ? "ascending" : "descending";
  }

  function triggerSort(column: GridTableColumn): void {
    if (!column.sortable || !column.sortKey || !onSort) {
      return;
    }

    onSort(column.sortKey);
  }

  function handleHeaderKeydown(event: KeyboardEvent, column: GridTableColumn): void {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      triggerSort(column);
    }
  }
</script>

<table class="opn-table" aria-label={ariaLabel}>
  <thead>
    <tr>
      {#if showLeadingColumn}
        <th>{leadingColumnLabel}</th>
      {/if}
      {#each columns as column (column.id)}
        <th aria-sort={ariaSortFor(column)}>
          {#if column.sortable && column.sortKey}
            <span
              class="opn-sort-header"
              role="button"
              tabindex="0"
              onclick={() => triggerSort(column)}
              onkeydown={(event) => handleHeaderKeydown(event, column)}
            >
              <span>{column.label}</span>
              <span class="opn-sort-marker">{markerFor(column)}</span>
            </span>
          {:else}
            <span>{column.label}</span>
          {/if}
        </th>
      {/each}
    </tr>
  </thead>
  <tbody>
    {@render children?.()}
  </tbody>
</table>
