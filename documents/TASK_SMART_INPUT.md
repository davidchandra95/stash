# Task smart input

Task creation in Inbox, project List and Board, and Due today recognizes English calendar dates and times as you type or paste. The input keeps the original text editable, highlights accepted phrases in the current accent, and previews the due date and time beside the calendar button. Press Enter to add the task and continue typing the next one. Escape clears the draft.

This implements date and time recognition from [the TickTick research](TICKTICK_SMART_INPUT_RESEARCH.md), extending Stash's [task model](PROJECTS_AND_TASKS.md) with an optional due time. Time ranges, hour/minute delays, repeats and reminder instructions remain ordinary title text. They do not create a repeat rule or notification. Task title editing and the note editor's `@` mention picker are unchanged.

## Recognized dates

| Input | Rule |
| --- | --- |
| `today`, `tod`, `td`, `tomorrow`, `tmr` | Current local day or the following day. |
| `Monday`, `Mon`, `this Monday` | Nearest matching weekday, including today. |
| `next Monday` | Next matching weekday strictly after today. |
| `in 2 days`, `2 weeks later` | Calendar offset from today. Days, weeks, months and years are supported. |
| `next week`, `next month`, `next year` | One calendar unit after today. |
| `2026-12-05` | Exact ISO calendar date. |
| `6 March`, `Mar. 6th, 2027`, `2nd Jan 2027` | Named month with an optional year. Without a year, use the next valid occurrence, including leap day. |
| `@2pm`, `at 9am`, `2:30 pm` | Local 12-hour time, converted to `14:00`, `09:00`, `14:30`. `12am` is midnight and `12pm` is noon. |
| `@14:30`, `at 14:30`, `14:30` | Local 24-hour time. |

A time without a recognized date uses today, including when that time has already passed. For example, `throw trash @2pm` previews `Today, 14:00`; `Meet tomorrow at 9am` previews `Tomorrow, 09:00`. Stash does not silently move a past time to tomorrow. Due times are local wall-clock values rather than UTC instants, so travelling or daylight-saving changes do not rewrite the saved date or clock time. There is no time-zone selector or notification scheduler. Day-based task groups and overdue coloring retain their existing calendar-day rules.

Matching is case-insensitive. An optional `on ` or `due ` prefix belongs to the recognized span. Numeric slash dates such as `11/12/2026` are left alone because their day/month order is ambiguous. Invalid dates, email addresses, URL/path fragments, and common repeat, reminder, negation and date-range phrases are left alone. A recognized repeat schedule or date range disables recognition for that draft, including weekday lists such as `every Monday and Friday`. Recognition is deliberately limited; it does not interpret arbitrary English sentences.

Month and year offsets clamp to the last valid day of the destination month: one month after January 31 is February 28 (29 in a leap year). Relative phrases use the device's local calendar date. Calendar arithmetic does not use elapsed 24-hour durations, so daylight-saving changes cannot shift the result. Open drafts refresh at local midnight and when the app becomes active.

## Corrections and saved titles

- Click a highlighted phrase to cancel that phrase's recognition without deleting its words. The adjacent cancel button cancels both accepted date and time spans. Selecting exactly a phrase and pressing Backspace/Delete, or deleting at its edge, also cancels that phrase's recognition first. A later deletion edits the text normally.
- Cancellation survives edits elsewhere in the draft. Editing the cancelled phrase allows it to be recognized again.
- If several dates or times appear, the last eligible date and last eligible time set the schedule. Both accepted spans are highlighted separately. Cancelling one preserves recognition of the other and can reveal an earlier eligible span. Only highlighted spans can be removed from the saved title.
- Recognized words are removed from the saved title by default. If removing them would leave an empty title, the original words are kept.
- The calendar button opens date and time fields, Today/Tomorrow/No date shortcuts, and recognition options. A manual date or time overrides recognition and keeps all title words. **Use date and time from text** restores recognition. Clearing the due date clears its time; a time chosen without a date sets today's date.
- **Recognize dates and times** and **Keep recognized words in title** are device preferences saved through the existing preferences store. They apply to all task creation fields, including after restarting the native app. Browser-preview preferences are session-only, like the rest of that preview.
- Due today supplies today's date unless a recognized phrase or manual choice overrides it. Cancelling recognition restores that default; **No date** explicitly removes it. After adding a task, the next draft returns to the view's default date.
- Enter during input method composition does not create a task. All creation and correction controls respect the app's blocked state.

Dates save to `dueDate` as `YYYY-MM-DD`; optional times save to `dueTime` as `HH:mm`. A time requires a due date. Native schema version 12 adds nullable `tasks.due_time` after backing up an existing library. Existing tasks retain their dates with no due time. Native storage validates the time and database constraints reject invalid values. Due times survive reopening, are shown on task rows, boards and mentions, and can be edited in task details. Clearing a task's due date also clears its time. Task sync and notifications remain outside this feature.

## Implementation and checks

`src/projects/smartInput.ts` owns date recognition, title extraction and cancellation tracking without React or storage dependencies. `src/projects/NewTask.tsx` is the shared creation field. Its plain input retains native selection, caret, clipboard, undo and input-method behavior; a scroll-aligned text layer provides the clickable highlight. A live status describes the due date and title behavior for screen readers.

Unit tests cover recognition boundaries, title extraction, cancellation, month/year boundaries, leap days and daylight-saving dates. Storage tests cover old preferences and saved options. Browser tests cover creation across all existing task surfaces, edits, cancellation, manual overrides, preferences, long drafts, composition and clock changes. Browser checks do not establish native rendering or device acceptance.
