# Projects and tasks (proposal)

Status: Phases 1–4 implemented on desktop. Android, subtasks and recurring tasks are proposals.

## Goal

Add project and task management to Stash without making tasks part of note content. Tasks are created and managed in a Projects section. Notes can mention any task, and every mention shows the same live state: ticking a task in one note ticks it in every other note, in its project and in task views.

Existing checklists (`taskList`/`taskItem`) are unchanged. They stay plain formatting, keep their Markdown form, and keep feeding the current To-do view. There is no migration or conversion.

## Concepts

- **Task.** A database record with a title, status, dates and an optional project. It exists independently of notes.
- **Project.** A database record with its own lifecycle (status, start and end dates) and progress computed from its tasks. A project is not a notebook. It can optionally point at a notebook that holds its documents.
- **Inbox.** Tasks without a project.
- **Mention.** An inline node in a note that stores only a task ID. It renders the task's current state and edits the task record, never the note.

## Data model

New SQLite tables, added by a schema migration following the rules in [local storage](LOCAL_STORAGE.md). IDs use the same format as note IDs (`validNoteId`).

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,               -- planned | active | on_hold | done | cancelled
  start_date TEXT,                    -- YYYY-MM-DD, local calendar date
  end_date TEXT,                      -- target date
  completed_at INTEGER,
  notebook_id TEXT REFERENCES notebooks(id),
  color TEXT NOT NULL,
  icon TEXT NOT NULL,
  sort REAL NOT NULL,
  deleted_at INTEGER,
  created INTEGER NOT NULL, updated INTEGER NOT NULL, revision INTEGER NOT NULL
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '', -- plain text in v1
  status TEXT NOT NULL,                 -- todo | doing | done | cancelled
  project_id TEXT REFERENCES projects(id),
  priority INTEGER NOT NULL DEFAULT 0,  -- 0 none, 1 low, 2 medium, 3 high
  start_date TEXT,
  due_date TEXT,
  completed_at INTEGER,
  sort REAL NOT NULL,                   -- order within project or Inbox
  deleted_at INTEGER,
  created INTEGER NOT NULL, updated INTEGER NOT NULL, revision INTEGER NOT NULL
);
```

Rules:

- Dates without a time are stored as calendar dates, not timestamps, so they don't shift across time zones.
- Ticking a task sets `status = done` and `completed_at`. Unticking returns it to `todo`. `doing` and `cancelled` are set from the task menu or detail panel.
- Deleting a task or project sets `deleted_at`. Deleted records stay recoverable for undo and sync, and mentions of them show as deleted.
- Deleting a project asks whether to move its tasks to the Inbox or delete them too, like notebook deletion.
- Notes in Trash are left out of "Mentioned in".

### Progress and schedule health

Computed on read, never stored.

- **Progress** = done tasks / (all tasks − cancelled tasks). A project with no counted tasks shows no progress.
- **Health** for an `active` project with an `end_date`:
  - *Overdue*: today is after `end_date`.
  - *At risk*: progress is more than 15 percentage points behind elapsed time, where elapsed = (today − `start_date`) / (`end_date` − `start_date`). Without a `start_date`, only Overdue applies.
  - *On track*: otherwise.

The 15-point threshold is a starting value to tune once real projects exist.

## Mentions in notes

A new inline atom node, `taskReference`, with attributes `taskId` and `fallbackTitle`. It follows the same pattern as `noteReference` in [noteReferences.ts](../src/editor/noteReferences.ts): the editor gets a task lookup through a context, and nodes re-render when that context reports a change.

- **Inserting.** Typing `@` opens an object picker. `@` is reserved for app objects (tasks now, projects later); `[[` stays for note links only. The picker opens only when `@` starts a word, so email addresses don't trigger it. It matches tasks by title, open tasks first and done tasks below them, and shows each task's project. A task's context menu has **Copy task link** (`stash://task/<id>`); pasting that link inserts a mention.
- **Rendering.** Checkbox, title, and small chips for due date and project. Done tasks show checked and struck through. A task that doesn't exist locally shows `fallbackTitle` muted with "Task not found". A deleted task shows "Deleted task" with a Restore action in its menu.
- **Ticking.** Clicking the checkbox updates the task record through the task store. Every note that mentions the task shows the new state, because a mention always renders from the task record. The note bodies themselves hold only the task ID, so they have nothing to rewrite and are not saved.
- **Opening.** Clicking the title opens the task detail panel. Cmd/Ctrl-click opens its project.
- **Renaming.** Renaming a task updates every rendered mention immediately. `fallbackTitle` in note bodies is only refreshed when the note is saved for another reason, so a rename never rewrites notes or linked files.
- **Markdown.** In folder-linked notes a mention is written as `[Task title](stash://task/<id>)`. It stays readable in other editors and keeps the task ID through external edits. Parsing a `stash://task/` link produces a `taskReference`. Existing note links keep their current `upnote2://note/` form; this proposal does not change them.
- **Backlinks.** There is no mention index. "Mentioned in" asks the store for notes whose body or linked Markdown contains the task ID (`task_mentions` command: a `LIKE` prefilter, then an exact check of the document or link). It stays correct however a note changed, whether by editing, a folder refresh or sync, with no table to keep in step. Revisit if libraries grow large enough for the scan to be slow.
- **Removed mentions.** Deleting a mention from a note only removes the link. The task is unaffected.

## Interface

Follow [DESIGN.md](../DESIGN.md): compact rows, shared tokens and surfaces, state in `useAppController.ts`, and views that read it through `useApp()`. Approved mockups: [desktop](ui-v2/projects-mockup.html) and [Android](ui-v2/projects-mobile-mockup.html). They also set these details:

- A task in `doing` shows a half-filled accent checkbox, distinct from to do and done.
- Sidebar projects show a progress ring in the project color, a dashed ring when planned, and a dot when at risk (`--warning`) or overdue (`--danger`).
- A task mention has a thin `--line` outline, so it doesn't read as an underlined note link. A missing task uses a dashed outline.
- The project header's progress bar marks the elapsed share of the project's dates.

Add these to [DESIGN.md](../DESIGN.md) when the UI is implemented.

### Desktop

- **Sidebar.** A Projects section below the notebooks: Inbox, then active and planned projects, with a progress ring per project. On-hold, done and cancelled projects are under a collapsed "Other projects" row. A **+** button creates a project.
- **Project page.** Selecting a project or the Inbox replaces the notes list and editor with one pane:
  - Header: name, status, start and end dates, progress and health, linked notebook. A linked notebook's own header shows a link back to its project.
  - Task list grouped by status (To do, Doing, Done collapsed), sortable by drag.
  - A new-task row at the top of the list: type a title and press Return. Return again creates the next task.
- **Task detail.** Selecting a task opens a detail panel beside the list: title, status, priority, start and due dates, project, description and "Mentioned in".
- **Context menus and shortcuts.** Task rows support complete, set status, set priority, set due date, move to project, copy task link and delete. Keyboard: Space toggles done, Return opens detail, Backspace deletes with undo.

### Android

A stack: project list → project page → task detail, with the same new-task row. Mentions in the mobile editor render and toggle the same way as on desktop.

## Sync (future work)

Not implemented in the phases below. Until this is built, tasks and projects stay on the device where they were created, while notes that mention them still sync; a mention of a task that isn't on this device shows its fallback title as "Task not found". The schema keeps `revision`, `updated` and `deleted_at` so sync can be added without another migration. This section records the intended design.

Tasks and projects sync as their own record kinds, `task` and `project`. Mentions need nothing extra: notes carry the mention nodes.

Changes:

- **Client.** Add `task` and `project` to `sync_dirty` triggers, push, pull and apply. Projects apply before tasks, as notebooks apply before notes.
- **Server.** Accept the new kinds in `server/internal/syncserver/server.go` (currently only `note` and `notebook` pass validation), validate their fields, and store them in the same change log.
- **Protocol.** Bump `protocolVersion` to 2. Clients already fail closed on a version mismatch, so every device must be updated together with the server. This is acceptable for a single private library; document it in [SYNC.md](SYNC.md).
- **Conflicts.** Notes resolve conflicts with a visible conflict copy. That is wrong for tasks, because it would duplicate them. Instead the client records which fields it changed locally. When a push is rejected for a stale base revision, the client pulls the server record, reapplies only its changed fields, and pushes again. If both sides changed the same field, the server value wins and the client shows a sync warning. Projects use the same rule.

## Phases

Each phase ships on its own and keeps existing tests passing.

### 1. Tasks and projects data, basic Projects UI

Implemented (desktop): schema 11 (`projects_schema.sql`), `list_projects` and `save_projects` commands (`storage/projects.rs`; one transaction per batch, revision checks), the store in `src/projects/store.ts` with session data in the browser preview, the sidebar section, project and Inbox pages, task detail panel, project dialogs, and undo for deletes. Not yet done: the Android screens, and restoring an open project page on relaunch. The `icon` column is reserved and not editable yet.

- Schema migration, task and project store in the controller, Tauri commands, browser-preview session data.
- Sidebar Projects section, Inbox, project page with create, edit, complete, reorder and delete, task detail panel.
- No sync changes. Task and project tables are left out of the sync triggers, and an existing sync setup keeps working for notes and notebooks.

Done when: tasks and projects survive restart and a migration from the current schema; create, edit, complete, reorder and delete work with undo; an existing sync library still syncs notes and notebooks unchanged.

### 2. Mentions

Implemented (desktop): the `taskReference` node and `@` picker (`src/editor/taskReferences.ts`), `stash://task/<id>` links on paste and in linked Markdown, Rust validation of mention nodes, **Copy task link**, opening a task from its mention, and "Mentioned in". Two limits: the title stored in a native note (`fallbackTitle`) is not refreshed on rename, so find-in-note matches the title from when it was mentioned; and "Mentioned in" reads saved notes, so a mention typed seconds ago appears after autosave.

- `taskReference` node, `@` picker, copy and paste task links.
- Live re-render across open editors and the project page, Markdown round-trip for linked notes, and "Mentioned in".

Done when: one task mentioned in two notes shows the same state in both after ticking it in either note or in the project page, including a note opened afterwards; typing an email address does not open the picker; ticking a mention does not change any note's revision; a linked Markdown file keeps the mention through an external edit; a missing task renders its fallback title.

### 3. Project tracking

Implemented (desktop): status, dates, progress and health shipped with Phase 1. Phase 3 adds **All projects** (top of the sidebar Projects section): one sortable row per project with status, dates, progress, health and open/late task counts, defaulting to projects that need attention first, with an Active and planned / All filter. The sidebar row counts at-risk and overdue projects; the page reopens on relaunch like project pages.

- Status, start and end dates in the project header, computed progress and health, progress rings in the sidebar.

Done when: progress and health match the rules above in unit tests, including no tasks, all cancelled, no start date and past end date.

### 4. Views

Implemented (desktop):
- **Due today** and **Upcoming** in the sidebar Projects section, across every project and the Inbox. Due today lists overdue tasks, then tasks due today; tasks finished today stay visible, struck through. Its new-task field adds an Inbox task due today. Upcoming groups open tasks by day for the next week, then by month. Rows show their project and open the detail panel.
- **Board** on project and Inbox pages (List | Board in the pane bar, kept for the session): To do, Doing and Done columns; dragging a card between columns changes its status, and within a column reorders it. Cancelled tasks sit in Done.
- **Timeline** on All projects (Table | Timeline): one bar per dated project from start to end, filled to its progress, outlined amber or red when at risk or overdue, with month gridlines and a red today line. A project with only one date shows as a diamond; undated projects are listed below.

- Today and Upcoming task views across projects, a board grouped by status, and a timeline of projects by start and end date.
- Later, separately proposed: subtasks, recurring tasks, rich task descriptions.

## Out of scope

- Converting existing checklists into tasks, or changing the To-do view.
- Assignees, comments, sharing or any multi-user features.
- Reminders and notifications.
- Syncing tasks and projects (designed above, not scheduled).
- Creating tasks from the `@` picker. Tasks are created in the Projects section. This can be added later as a "Create task…" entry if needed.

## Decisions

- A mention stores only the task ID. Note bodies never hold task state, so ticking a task never rewrites notes.
- `@` is for app objects; `[[` stays for note links. Task links use `stash://task/<id>`.
- The project page replaces both the notes list and the editor.
- A project–notebook link shows in both headers.
- Done tasks appear in the `@` picker, below open tasks.
- Task descriptions are plain text in v1.
- Sync is designed here but not implemented.
