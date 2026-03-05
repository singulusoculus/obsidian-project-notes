# Development Log

This document chronicles the implementation journey, key decisions, lessons learned, and debugging insights from building Obsidian Project Notes.
- This document is for brief descriptions of daily work done and lessons learned. In date descending order (newest date on top)
- If todays date does not exist, create it.

## Pinned

### Work done 2026.03.05
- Scaffolded the plugin from scratch in TypeScript with Svelte 5 (Runes), including build pipeline, manifest, styles, and version files.
- Implemented cache-first core services:
  - Area resolution with per-area include mode (`top-level` or `recursive`)
  - Note normalization for standard frontmatter and sections (`## Tasks`, `## Notes`, `## Links`) with `Tasks` as first heading section after preamble
  - Strict task parser/toggler for emoji date markers (`🛫`, `📅`, `✅`) in the `## Tasks` section
  - Incremental index updates for vault create/modify/rename/delete and metadata changes, plus background reconciliation and snapshot persistence
- Implemented shared store and action layer used by all views.
- Implemented full custom and bases-labeled Grid/Kanban views (separate registered Obsidian views/commands) on the same shared data core.
- Added project creation flow with Area picker + filename modal and automatic normalization.
- Added plugin settings UI for areas, inclusion mode, open target, statuses/priorities, sort defaults, Kanban hidden statuses, and reconcile interval.
- Updated architecture from `app/src` to `src` per requested directory convention.
- Fixed build blockers:
  - corrected `TFile` imports to value imports where runtime `instanceof TFile` checks are used
  - handled nullable sidebar leaves in note open service
  - switched `esbuild-svelte` import to default import for Node ESM interop
  - confirmed `npm run build` now completes (with Svelte deprecation/accessibility warnings only)
- Migrated Svelte event handlers from legacy directive syntax (`on:*`) to Svelte 5 attribute syntax (`onclick`, `oninput`, `onchange`, etc.) and cleared all related build warnings.
- Diagnosed plugin discovery issue in Obsidian Community Plugins list: `manifest.json` had an empty required `author` field. Set `author` to a non-empty value so Obsidian can recognize the plugin manifest.
- Fixed Area Name input focus loss in settings by removing full settings tab rerender on each keystroke (`this.display()`), and updating only the local area title element text while typing.
- Fixed runtime error during project creation (`Cannot read properties of undefined (reading 'type')`) by making `ProjectNotesView` resolve view definition safely during early lifecycle calls (before constructor-assigned fields are guaranteed), with fallback from leaf state/default definition.
- Fixed create-project area picker flow where selecting an Area could no-op due modal resolve/close timing race. Added single-resolution guard and deferred cancel-path resolution in `AreaSuggestModal`, and explicitly close after selection.
- Enforced standard project property typing and shapes:
  - plugin now merges required property types into `.obsidian/types.json` on load (`status/priority/requester` as list, date/date-time fields, tags system type, etc.)
  - normalizer now writes list-shaped values for `status`/`priority`
  - normalizer initializes missing `created-at` and `updated-at` as ISO datetimes
  - metadata update path now preserves list shape when changing `status`/`priority`
- Added `Add Project` button to the shared board header so it appears in both Grid and Kanban views.
  - wired a shared `createProject` action through `ProjectViewStore` to call plugin note creation flow
  - exposed plugin `createProjectNote()` for view invocation and kept command behavior unchanged
  - adjusted board header layout styles for action alignment
- Removed automatic Area tag injection during note normalization.
  - project notes now keep existing `tags` unchanged unless user edits them
  - plugin no longer adds `area/<slug>` tags automatically on create/move/normalize
- Updated Tasks grid Task column display to strip inline task date markers (`🛫/📅/✅ YYYY-MM-DD`).
  - keeps Start and Due columns as the single place for those dates in the grid
  - does not change underlying task text in the note, display-only cleanup
- Added Tasks-tab `Add Task` workflow.
  - Tasks grid now has an `Add Task` button that opens a modal
  - modal prompts for project, task text, start date (default today), and optional due date
  - new task is appended under the selected note's `## Tasks` section with strict emoji date markers
  - write path is wired through shared view store -> plugin action -> index service/task parser and refreshes cache/views
- Added automatic completed-date reconciliation when editing tasks directly in project notes.
  - checking a task in `## Tasks` now ensures `✅ YYYY-MM-DD` is appended
  - unchecking removes `✅ YYYY-MM-DD`
  - integrated into file-change handling with in-flight guards to avoid modify-event loops
  - project parsing now reads from disk for immediate consistency after auto-amend writes

### Work done 2026.03.04
