# Project Notes

Project Notes is an Obsidian plugin for managing project notes inside Area folders. It keeps the source of truth in normal markdown notes, builds a cache-first index for fast querying, and gives you Projects, Tasks, and Kanban views over the same notes.

## What It Does

- Treats one or more vault folders as Areas.
- Initializes newly created project notes inside those Areas with the configured default properties and standard sections.
- Parses tasks from notes that include a `## Tasks` section.
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

Project notes remain plain Obsidian markdown files. When a note is created inside an Area folder, the plugin adds the configured default properties and standard sections. Existing notes are not automatically re-normalized later, so removed properties or sections stay removed unless you restore them yourself.

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

Date meaning:

- `scheduled-date` = planned start date
- `start-date` = actual start date
- `due-date` = target completion date
- `finish-date` = actual completion date

Standard sections:

- `## Tasks`
- `## Notes`
- `## Links`

When those sections are created, `## Tasks` is kept as the first heading section after any preamble.

### Tasks

The plugin reads checklist items under `## Tasks` and supports structured task metadata inside the task line:

- `⏳ YYYY-MM-DD` = Scheduled planned start
- `🛫 YYYY-MM-DD` = Start actual start
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
When a top-level task moves to `[x]`, the plugin moves that task and its nested subtree into a `### Done` subsection under `## Tasks`. Reopened tasks are moved back to the top of the active `## Tasks` list.

## Views

### Projects

The Projects view shows Area project notes in a grid with:

- search
- sortable columns
- per-column show/hide and reorder control
- status, priority, and timing filters
- expandable task rows
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
- `Today`
- `Due`
- `Overdue`
- `Tomorrow`
- `Future`
- `Needs Timing`
- `Off Schedule`

Task timing statuses:

- `Current`
- `Today`
- `Due`
- `Overdue`
- `Tomorrow`
- `Future`
- `Needs Timing`
- `Off Schedule`

Timing rules use the resolved view dates shown by the plugin. `Scheduled` is treated as the planned start date. `Start` is treated as the actual start date.
Timing filters on Projects, Tasks, and Kanban also include `Blank`, which matches items with no timing status.
For projects with `opn-infer-dates` explicitly enabled on the note, if the note has no project-owned timing dates and no unfinished tasks remain, the project timing status is `Blank`.

Projects:

- `Current`
  - project is not `Done` or `Cancelled`
  - and either project `status` is `Doing`
  - or `scheduled-date` and `due-date` both exist and `scheduled-date <= today <= due-date`
- `Today`
  - project is not `Done` or `Cancelled`
  - and any of `scheduled-date`, `start-date`, or `due-date` is today
- `Off Schedule`
  - project is not `Done` or `Cancelled`
  - `scheduled-date` exists
  - `start-date` is blank
  - and today is later than `scheduled-date`
- `Due`
  - project is not `Done` or `Cancelled`
  - and `due-date` is today
- `Overdue`
  - project is not `Done` or `Cancelled`
  - `due-date` exists
  - and today is later than `due-date`
- `Tomorrow`
  - project is not `Done` or `Cancelled`
  - and `scheduled-date` is tomorrow
- `Future`
  - project is not `Done` or `Cancelled`
  - and `scheduled-date` is later than tomorrow
- `Needs Timing`
  - project is not `Done` or `Cancelled`
  - and all of `scheduled-date`, `start-date`, and `due-date` are blank

Tasks:

- `Current`
  - task is not checked
  - parent project is not `Done` or `Cancelled`
  - and either task checkbox state is `In Progress`
  - or task `scheduled-date` and `due-date` both exist and `scheduled-date <= today <= due-date`
- `Today`
  - any of task `scheduled-date`, `start-date`, or `due-date` is today
- `Off Schedule`
  - task `scheduled-date` exists
  - task `start-date` is blank
  - and today is later than `scheduled-date`
- `Due`
  - task `due-date` is today
- `Overdue`
  - task `due-date` exists
  - and today is later than `due-date`
- `Tomorrow`
  - task `scheduled-date` is tomorrow
- `Future`
  - task `scheduled-date` is later than tomorrow
- `Needs Timing`
  - all of task `scheduled-date`, `start-date`, and `due-date` are blank

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
- `Add Missing Properties to Current Note`
- `Backfill Missing Project Properties`

`Open Project Notes` respects the startup-view setting. If startup view is `None`, it opens to Projects.
`Rebuild Project Notes Index` refreshes the cache without modifying notes.
The two add/backfill commands only restore missing properties; they do not recreate removed sections.

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
- `start-date` is the actual start date written to the note
- `scheduled-date` is the planned start date written to the note

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
