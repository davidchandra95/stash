# Task reminders

A task with a date or time reminds you at that moment, plus any offsets you add. Notifications are scheduled with the operating system, so they appear while Stash is closed. Windows, Linux and the browser preview show reminder settings but cannot deliver them, and say so.

## When a reminder goes off

Offsets count back from the task's moment, the first of:

| Task has | Moment | Default reminder |
| --- | --- | --- |
| A timed work schedule (point or range) | Its start | When it starts |
| A legacy due time | That wall time in the calendar's display zone | At due time |
| A due day or all-day schedule | 09:00 in the display zone on the due day | On the day |

A separate deadline does not move a timed task's reminder; it counts from the work time. Tasks with no date have no reminders.

`tasks.reminders` holds minutes before the moment: up to 5 different values, at most 4 weeks. `null` means the default and `[]` means off, so removing the last reminder stays off after later date changes. Existing tasks use the default, and reminders already in the past never fire. Done, cancelled and deleted tasks don't remind.

Completing a repeating task moves its reminders to the next date, and any snooze ends. The finished occurrence doesn't remind.

## Permission

Reminders schedule only while notifications are allowed, so permission is also their switch. Nothing asks at launch: Settings › Notifications and the task's Reminders section offer **Turn on**, and adding a reminder asks too. The status is one of:

| Status | Meaning | Action |
| --- | --- | --- |
| Allowed | Reminders appear. | None; the task view stays quiet. |
| Not turned on | Stash hasn't asked yet. | **Turn on** |
| Blocked | Refused in the system's settings. | **Open Settings** |
| Not available | This platform or build can't notify. | None |

Status refreshes when the app regains focus. Android 12 and earlier have no runtime prompt, and allow notifications unless they are switched off. Android 13 and later grant exact alarms at install through `USE_EXACT_ALARM`, which Google Play limits to calendar and alarm apps; check that policy before publishing there. If the grant is ever missing, Android may deliver a few minutes late, and a reminder it is late with still arrives unless its task has changed.

## Snooze

Each notification offers Snooze for 10 minutes, 1 hour or 1 day. Choosing one needs nothing from the app: native code schedules another notification for that task. A snoozed reminder shows on the task with a button to cancel it. It ends early if the task is finished, deleted or moved to a different time, or its reminders are turned off; this is applied the next time Stash runs. Clicking a notification opens the task.

## Recent reminders

The bell in the activity rail, or the Android drawer's Recent reminders page, lists reminder times from the last 7 days for open tasks. Selecting one opens the task. A dot marks reminders that have gone off since the list was last opened, tracked per device.

The list is worked out from each task's current reminders rather than a delivery log, because the system only reports notifications still in its own list and nothing can record them while Stash is closed. So it shows what was due, including while notifications were blocked, and says so through the permission line. A task that is finished, deleted or rescheduled leaves the list, and snoozes aren't listed separately.

## Implementation

`src/projects/reminders.ts` decides what is due, with no platform dependencies. `src/projects/reminderService.ts` matches pending notifications to the tasks after edits, on refocus and hourly. `src-tauri/src/reminders.rs` applies it with `UNUserNotificationCenter` on macOS, and passes it to `Reminders.kt` on Android, which uses `AlarmManager` and restores alarms after a restart.

The system keeps what is pending, so Stash stores no delivery state. Identifiers carry what later steps need: `stash.task.<task>.<minutes>.<moment>` and `stash.snooze.<task>.<moment>.<until>`. Rescheduling a task changes the identifier, which retires old reminders and snoozes.

Only the soonest 64 reminders are pending at once, the macOS limit, minus current snoozes. Later ones are scheduled as Stash runs, so someone with more than 64 upcoming reminders who doesn't open the app will miss the later ones. Chosen offsets sync with their task, and each device schedules its own notifications, so a synced task reminds on every device where notifications are allowed. Snoozes and the Recent reminders dot stay on the device. A conflict copy has reminders off, so a conflict can't remind twice. Editing a display zone moves date-only reminders the next time the app syncs.

macOS requires a real `.app` bundle. `tauri dev` runs a bare binary, where the notification center would crash the process, so it reports Not available.
