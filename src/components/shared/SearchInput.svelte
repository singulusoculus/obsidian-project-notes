<script lang="ts">
  let { value = "", placeholder = "Search", ariaLabel = "Search", onChange } = $props<{
    value: string;
    placeholder?: string;
    ariaLabel?: string;
    onChange: (value: string) => void;
  }>();

  let inputElement = $state<HTMLInputElement | null>(null);

  function handleInput(event: Event): void {
    const nextValue = (event.currentTarget as HTMLInputElement).value;
    onChange(nextValue);
  }

  function handleClear(): void {
    if (value.length === 0) {
      return;
    }

    onChange("");
    inputElement?.focus();
  }
</script>

<div class="opn-search-input-wrap">
  <input
    bind:this={inputElement}
    class="opn-search-input"
    type="text"
    placeholder={placeholder}
    aria-label={ariaLabel}
    value={value}
    oninput={handleInput}
  />

  {#if value.length > 0}
    <button
      type="button"
      class="opn-search-clear"
      aria-label={`Clear ${ariaLabel.toLowerCase()}`}
      onclick={handleClear}
    >
      x
    </button>
  {/if}
</div>
