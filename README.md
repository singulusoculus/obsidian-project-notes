# Obsidian Project Notes

Area-based project note management for Obsidian with cache-first indexing, task parsing, and Grid/Kanban views.

## Features

- Multiple Areas (`folderPath + include mode`) with per-area top-level or recursive scope.
- Standardized project note normalization in Area folders:
  - Default frontmatter properties: `aliases`, `status`, `priority`, `start-date`, `finish-date`, `due-date`, `parent-project`, `requester`.
  - User-configurable property defaults (name + type + default value) with per-Area overrides and optional per-Area global-property exclusions.
  - Locked core properties: `status`, `priority`, `start-date`, `finish-date`, `due-date`.
  - Standard sections: `## Tasks`, `## Notes`, `## Links`, with `## Tasks` enforced as first heading section after preamble.
- Strict task emoji parsing in `## Tasks`:
  - `🛫 YYYY-MM-DD`
  - `📅 YYYY-MM-DD`
  - `✅ YYYY-MM-DD`
 - Optional tri-state task checkbox mode:
   - unchecked (`[ ]`) -> in progress (`[/]`) -> checked (`[x]`) -> unchecked
   - when entering in-progress, missing `🛫` start marker is auto-added as today
- Cache-first query architecture with incremental updates on vault/metadata events and periodic reconciliation.
- Grid and Kanban views.
- Project note open-target settings:
  - New Tab
  - Sidebar (Left / Right)
  - Split (Left / Right / Bottom)
- `Create Project Note` command with Area picker and automatic normalization.
- Backfill command to add missing configured properties to existing project notes.

## Development

```bash
npm install
npm run dev
```

Build for production:

```bash
npm run build
```

## Commands

- `Project Notes Grid`
- `Project Notes Kanban`
- `Create Project Note`
- `Rebuild Project Notes Index`
- `Backfill Missing Project Properties`
