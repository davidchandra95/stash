# Projects and tasks

Implemented (desktop): schema 11 (`projects_schema.sql`), `list_projects` and `save_projects` commands (`storage/projects.rs`; one transaction per batch, revision checks), the store in `src/projects/store.ts` with session data in the browser preview, the sidebar section, project and Inbox pages, task detail panel, project dialogs, and undo for deletes. The desktop restores the open project page on relaunch. The Android calendar and task views were added later. The `icon` column is reserved and not editable yet.

## Repeating tasks

The Repeat section of task details offers Daily, Weekly, Monthly, Yearly and Custom: every 1–99 days, weeks, months or years, with a choice of weekdays for weekly repeats. **From** chooses what the next date counts from:

- **Scheduled date** stays on the pattern. Completing a task late skips dates that have passed, and completing it early moves one step past its date. A task on the 31st returns to the 31st after a shorter month, and moving the date by hand sets a new day.
- **After completion** counts from the day you complete it, in the display zone or the schedule's own zone. Weekdays don't apply.

Completing a repeating task, from any surface or a note mention, keeps its ID and moves it to the next date, so note mentions follow the routine. The start date, due date and work schedule move together, and schedules keep their wall-clock times in their own zone. The finished occurrence stays behind as an ordinary done task that counts toward project progress. Both records save in one transaction, and a notice offers undo.

Only the next occurrence exists, so Calendar and Next 7 Days don't show later ones. Reopening a finished occurrence after the notice has gone makes it a one-off task and doesn't affect the routine. Cancelling a repeating task stops it without creating an occurrence. Turning on a repeat for a dateless task sets its due date to today. Rules live in `src/projects/repeat.ts`; the roll-forward is `completeOccurrence` in `actions.ts`. Smart input doesn't recognize repeat phrases yet, so they stay in the title.

## Tags

Tasks have their own tags, separate from the hashtags in note bodies: up to 20 per task, each up to 50 characters, stored lowercase with spaces turned into hyphens. Add them from task details, or by typing `#tag` in any new-task field. A tag exists while a task that isn't deleted uses it, so removing it from its last task retires it. There is no rename or merge yet. Rules live in `validate_task` (`storage/projects.rs`), `validateTags` on the sync server, and `taskTagName` (`src/tags.ts`).

## Filters

Filters are saved smart lists on desktop. **New filter** (the + beside Filters in the sidebar) picks any of projects (including Inbox), task tags, priorities and due dates (Overdue, Today, Tomorrow, Next 7 days, Later, No date), and whether to show open, completed or all tasks. A task must match every condition; within a condition any selected option matches, and an empty condition matches anything. Next 7 days includes today and tomorrow. Cancelled and deleted tasks never match.

A filter page groups tasks Overdue, To do and Completed, like a tag page. A task added there starts in the filter's project when it names exactly one, with its first tag, and due today when Today or Next 7 days is selected, so it usually stays on the page. Deleting a filter offers Undo.

Filters are a device preference (`Appearance.taskFilters`, rules in `src/projects/filters.ts`): they don't sync and Android doesn't show them yet. A filter keeps a deleted project's ID, which then matches nothing until it is removed in the dialog.

## Android

Android has projects, tasks, mentions, the calendar, smart input, Today, Next 7 Days, Summary, Completed, Trash, Board and Timeline.

- **Smart lists.** Today, Next 7 Days, Summary, Completed and Trash sit in the drawer, with the project name on each task row.
- **Layouts.** The project list switches to a Timeline that scrolls sideways. A project switches to a Board of status columns. Tasks move between columns through the Status sheet rather than by dragging, and cards can't be reordered yet.
- **New task.** The shared smart input. Enter submits even mid-composition, because touch keyboards compose every word.

## Sync

Projects and tasks sync with notes when the optional sync connection is configured. See [SYNC.md](SYNC.md) for what happens when two devices change the same record.
