<script lang="ts">
  let { value = "", placeholder = "Search", ariaLabel = "Search", onChange } = $props<{
    value: string;
    placeholder?: string;
    ariaLabel?: string;
    onChange: (value: string) => void;
  }>();

  function handleInput(event: Event): void {
    const nextValue = (event.currentTarget as HTMLInputElement).value;
    onChange(nextValue);
  }
</script>

<input
  class="opn-search-input"
  type="text"
  placeholder={placeholder}
  value={value}
  oninput={handleInput}
/>
