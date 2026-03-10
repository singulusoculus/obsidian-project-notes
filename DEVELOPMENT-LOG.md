# Development Log

- This document is for brief descriptions of work done and lessons learned.
- Structure:
  - `##` = version tag or `Untagged Version`
  - `###` = commit or `Uncommitted Work`
  - `####` = day
- Use `## Untagged Version` for the current untagged history above tagged versions.
- Use `### Uncommitted Work` for current uncommitted work under `## Untagged Version`.
- Do not log changes made solely to `DEVELOPMENT-LOG.md` itself.
- Keep newest items first.

## Untagged Version
### Uncommitted Work
#### 2026.03.10
- Simplified ongoing support by adding `Ongoing` as a default project status (including the default project-status filter) and adding project Timing multiselect filters to both the Projects and Kanban views.


### 20fa1f5 Stop tracking data.json
#### 2026.03.10
- Stopped tracking `data.json` in git so local plugin state changes no longer show up as tracked file modifications.

### e6f9e4c tie start and finish dates to task checkbox status and project status
#### 2026.03.10
- Updated task Finish-date editing in the Tasks grid so setting a finish date now also marks the task checkbox complete, while checkbox completion from notes or views continues to add the finish date automatically.
- Added project status/date synchronization so setting a project `finish-date` marks it `Done`, setting `start-date` marks it `Doing`, and changing status to `Done` or `Doing` backfills today’s missing finish/start date respectively.

### aa2f359 Scheduled date, date fields editable, editable field styling
#### 2026.03.10
- Refined grid date input styling so empty date fields hide the native `mm/dd/yyyy` hint text and calendar picker icon until hover or focus, keeping blank cells visually clean while preserving inline editing.

#### 2026.03.09
- Added first-class `Scheduled` date support for projects and tasks.
- Added locked `scheduled-date` project property support across settings, type syncing, project sorting, grid columns, and Kanban card field options.
- Updated task parsing and creation so tasks read/write `⏳ YYYY-MM-DD` for Scheduled, keep `🛫` as actual Start, and capture Scheduled separately in the Add Task flow.
- Updated project/task timing logic to use `Scheduled` as the planned start date with fallback to `Start` for older notes, then verified the changes with `npm run build`.
- Made project date fields editable inline in the Projects grid with native date pickers that write back to note frontmatter.
- Made task date fields editable inline in the Tasks grid with native date pickers that rewrite task emoji date markers in the note body.
- Added editable task `Finish` dates in the Tasks grid without forcing checkbox changes, except clearing `Finish` now resets the task checkbox state to empty.
- Changed grid editors so status, priority, and date fields render as plain display values by default and only reveal their editable controls on hover or focus, while empty date cells stay visually blank until interaction.
- Simplified grid editor rendering to use a single control per editable cell, styled as plain text by default and only showing input chrome on hover/focus so hidden editors no longer consume duplicate visual space.

### b8b7305 Fixed Kanban drag ghost sizing; update AGENT instructions for dev log
#### 2026.03.08
- Fixed Kanban drag ghost sizing for cards with collapsed Notes previews.
  - drag preview now uses a clipped custom drag image sized to the card’s visible bounding box
  - prevents drag ghost from expanding to hidden/collapsed Notes content height
- Updated hidden Kanban status drop zones to include item counts in the label (for example `Done (23)`).
- Verified the changes compile successfully with `npm run build`.
- Updated Kanban card Next Task label to be count-aware.
  - now shows `Next Task` when one task is displayed
  - now shows `Next X Tasks` when multiple are displayed
  - appends `(out of Y)` when only a subset is shown due to the configured next-task limit

