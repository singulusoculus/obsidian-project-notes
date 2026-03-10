
# Project AGENT Instructions
- This is an Obsidian plugin project
- To get started: https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin
- Refer to https://docs.obsidian.md/Home for all plugin development documentation
    - You will want to access the Plugins and Reference sections
- Use Obsidian bases for the views we create - https://docs.obsidian.md/plugins/guides/bases-view
- Reference Svelte documentation here: https://svelte.dev/docs/svelte/overview
- How to use Svelte in Obsidian: https://docs.obsidian.md/Plugins/Getting+started/Use+Svelte+in+your+plugin

- Log a summary of work completed in DEVELOPMENT-LOG.md under the current days section. If that section does not exist, create it
- Before updating DEVELOPMENT-LOG.md on any turn, check git state:
  - current HEAD commit sha and subject
  - version tags on HEAD that match `v*`
  - whether there is uncommitted work in the working tree
- Organize DEVELOPMENT-LOG.md in reverse chronological order with this hierarchy:
  - `## Untagged Version` for the current untagged history above tagged versions
  - `## vX.Y.Z` only when a version tag is detected on HEAD and that version header does not already exist
  - `### Uncommitted Work` at the top of `## Untagged Version` whenever the working tree has uncommitted work
  - `### <short-sha> <commit subject>` only when a new HEAD commit is detected and that commit header does not already exist
  - `#### YYYY.MM.DD` for day buckets under either `### Uncommitted Work` or a commit header
- Keep `## Untagged Version` at the top of the log until HEAD receives a version tag.
- Keep `### Uncommitted Work` at the top of `## Untagged Version` until a new commit is made.
- If a new version tag is applied to HEAD, move that current top commit history under the new `## vX.Y.Z` header and remove or move `## Untagged Version` as needed.
- If a new commit is created, place it under `## Untagged Version` and reset `### Uncommitted Work` above it as needed.
- Keep newest items first.
- Do not duplicate existing version, commit, or day headers.
- Append new bullets under the correct current day header.
- Do not log changes made solely to `DEVELOPMENT-LOG.md` itself. If a turn only updates `DEVELOPMENT-LOG.md`, do not add a work bullet for that turn.
- Assume release tags are applied to HEAD. If a version tag is added to an older commit later, stop and ask how the log should be reorganized.


## TypeScript
- All new code must be written in TypeScript.
- Do not use `any` unless unavoidable.
- Define reusable types in `$lib/types.ts`.

## Svelte Version
- This project uses **Svelte 5** with the Runes API.
- Prefer runes (`$state`, `$derived`, `$effect`) over legacy `$:` reactivity.
- Use $props() and $bindable() for props; avoid export let unless asked.
- Do NOT generate Svelte 3/4 syntax unless explicitly requested.

## State Management
- Use `$state` for component-local reactive state.
- Use `$derived` for computed reactive values.
- Use Svelte `writable()` stores for shared data reactivity. Stores live in /src/lib/stores.

## Component Guidelines
- Keep components small and single-purpose.
- Use composition rather than large monolithic components.
- Avoid deeply nested reactive logic inside markup.
- Prefer clean `<script>` logic with readable helpers.

## Accessibility
- Always include proper `aria-*` attributes for interactive elements.
- Buttons must have accessible labels.
- Form inputs must include `<label>` bindings.

## Performance Rules
- Avoid unnecessary `$effect` usage.
- Do not recompute derived values inside the template.
- Prefer `keyed each` blocks where list identity matters.
