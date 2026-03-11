# Project Notes

Project Notes is an Obsidian plugin for managing project notes inside Area folders. It keeps the source of truth in normal markdown notes, builds a cache-first index for fast querying, and gives you Projects, Tasks, and Kanban views over the same notes.

## What It Does

- Treats one or more vault folders as Areas.
- Normalizes notes inside those Areas so project notes have the same core properties and sections.
- Parses tasks from each note's `## Tasks` section.
- Surfaces the data in:
  - a Projects grid
  - a Tasks grid
  - a Kanban board
- Writes changes back to the actual note frontmatter and markdown content.

## Core Model

### Areas

Each Area points at a folder and can include:

- `top-level` notes only
- `recursive` notes in subfolders as well

Areas can also override:

- statuses
- priorities
- default properties for new project notes
- visible grid columns
- visible Kanban card fields
- Kanban next-task count

### Project Notes

Project notes remain plain Obsidian markdown files. The plugin normalizes notes that are created in, or moved into, an Area folder.

Locked default properties:

- `status`
- `priority`
- `scheduled-date`
- `start-date`
- `finish-date`
- `due-date`

Other default properties included by default:

- `aliases`
- `parent-project`
- `requester`

You can add more default properties globally and override them per Area. Property names, types, and default values are configurable. Extra user-defined properties are preserved.

Standard sections:

- `## Tasks`
- `## Notes`
- `## Links`

`## Tasks` is kept as the first heading section after any preamble.

### Tasks

The plugin reads checklist items under `## Tasks` and supports structured task metadata inside the task line:

- `⏳ YYYY-MM-DD` = Scheduled
- `🛫 YYYY-MM-DD` = Start
- `📅 YYYY-MM-DD` = Due
- `✅ YYYY-MM-DD` = Finish
- `🔥`, `🔴`, `🟢`, `🔵` = task priority

Optional tri-state checkbox mode:

- `[ ]` unchecked
- `[/]` in progress
- `[x]` checked

When tri-state mode is enabled, task state cycles like this:

`[ ] -> [/] -> [x] -> [ ]`

Moving a task into `[/]` auto-adds today's `🛫` date if the task does not already have one.

## Views

### Projects

The Projects view shows Area project notes in a grid with:

- search
- sortable columns
- per-column show/hide and reorder control
- status, priority, and timing filters
- Project-Task and Parent-Child modes
- inline editing for status, priority, and project dates
- expandable task sections for projects that still have active tasks

Project display name uses the first `aliases` value when present, otherwise the note title.

### Tasks

The Tasks view shows incomplete or optionally completed tasks across an Area with:

- project link
- requester
- task status filter
- task timing filter
- task priority filter
- inline editing for task dates
- inline checkbox interaction, including tri-state support

Clicking a task can open the project note and temporarily highlight that task.

### Kanban

The Kanban view groups project notes by project `status` and supports:

- drag and drop between statuses
- configurable hidden status drop zones
- search
- timing filter
- add-project actions from the board or from individual lanes
- configurable card content

Card fields can include:

- name
- timing
- scheduled/start/due/finish dates
- requester
- task count
- next task list
- notes preview with markdown rendering
- custom properties

Notes previews support configurable word and line limits with `Read More` / `Read Less`.

## Filtering And Timing

Project timing statuses:

- `Current`
- `Due`
- `Overdue`
- `Tomorrow`
- `Future`
- `Needs Timing`
- `Off Schedule`

Task timing statuses:

- `Current`
- `Due`
- `Overdue`
- `Tomorrow`
- `Future`
- `Needs Timing`
- `Off Schedule`

`Off Schedule` means the item is past its scheduled date and still has no start date.

Default project statuses include:

- `To Do`
- `Doing`
- `Done`
- `Cancelled`
- `Awaiting Response`
- `Ongoing`

## Commands

- `Open Project Notes`
- `Create Project Note`
- `Create Project Note Task`
- `Rebuild Project Notes Index`
- `Backfill Missing Projet Properties`

`Open Project Notes` respects the startup-view setting. If startup view is `None`, it opens to Projects.

## Settings

The settings screen is split into three tabs:

- `General`
- `Properties`
- `Areas`

General settings include:

- project note open target
- startup view
- tri-state task checkboxes
- task note auto-suggest settings
- statuses and priorities
- default project filters and sort
- Kanban hidden statuses
- Kanban notes preview limits
- Kanban default card fields

Properties settings let you define global default project properties. Locked core properties keep their names and types, but their default values remain editable.

Areas settings let you:

- add and remove Areas
- choose `top-level` or `recursive` inclusion
- override statuses and priorities
- override default properties
- override grid columns
- override Kanban card fields and next-task count

## Note Editing Behavior

Project Notes writes changes back to the note itself:

- project field edits update frontmatter
- task edits rewrite the task line in `## Tasks`
- checking a task adds a `✅` finish date if missing
- setting a task finish date checks the task
- clearing a task finish date resets the checkbox to empty
- setting a project `start-date` moves status to `Doing`
- setting a project `finish-date` moves status to `Done`
- changing project status to `Doing` or `Done` backfills today's missing start or finish date

## Installation

### Development

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
```

### Manual / BRAT

For a GitHub release or BRAT-compatible install, attach:

- `manifest.json`
- `main.js`
- `styles.css`

## Tech Notes

- Built with TypeScript and Svelte 5.
- Uses a cache-first project index with vault and metadata event updates.
- Notes remain the persisted source of truth; the cache can be rebuilt from the vault.