## v0.0.4
### 85aad9c Kanban stuff; update to v0.0.4
#### 2026.03.08
- Updated Kanban lane layout sizing so lane height grows to fit all cards instead of clamping to viewport-like constraints.
- Made Kanban columns stretch to the tallest visible lane so all columns share a consistent height.
- Added overflow safeguards in lane/card/link styling so project cards do not spill outside their lane bounds.
- Fixed Kanban drag UX when dragging from project links by disabling native link dragging and forcing the card element as the drag image source.
- Improved Kanban drag anchor behavior so card drag preview starts from the exact click point within the card instead of snapping to a fixed corner offset.
- Added configurable Kanban `Card` content controls with Area overrides:
  - new `Card` picker in Kanban controls (next to `Columns`) for toggling visible card fields without reordering
  - `Name` is always visible, and users can toggle `Priority`, dates, `Requester`, task count, `Next Task(s)`, `Notes`, and dynamic custom properties
  - `Next Task(s)` count is configurable per Area from the Card picker (with global default + Area override persistence)
- Added Notes rendering on Kanban cards from each project note’s `## Notes` section:
  - Notes now support truncated preview with configurable word limit, fade-out, and `Read More` / `Read Less` expansion using Svelte transitions
  - Added a global setting for Notes preview word limit and global default card field selection
- Added settings support for global Kanban card defaults plus Area-level override controls.
- Refined Kanban card rendering behavior:
  - `Next Task(s)` now renders actionable task checkboxes on cards; checking one marks it complete from Kanban and immediately advances the list to the next incomplete task
  - card rows now render label/value inline (except `Next Task(s)`, which remains stacked for task list readability)
  - empty card fields are now hidden (instead of rendering placeholders) when the underlying note value is missing/blank
- Updated Kanban card task checkbox behavior to respect the tri-state setting:
  - with tri-state enabled, Kanban task toggles now cycle `unchecked -> in-progress -> checked -> unchecked`
  - with tri-state disabled, Kanban task toggles use binary `unchecked <-> checked`
  - Kanban task checkbox visuals now reflect `in-progress` mixed state consistently with the Tasks/Projects grids
- Added project-level Timing Status support (date-driven badges based on project `start-date`, `due-date`, and terminal completion state).
  - added `Timing` as a sortable Projects-grid column with badge rendering in both Project-Task and Parent-Child modes
  - added `timing-status` to project sort options and shared query/index sort handling
- Refined Kanban card footer metadata layout:
  - moved `Priority` to a non-editable bottom-right text slot (label removed)
  - added project Timing Status badges to the bottom-left of the same footer row
  - added missing `Future` and `Needs Timing` timing-badge styles for consistent badge coverage
- Updated Kanban card Notes rendering to respect markdown syntax and layout:
  - Notes content now uses Obsidian `MarkdownRenderer` so formatting (lists, emphasis, links, etc.) renders correctly
  - Notes field is now stacked with content below the `Notes` label on cards
  - preserved `Read More` / `Read Less` transitions for long notes
- Removed `aria-label` attributes from plugin UI elements and modal inputs to prevent Obsidian tooltip popups during normal interaction.
  - stripped `aria-label` usage from board/grid/kanban/shared components and modal field setup
  - restored affected wrapper markup where labels had shared lines with structural tags (controls sections, picker/dialog wrappers, tables)
- Enhanced Kanban Notes `Read More` trigger logic to support dual thresholds.
  - added a new global setting `Kanban notes preview lines` (default `5`)
  - Notes now show `Read More` when content exceeds either the configured word limit or the line-limit/preview overflow
  - preview max-height now scales with the configured line threshold

#### 2026.03.06
- Reworked Projects-grid expanded task filtering:
  - removed per-project `Show completed` control
  - added global `Task Status` multiselect (`To Do`, `Doing`, `Done`) with tri-state-aware options (`To Do`, `Done` when tri-state is off)
  - applied the same task-status filter behavior to expanded project tasks and Tasks grid rows
- Updated Tasks view controls:
  - replaced completed toggle with `Task Status` dropdown
  - added computed `Timing Status` system with badge rendering and filter dropdown
  - timing statuses now include `Current`, `Due`, `Overdue`, `Tomorrow`, `Future`, and `Needs Timing`
  - set default timing filter selection to include all except `Future` (while keeping `Needs Timing` selected)
