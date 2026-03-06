# Release Notes

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
