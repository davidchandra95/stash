# Habits

Habits are routines you check off once a day, each day with an optional note, such as "Read book ABC, chapter 6". They live in the Projects sidebar (Habits, after Calendar) on desktop and in the Android drawer.

## Checking in

- Click a day to check it off. The note field opens at once; type a note or press Escape (or click elsewhere) to keep the check-in without one. ⌘/Ctrl+Return closes it too.
- Click a done day to edit its note or choose **Mark not done**. Unchecking keeps the note.
- Days can be checked up to today, never in the future. A dot on a day marks a note.
- Archived habits can't be checked in until restored.

The Habits page shows the last seven days of every active habit, its frequency (or, for weekly habits, this week's count) and its current streak. The sidebar count is how many daily and weekday habits are due today and not yet done. Selecting a habit opens its inspector: name, current and best streak, total check-ins, a month of days you can check in from, the **Notes** written on check-ins (newest first), repeat, start date and color. Android shows the same on a habit page, with seven-day cards on the Habits page.

## Frequency and streaks

- **Daily**: due every day.
- **Some days**: due on chosen weekdays. Other days show a quieter ring and can still be checked; they don't count toward or break a streak.
- **Weekly**: 1–7 times a week, on any days. Weeks start on Monday.

A streak counts due days done in a row (weekly habits: weeks that met the target). Today, or the current week, adds to a streak once done but never breaks it while there's still time. Days before the start date don't count.

## Storage and sync

Schema 19 adds `habits` and `habit_checkins` (`habits_schema.sql`, `storage/habits.rs`). A check-in's ID is `<habit ID>_<YYYYMMDD>`, so a day is one record wherever it was checked. Habits delete softly (Undo restores them with their check-ins); check-ins are never deleted, only marked not done.

Limits shared by `storage/habits.rs`, `server/internal/syncserver/habits.go` and `src/habits/model.ts`: names up to 200 characters, notes up to 2,000, colors as `#rrggbb`, habit IDs up to 119 characters so check-in IDs fit.

Habits sync with sync protocol 3. When two devices change the same day, the server merges them: the day is done if either marked it, and different notes are both kept, separated by a blank line. Two devices editing the same habit's settings keep both versions, like a project. See [SYNC.md](SYNC.md).