- Added `All`/`None` quick actions to all multiselect dropdown menus in grid controls and updated labels/count logic to show `None`, `All`, or selected count.
- Added explicit “none selected” handling for project `Status` and `Priority` filters using an internal sentinel so `None` actually deselects all.
- Reordered controls and placeholders:
  - search now appears first on the left in Projects, Tasks, and Kanban
  - updated placeholders to `Search Projects` (Projects/Kanban) and `Search Tasks` (Tasks)
  - moved `Columns` dropdown next to search in all views; right-side action area now keeps only the Add button
- Upgraded Add Task project picker UX:
  - replaced plain select with searchable project picker popover that opens on input focus/click
  - supports live filtering, keyboard navigation, outside-click close, and explicit selection sync
  - increased popover/list height for easier scanning
  - restricted selectable projects to active statuses only (excludes Done/Cancelled)
- Updated new-project flow to skip Area prompt when exactly one Area is configured.
- Extended text/list property rendering to support external links in addition to wikilinks:
  - markdown-style links (for example `[label](https://...)`)
  - plain URL and `mailto:` links
  - applied across Parent, Requester, and custom property cells (including child/task requester rows)
- Updated Projects grid expand behavior to hide task expand toggles when a project has only completed tasks.
- Verified all changes with `npm run build` after each implementation batch.

#### 2026.03.05
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
  - hardened task matching to support more checkbox line formats and tolerant `## Tasks` heading variants
  - added editor-change reconciliation path so direct note checkbox toggles are amended in the live editor buffer
- Updated Projects grid to hide row expand/collapse control for projects with no tasks.
  - task detail row now only renders when a project has at least one task
- Added show/hide completed toggle to the Tasks tab view.
  - tasks query now supports incomplete-only or include-completed modes from view state
  - default remains incomplete-only; users can toggle visibility inline
- Fixed task-name typing issue in note editor when entering spaces.
  - editor reconciliation now leaves unchecked task text untouched unless a completed-date marker exists
  - prevents cursor jumps/newline side effects when typing task names in project notes
- Added Project requester display to the Tasks grid.
  - task model now carries project requester values
  - Tasks grid includes a `Requester` column and task search now indexes requester text
- Fixed sidebar open-target leaf reuse when user closes the sidebar pane.
  - note-open service now validates cached managed leaves are still attached before reuse
  - sidebar targets recreate side leaves when missing, instead of silently reusing stale leaf refs
- Updated project-note openers in Grid/Kanban to render as standard links instead of buttons.
  - replaced button-based open controls with anchor links
  - added dedicated link styling class for normal link presentation
- Added startup view setting with default `None`.
  - users can choose a Project Notes view to auto-open on Obsidian startup
  - startup preference is parsed/validated in settings and opens on layout-ready load
- Removed Bases as a user-facing view variant and renamed remaining views to generic names.
  - primary registered views/commands are now `Project Notes Grid` and `Project Notes Kanban`
  - startup view setting now targets the two generic view IDs
  - added legacy view-id/startup-value mapping for backward compatibility with existing workspaces
- Removed `created-at` and `updated-at` from project frontmatter normalization and view UI.
  - new/normalized project notes no longer auto-insert those frontmatter fields
  - Grid project columns and sort dropdowns no longer expose Created/Updated fields
- Removed status-filter controls from Kanban view.
  - Kanban now ignores status-filter state and always queries across statuses
  - Done/Cancelled visibility remains controlled by Kanban hidden-status settings/drop zones
- Updated Projects grid sorting UX to use clickable column headers instead of separate sort controls.
  - removed `Sort by` and `Direction` dropdowns from grid controls
  - clicking a sortable header now sets sort field and toggles asc/desc with inline arrow indicator
- Added configurable property templates and Area-level property overrides.
  - new global default-properties settings let users define property `name`, `type`, and `default value`
  - per-Area settings now support override/additional properties and disabling selected global properties
  - locked core properties (`status`, `priority`, `start-date`, `finish-date`, `due-date`) cannot be edited/removed
  - added dynamic default tokens (`{{today}}`, `{{tomorrow}}`, `{{yesterday}}`, `{{now}}`, `{{area-name}}`, `{{area-slug}}`, `{{file-title}}`)
  - added `Backfill Missing Project Properties` command to add missing configured properties across existing project notes
