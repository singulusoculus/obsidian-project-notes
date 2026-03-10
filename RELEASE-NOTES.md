# Release Notes

## v0.0.5

### Features
- Added `Scheduled` date support for both projects and tasks.
  - projects now support the locked `scheduled-date` property
  - tasks now support the `⏳ YYYY-MM-DD` scheduled marker
- Added inline date editing in the grid views for project and task date fields using native date pickers.
- Added automatic project/task workflow syncing for date and status changes.
  - setting a task finish date marks the task complete
  - setting a project start date moves it to `Doing`
  - setting a project finish date moves it to `Done`
  - changing project status to `Doing` or `Done` backfills the matching start/finish date when missing
- Added `Ongoing` as a default project status and included it in the default project-status filter.
- Added project `Timing` multiselect filters to both the Projects view and the Kanban view.
- Added `Off Schedule` as a timing status for projects and tasks when an item is past its scheduled date and has not been started.

## v0.0.4

### Features
- Kanban lanes now expand to fit their cards and all visible lanes match the tallest lane.
- Added configurable Kanban card field visibility with global defaults and Area overrides.
- Added configurable Kanban `Next Task` count (global default + Area override).
- Added Notes content on Kanban cards from the project `## Notes` section with `Read More` / `Read Less`.
- Kanban Notes now render markdown formatting (lists, emphasis, links, etc.).
- Added project `Timing Status` badges (`Current`, `Due`, `Overdue`, `Tomorrow`, `Future`, `Needs Timing`) to:
  - Projects grid as a sortable `Timing` column
  - Kanban cards footer
- Kanban card footer now shows timing badges on the left and priority text on the bottom-right.
- Added `Kanban notes preview lines` setting (default `5`) and dual preview trigger behavior:
  - `Read More` appears when Notes exceed word limit or line limit
- Kanban `Next Task` card label is now dynamic:
  - `Next Task` for one item
  - `Next X Tasks` for multiple
  - optional `(out of Y)` when only a subset is shown

### Fixes
- Improved Kanban drag behavior when starting drag from project links.
- Fixed Kanban drag preview anchor so the card follows from the actual click position.
- Kanban task checkboxes now fully respect tri-state behavior in card task lists.
- Removed `aria-label` attributes from plugin UI/modals to prevent unwanted tooltip popups in Obsidian.

## v0.0.3

### Features
- New project creation now skips Area selection when only one Area is configured.
- Project property/link rendering now supports external links in text/list fields:
  - markdown links (for example `[label](https://...)`)
  - plain `https://...` and `mailto:...` links
- Projects grid now hides task expand toggles when a project only contains completed tasks.

## v0.0.2

### Features
- Added global `Task Status` filtering for project-task rows and the Tasks view, with tri-state-aware options.
- Added computed `Timing Status` badges and filters in Tasks (`Current`, `Due`, `Overdue`, `Tomorrow`, `Future`, `Needs Timing`).
- Added `All` / `None` quick actions to multiselect filter dropdowns.
- Updated control layout so Search appears first and `Columns` sits next to Search in Projects, Tasks, and Kanban.
- Improved Add Task project selection with a searchable popover picker.

### Fixes
- Corrected filter behavior so `None` truly deselects project `Status` and `Priority` filters.
- Fixed timing-filter defaults to keep `Future` off by default and `Needs Timing` on by default.
- Restricted Add Task project options to active projects only (excludes Done/Cancelled).
- Increased Add Task project picker popover/list height for better usability.

## v0.0.1

### Features
- Area-based project indexing with a cache-first architecture and background reconciliation.
- Automatic project note normalization for required sections (`## Tasks`, `## Notes`, `## Links`) plus configured default properties.
- Project creation command with Area picker and immediate normalization.
- Task creation flow from the Tasks grid with project selection and start/due dates.
- Project Grid and Kanban views with shared actions and note open-target routing.
- Tri-state task workflow (`[ ]` -> `[/]` -> `[x]`) in grids and note editing, including automatic task date marker behavior.
- Configurable global project properties with Area-level overrides and disable rules.
- Support for Obsidian `aliases` as the project display name.
- Startup view preference and note-open location options (tab/sidebar/splits).
- Per-Area grid column configuration with a combined draggable Columns picker:
  - show/hide via checkbox
  - drag/drop reordering
  - support for custom property columns from global and Area property templates
- Grid sorting via clickable column headers.
- Simplified view lineup with unified Grid and Kanban views.
