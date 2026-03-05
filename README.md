# Obsidian Project Notes

Area-based project note management for Obsidian with cache-first indexing, task parsing, and Grid/Kanban views.

## Features

- Multiple Areas (`folderPath + include mode`) with per-area top-level or recursive scope.
- Standardized project note normalization in Area folders:
  - Frontmatter properties: `custom-name`, `status`, `priority`, `start-date`, `finish-date`, `due-date`, `tags`, `parent-project`, `requester`.
  - Standard sections: `## Tasks`, `## Notes`, `## Links`, with `## Tasks` enforced as first heading section after preamble.
- Strict task emoji parsing in `## Tasks`:
  - `🛫 YYYY-MM-DD`
  - `📅 YYYY-MM-DD`
  - `✅ YYYY-MM-DD`
- Cache-first query architecture with incremental updates on vault/metadata events and periodic reconciliation.
- Separate Custom and Bases-labeled views for Grid and Kanban.
- Project note open-target settings:
  - New Tab
  - Sidebar (Left / Right)
  - Split (Left / Right / Bottom)
- `Create Project Note` command with Area picker and automatic normalization.

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

- `Project Notes Grid (Custom)`
- `Project Notes Kanban (Custom)`
- `Project Notes Grid (Bases)`
- `Project Notes Kanban (Bases)`
- `Create Project Note`
- `Rebuild Project Notes Index`