- Replaced `custom-name` with Obsidian `aliases`.
  - project model now uses `displayName` (`aliases[0]` fallback to note title)
  - Grid and Kanban link labels now show alias when present, otherwise note title
  - removed `Custom Name` column/sort option and migrated legacy `custom-name` sort setting to `project`
- Updated vault property type syncing to derive from configured project properties (global + Area overrides) instead of hardcoded keys.
- Updated locked-property behavior in property template settings.
  - locked properties now allow editing `default value` while keeping `name` and `type` fixed
  - remove/delete control is now hidden for locked properties instead of shown disabled
- Added optional tri-state task checkbox behavior across note editor and Grid task interactions.
  - new setting toggles checkbox cycle: `[ ]` -> `[/]` -> `[x]` -> `[ ]`
  - task parser/index now persist tri-state (`unchecked`, `in-progress`, `checked`) and still treat only checked as completed
  - editor-change reconciliation now applies tri-state transitions from note clicks and syncs markers consistently
  - when a task enters `in-progress` and has no `🛫` marker, plugin auto-adds `🛫 <today>`
  - improved note-editor state seeding on active file/open to avoid first-click transition misses due stale/late previous-content snapshots
- Fixed tri-state checkbox visual feedback in grid rows.
  - checkbox click handler now applies visual state (`checked`/`indeterminate`) immediately based on computed next state before async cache/index refresh completes
  - prevents unchecked -> in-progress clicks from appearing as fully checked in the UI while markdown is already `[/]`
- Added explicit tri-state visual styling for in-progress checkboxes.
  - grid task checkboxes now carry `data-task-state` and `aria-checked` values from task state
  - in-progress checkboxes render with a custom half-fill bar even when theme/browser does not draw native `indeterminate`
  - added note task styling for list items with `data-task="/"` so `[/]` presents as in-progress instead of a normal checked box
- Added a CodeMirror line-decoration extension for Live Preview in-progress tasks.
  - editor extension marks visible `[/]` task lines with `opn-task-in-progress-line`
  - Live Preview styling now targets that class directly so rendering does not depend on Obsidian internal `data-task` attributes
  - switched half-fill indicator to background-layer rendering instead of pseudo-elements on `input` for reliable cross-engine display
- Simplified tri-state Live Preview CSS to remove redundant fallback selectors.
  - removed legacy `li[data-task]` and `.HyperMD-task-line[data-task]` paths
  - kept the decoration-based selector (`.opn-task-in-progress-line`) as the single Live Preview styling path
- Added configurable Projects-grid columns with per-Area persistence.
  - added a `Columns` multi-select dropdown in the Projects grid to show/hide columns
  - added drag-and-drop reordering for visible columns directly inside the dropdown
  - column choices now include configured custom properties from global defaults and Area overrides
  - grid now renders columns dynamically and persists visible/order state per Area (`gridColumnsByArea`)
  - project index now stores normalized custom-property display values for configured properties, enabling custom column rendering and project search
- Combined column show/reorder controls into a single list.
  - column picker now uses one draggable row list with visibility checkboxes on the far right of each row
  - drag/reorder and show/hide now operate in the same control without separate sections
- Fixed stretched checkbox styling in the Columns picker.
  - narrowed the shared filter-row width rule to exclude `input[type="checkbox"]`
  - visibility toggles now render as normal checkboxes instead of elongated bars
- Updated column picker toggle behavior to preserve row order.
  - unchecking/rechecking a column no longer moves that row within the picker list
  - visibility now only affects grid rendering, while picker order remains stable until explicitly dragged
- Reduced unnecessary grid refreshes on note edits.
  - project index change detection now ignores volatile `createdAt`/`updatedAt` timestamps during equivalence checks
  - editing note body content outside tasks/properties no longer triggers grid refresh churn

#### 2026.03.04
