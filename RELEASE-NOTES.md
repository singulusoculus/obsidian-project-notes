# Release Notes

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
