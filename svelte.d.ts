declare module "*.svelte" {
  import type { ComponentType } from "svelte";
  const value: ComponentType;
  export default value;
}
