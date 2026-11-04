# Projects and tasks

Implemented (desktop): schema 11 (`projects_schema.sql`), `list_projects` and `save_projects` commands (`storage/projects.rs`; one transaction per batch, revision checks), the store in `src/projects/store.ts` with session data in the browser preview, the sidebar section, project and Inbox pages, task detail panel, project dialogs, and undo for deletes. The desktop restores the open project page on relaunch. The Android calendar and task views were added later. The `icon` column is reserved and not editable yet.

## Android

Android has projects, tasks, mentions, the calendar, smart input, Due today, Upcoming, Board and Timeline.

- **Date views.** Due today and Upcoming sit in the drawer, with the project name on each task row.
- **Layouts.** The project list switches to a Timeline that scrolls sideways. A project switches to a Board of status columns. Tasks move between columns through the Status sheet rather than by dragging, and cards can't be reordered yet.
- **New task.** The shared smart input. Enter submits even mid-composition, because touch keyboards compose every word.

## Sync

Projects and tasks sync with notes when the optional sync connection is configured. See [SYNC.md](SYNC.md) for what happens when two devices change the same record.
