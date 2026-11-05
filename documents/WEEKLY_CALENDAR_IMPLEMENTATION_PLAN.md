# Weekly task calendar implementation plan

Status: implemented in the working tree. The desktop week view, durable task schedules, smart input and Android day/three-day UI share the same task store. See [Calendar](PROJECTS_AND_TASKS.md#calendar) for current behavior and [storage](LOCAL_STORAGE.md#task-calendar-schema-13) for the current data contract. The original research and proposed phases below record the design intent.

Verification on 3 November 2026: 958 frontend tests, 14 focused Playwright tests and 110 Rust tests passed (2 Rust tests ignored). The production frontend build and isolated Mac debug bundle built successfully. Browser checks covered both Stash themes, light and dark mode, desktop widths of 1280px and 900px, and mobile portrait, landscape and short viewports. In the isolated Mac app, a timed point and the open Calendar page survived quit and reopen; a forced revision conflict displayed an error and restored the saved task. Android device acceptance remains open.

## Goal and scope

Add a task calendar to Stash that lets a user see and plan a week like the [TickTick Week View](https://help.ticktick.com/articles/7055782149730861056). It should show tasks from the Inbox and projects, including dated tasks without a time, timed tasks, and tasks that span several days. Creating, moving, resizing, opening and completing a calendar item must update the same task used elsewhere in Stash.

The initial target is the linked week-view workflow, not an entire replacement for TickTick. The phases below cover the desktop week view and the mobile work needed for a usable calendar. Day, month, year, agenda and configurable multi-day or multi-week views are separate extensions. External calendars, habits, focus records, and recurring tasks require their own data models and are not implied by a visual calendar. They remain possible follow-up work, not capabilities claimed for this plan.

## Reference: what was checked

- In Brave, the linked guide's desktop examples show seven day columns, a date header and all-day area above an hourly timeline. The toolbar has a view selector, previous/next navigation, Today, add and more actions. A draft editor appears over the grid after choosing a day or time; the selected date is visible in it. [TickTick Week View](https://help.ticktick.com/articles/7055782149730861056)
- The same guide describes clicking the all-day area or timeline to create, dragging to select a duration or multiple days, dragging existing tasks to another time, and resizing duration blocks. It also describes an Arrange Tasks panel for unscheduled tasks, completed tasks shown more lightly, an adjustable all-day area, timeline zoom and hidden hours, navigation by controls and keyboard, and mobile day and three-day views. Those are documented behaviors, not all tested interactively.
- In the signed-in TickTick Mac app, the week view showed seven columns, the all-day area, a vertical time grid, a current-time line in today's column, and previous/next and Today controls. Clicking a blank 10:00 slot opened an empty draft with that date and time. Dragging through the timeline opened a draft with the selected time range; one test displayed 09:00 to 10:45. Clicking an all-day cell opened a draft with a date and no time displayed. I closed the drafts without saving.
- The app's **Arrange tasks** action opened a right-side panel with List, Tag and Priority tabs and a list filter. This account showed an empty state for undated tasks, so dragging an existing task from that panel was not tested. **View Options** offered color and style choices and switches for completed tasks, checklist items, repeat cycles, habits, focus records and an additional time zone. I did not change those switches and restored the original day view after inspection.
- The earlier [smart-input research](TICKTICK_SMART_INPUT_RESEARCH.md) covers recognizing text such as `@2pm`. Calendar scheduling and the parser should share the same task representation, but the parser needs its own tests and does not by itself implement reminders.

## Current Stash foundations

These are observations of the current working tree, which includes uncommitted work and may change before implementation starts.

- [Task model](../src/projects/model.ts) stores `startDate` and `dueDate` as date-only strings. The [SQLite schema](../src-tauri/src/storage/projects_schema.sql) and [Rust storage](../src-tauri/src/storage/projects.rs) have no task time, duration, time zone, recurrence or reminder. Existing date-only values should remain calendar dates, not be converted to midnight timestamps.
- [Task actions](../src/projects/actions.ts), [project store](../src/projects/store.ts) and [task details](../src/projects/TaskDetail.tsx) already create, edit, complete and persist the same task records. Saves replace whole records using revision checks; the frontend store applies changes optimistically, saves in order, and reloads stored data on failure. The calendar must use these paths and handle their failures visibly.
- [ProjectPane](../src/projects/ProjectPane.tsx), [sidebar](../src/app/Sidebar.tsx) and [app controller](../src/app/useAppController.ts) provide project navigation, a shared task detail panel, and selected-task state. A calendar can be a Projects page alongside Today and Next 7 Days. Include it in the controller's fixed-page and workspace-restore logic.
- The working tree currently contains [NewTask](../src/projects/NewTask.tsx) and [smartInput](../src/projects/smartInput.ts), an in-progress English date-only parser. It explicitly leaves times and repeats as text. Recheck this work before implementation; do not assume it is committed or complete.
- Projects and tasks are local to the device today. [Projects and tasks](PROJECTS_AND_TASKS.md) describes task sync as future work, and Android project/task screens as proposals. A calendar cannot honestly be called cross-device merely because note sync exists.
- [DESIGN.md](../DESIGN.md) defines Stash's compact native-style controls, shared tokens, themes, mobile boundaries and visual review checklist. TickTick is a behavioral reference; the calendar should look like Stash.

## Proposed behavior

### Calendar page

- Add **Calendar** to Projects navigation. Open the current week by default and preserve a meaningful visible date when returning. A toolbar shows the month or date range, previous/next week, Today and an add action. Use the user's first-day-of-week preference; define a safe default and test year boundaries.
- Seven day columns share a sticky date header, an all-day area, and a vertically scrollable time grid. Highlight today and show a current-time line only in today's column. Scroll to a useful daytime range on initial open while keeping the full day reachable.
- Show date-only tasks in the all-day area on their due date. Show explicit all-day ranges across each covered day and timed tasks at their time. Long titles, dense all-day rows, overlaps, cross-midnight tasks and narrow windows must remain accessible rather than silently hiding items. Keep project identity and completion visible without relying only on color.
- Selecting an item opens the existing task detail. Completing it updates the task everywhere. Show completed tasks in a quieter style and provide a clear option for showing or hiding them; decide how cancelled tasks are displayed consistently with the existing task views.
- Include an **Arrange tasks** panel for open, unscheduled tasks from Inbox and projects, with project grouping/filtering and a keyboard-accessible Schedule action as well as dragging. Define unscheduled using actual schedule and due-date state, not just a missing project.

### Create and edit

- Click an all-day cell or a time slot to open a draft with that day or time already selected. Drag across a time range or date range to create a draft. A draft must not persist until a title is submitted; Escape cancels it. The user can choose the project or Inbox and edit date/time before saving.
- Drag a task to move it, drag a duration edge to resize it, and drag an all-day item across dates. Show the proposed date and time while dragging. Default to 15-minute snapping for timed interactions; the detail editor allows exact minutes. A click on a time slot creates a time point, not a silently stored duration. Any minimum height used for drawing that point is visual only.
- Provide keyboard and non-drag alternatives for every operation: open the task, set or clear date/time/range in detail, move to a chosen date/time, and complete it. Preserve focus, announce changes, and do not hijack arrow keys while a text field or menu is active. Support undo for a completed move or resize using the existing notice pattern, subject to the save-failure rules below.
- Integrate smart input after the durable time model exists. For example, `throw trash can @2pm` should display the parsed preview, save a timed task, and render at 14:00 in the calendar. In this proposal, 14:00 is the scheduled time, while the linked deadline has day-level precision. It does not create a notification or an independent time-specific deadline. A date selected from the calendar or picker must have a documented precedence over parsed text; cancelling a match must not delete the user's words. Do not interpret unsupported repeat/reminder phrases as if they were supported.

### Due date versus scheduled work

A due date is a deadline; a scheduled block is when the user plans to work. Stash already has due dates, so these cannot be silently treated as the same thing in every case. Recommended default for review:

| Situation | Calendar and due-date behavior |
| --- | --- |
| Existing task with only a due date | Render one all-day due marker. Moving that marker changes the due date. Keep its existing `startDate` unchanged. |
| New task created in the calendar, or an unscheduled task dropped onto it | Create a schedule and link its due day to the schedule by default, so it appears in Today/Next 7 Days. A time point uses its local day; a range uses its last included local day. |
| User explicitly sets a separate due date | Unlink the deadline from the schedule. Moving or resizing the schedule leaves that deadline unchanged. Show both values in task details; show a separate due marker when it falls on a different day. Avoid drawing two items for the same task on the same day without a clear reason. |
| Clear a linked schedule | Preserve the current effective due day as a date-only deadline unless the user explicitly clears the deadline too. |

Use a single effective-due-date helper in all task views, counts, sorting and mentions. For linked tasks, derive the displayed due day from the schedule rather than keeping a second date that can become stale. Editing the deadline explicitly unlinks it in the same save. The UI must make the link and its effect clear. Confirm this product behavior before the schema is finalized; it is a Stash proposal, not a claim about TickTick's internal model. If the product instead wants every drag to move the deadline, revise the model and acceptance tests together rather than adding hidden synchronization.

## Data and time model

Proposed task-owned optional schedule, with a discriminated kind and validation on both TypeScript and Rust boundaries:

- **None:** no scheduled block. Existing due-only tasks use their existing `dueDate`.
- **All-day range:** start and end calendar dates, represented internally as `[start, end)` with an exclusive end. A one-day item ends on the next calendar date. Display the last included date to users.
- **Timed point:** a start instant and the IANA time-zone identifier used when it was entered; no end. This supports `@2pm` without inventing a duration.
- **Timed range:** start and end instants plus the entry time zone, with `end > start` and an exclusive end. A range can cross midnight and is split into visible day segments without creating extra task records.

Store linked-deadline state explicitly. In linked mode the schedule is the source of the effective due date; a separate `dueDate` must not compete with it. In independent mode keep the existing `dueDate` as a floating calendar date. For a timed schedule, render in the current display time zone and derive the linked due day in that zone; retain the entry zone for editing and explaining the original time. For all-day ranges, dates remain floating and do not shift during travel. Choosing another display zone must not rewrite stored data. The final UI should explain these choices, especially where a timed block crosses a date boundary after travel.

Use calendar arithmetic for date-only values. Resolve wall-clock input against a real time zone and define visible behavior for daylight-saving gaps and repeated times: reject a nonexistent time with a correction, and ask the user to choose an offset when a time occurs twice. Do not silently assume every day has 24 hours or parse a date-only value with a timestamp constructor. Verify the availability and behavior of the chosen time-zone library in both the WebView and Rust; pin any added dependency and test its data and supported range. No time-zone library is currently evident in the project dependencies.

Do not overload the existing task `startDate` as the start of a calendar block: it is already a separate task property and old records may contain it. Define the exact serialized schema, migration defaults and validation after the due/schedule choice above is accepted. Future recurrence and external calendar events need separate designs, including occurrence identity and edits; do not fake them as duplicated tasks.

## Implementation phases

Each phase should leave the app usable and have its own checks. Re-read the current working tree before starting because the task composer is being changed separately.

1. **Domain contract and persistence.** Finalize schedule kinds and linked versus independent due semantics. Add a versioned SQLite migration with nullable/defaulted fields, backup-before-upgrade, transactional rollback and newer-schema rejection, following [local storage](LOCAL_STORAGE.md). Extend Rust request/response types, validation, queries and writes; extend TypeScript `Task`, fixtures, save requests, actions, preview store and task detail. Update all places that consume due dates to use the shared effective-due selector. Preserve old tasks exactly and update storage docs after the schema is known.
   - Done when old libraries reopen with the same dates, new values survive restart, invalid or stale writes fail safely, and a timed point never gains a made-up duration.
2. **Week view and navigation.** Add the Projects page, date arithmetic, toolbar, sticky headers, all-day area, time grid and task rendering. Open the existing detail panel and task actions. Handle overlapping timed blocks with deterministic side-by-side placement, clip multi-day spans at week edges and provide an overflow path for dense all-day items.
   - Done when due-only, timed, multi-day and completed tasks render correctly across project and Inbox, week navigation crosses month/year boundaries, and task selection/completion agrees with other views.
3. **Creation and editing.** Add draft creation from cells and ranges, move/resize, snapping, conversion between all-day and timed, explicit due-link control, detail editing and undo. Add the Arrange Tasks panel and keyboard alternatives. Make the preview temporary until a save succeeds; on validation, revision or disk failure, surface the error and restore the confirmed state without displaying a false success or losing an unsaved draft.
   - Done when a move or resize updates the intended fields atomically, cancelled gestures make no write, keyboard-only users can perform the same scheduling work, and failure/undo cases keep all views consistent.
4. **Smart input integration.** Extend the current date-only composer to recognize supported times and time ranges against the same model, including the `@2pm` example. Share interpretation rules and effective due-date logic with calendar creation; preserve the existing date-word setting and cancellation behavior. Keep unsupported recurrence and reminders as text.
   - Done when typing, picker selection and calendar creation produce equivalent task data, with tests for conflicting explicit values, editing, paste, cancellation, midnight and time-zone changes.
5. **Mobile and polish.** First provide the missing Projects/task access on Android, then a touch-friendly day/three-day calendar using the same data and non-drag scheduling controls. Add useful week-view enhancements from the guide: adjustable all-day area, timeline zoom and configurable hidden hours where practical, and accessible navigation. Keep these settings local unless a separate sync design says otherwise. Follow the mobile and desktop visual checks in [DESIGN.md](../DESIGN.md).
   - Done when touch, keyboard and screen-reader paths are usable at the documented viewport sizes, desktop native and Android device checks are reported separately, and the calendar still works offline. Desktop can be delivered earlier, but mobile completion must not be implied until its own checks pass.

## Verification plan

- **Domain and storage:** test no schedule, date-only, points, ranges, linked and independent deadlines, conversion and clearing; range boundaries, overlapping tasks, cross-midnight, week/year boundaries, leap days, time-zone travel, daylight-saving gaps and repeated times. Test schema 11 upgrade from a copy, fresh library, backup failure, rollback, invalid payloads, revision conflicts and restart. Verify older builds reject the newer database and document the backup/restore limit.
- **Interaction:** browser tests for creating each kind of draft, cancellation, move, resize, unscheduled scheduling, detail edits, undo, completion, focus and keyboard alternatives. Include a save failure while a newer edit is queued, and verify the confirmed record and error are shown accurately. Test the smart-input example end to end without relying only on parser unit tests.
- **Visual and accessibility:** check both Stash themes and light/dark modes at 1280x800 and 900x650, dense overlapping items, long text, all-day overflow, hidden sidebar and narrow task-detail layouts. Follow [DESIGN.md](../DESIGN.md) for Android portrait, landscape and short viewport checks. Check focus contrast, text labels, screen-reader descriptions, reduced motion and touch targets.
- **Native acceptance:** use an isolated test library in the Mac app to verify persistence, quit/reopen and save failures. Test the Android app on a device when that phase is built. Browser preview is session-only and cannot prove native persistence or touch behavior. Run the relevant frontend, Rust storage and UI suites, plus the repository's required full test/build checks, and report failures separately.

## Dependencies and risks

- **Concurrent work:** the smart-date input and other files are already uncommitted. Coordinate changes to the shared composer, appearance settings, model and storage rather than overwriting them.
- **Migration and rollback:** adding schedule fields changes durable data. Follow the existing backup policy and never claim older clients can safely edit the newer schema. Restoring a backup can lose later changes.
- **Save ordering:** the current project store reloads on failure. Exercise in-flight and queued edits before using it for drag operations; a visual undo must not replay stale task fields over later changes.
- **Local-only tasks:** the calendar inherits the current lack of project/task sync. A separate sync design must include the schedule fields, linked deadline, versioning, conflicts and cross-device time-zone tests before promising synced calendar data.
- **Performance:** current project data is loaded as a snapshot. Start with visible-week selectors and deterministic layout; measure real dense weeks before introducing indexes, virtualization or an external calendar library.
- **Reference limits:** the article documents capabilities that were not all exercised in this session. In particular, dragging an existing task, multi-day range creation, overlaps, exact snapping rules, saved values and reminders still need targeted confirmation if matching TickTick exactly becomes a requirement.
