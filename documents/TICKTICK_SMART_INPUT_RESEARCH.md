# TickTick smart input research

Research date: 3 November 2026. This is a description of TickTick and a set of possible design considerations for Stash, not an approved implementation plan.

## What the interaction does

TickTick's Smart Recognition reads scheduling language inside a task while the user types. It marks recognized words in the input and shows the interpreted date or time before the task is created. In the supplied example, `throw trash can @2pm` stays visible in the field, `@2pm` is highlighted in teal, and a calendar indicator at the right reads `Today, 14:00`. The user can review the result without opening a date picker.

TickTick calls the date feature Smart Date Parsing. Its [Smart Recognition guide](https://help.ticktick.com/articles/7081924556310446080) says that it recognizes dates and times during Quick Add and voice input, can set reminders, and has an option to remove recognized date text from the saved task title. Its [Add Tasks guide](https://help.ticktick.com/articles/7055782422935240704) says that clicking recognized time or pressing Delete can cancel recognition, and that Enter creates a task from the desktop list input.

### Observed on the Mac app

I used the TickTick desktop app on 3 November 2026. The original example was already in the user's Today input. I opened a separate File > Add Task window, tried the examples below without saving, then closed it. The original draft remained in place. The app's accessibility tree identified the marked text as links; this indicates recognition in the input, not proof of the final saved task fields.

| Text entered | Recognized text observed |
| --- | --- |
| `throw trash can @2pm` | `@2pm` |
| `Meet tomorrow at 9am` | `tomorrow` and `at 9am` |
| `Water plants every Monday at 9am` | `every Monday` and `at 9am` |
| `Call dentist in 2 hours` | `in 2 hours` |
| `Review report tomorrow at 3pm remind me 30 minutes earlier` | `tomorrow`, `at 3pm`, and `remind me 30 minutes earlier` |

Clicking the marked `tomorrow` in `Meet tomorrow at 9am` removed its recognition mark while the text remained; `at 9am` remained marked. The resulting saved date or reminder was not tested. The supplied screenshot and original draft show the `Today, 14:00` preview for `@2pm`; the other examples above were checked for recognition marks, not for their final parsed values.

## What TickTick documents

The [Smart Recognition guide](https://help.ticktick.com/articles/7081924556310446080) provides the following examples. These are examples, not a complete grammar, and results can depend on the current date, time, settings, language, and app version.

| Kind | Examples in the guide | Documented result |
| --- | --- | --- |
| Relative day | `today`, `tod`, `td`, `tomorrow`, `tmr` | Resolve to today or tomorrow. |
| Weekday | `Monday`, `next Monday` | Resolve a weekday using the guide's nearest-valid-date rule. |
| Date and time | `9am`, `9am - 10am`, `6 March, 9pm` | Recognize a time, time range, or date and time. |
| Repetition | `every day`, `every 2 days`, `every 2 weeks`, `every 2 months`, `every weekday`, `every weekend` | Set the corresponding repeating schedule. |
| Early reminder | `today at 3pm, remind 3 mins earlier` | The guide describes an on-time reminder and another reminder at the requested offset. It also describes a generic advance reminder as five minutes early. |
| Relative delay | `5 minutes later`, `1 hour 30 minutes later` | Set a reminder relative to the time of entry. |

The guide describes ambiguous dates as the most recent valid date and time. Its example is entering `9pm` at 4pm, which resolves to 9pm today. This example alone does not define every past-time, weekday, or time-zone edge case. Verify the preview rather than assuming a particular interpretation.

The source tables have apparent errors: the afternoon row says `1 am`, the evening row says `17 pm`, one January example lists March-like numeric variants, and a monthly last-day result is paired with a duplicate first-day input. Do not use these entries as exact rules without testing. The guide also includes a weekly example that resolves to Monday; its behavior in other contexts needs testing.

## Settings and controls

- TickTick's [Smart Recognition guide](https://help.ticktick.com/articles/7081924556310446080) directs desktop users to Avatar > Settings > Smart Recognition. Its [Add Tasks guide](https://help.ticktick.com/articles/7055782422935240704) identifies Settings > General > Smart Recognition > Smart Date Parsing as the control for turning date parsing off. Paths may vary by version.
- The guide says recognized date text can be kept in or removed from the task text. The exact saved-title behavior was not tested in this session.
- A due date and a reminder are related but distinct. TickTick also supports separately configured and multiple reminders, as described in its [reminder guide](https://help.ticktick.com/articles/7055782395743567872). A preview of a date alone does not establish the exact notifications that will fire.
- The desktop list input supports Enter to create a task. TickTick also documents Shift+Enter for a description and Command+Enter to create after entering one in the [Add Tasks guide](https://help.ticktick.com/articles/7055782422935240704).

## Considerations for Stash

These are possible design choices informed by the research, not claims about existing behavior or decisions to implement:

1. Keep the user's text editable, mark the recognized span, and show the interpreted value alongside it before saving. A user should be able to cancel a false match without losing the words they typed.
2. Treat a recognized span and the actual task field as related but separate states. Re-evaluate after edits, explain which value will be saved, and allow the user to correct or clear it.
3. Decide how explicit date-picker changes interact with text recognition, and whether recognized words remain in the saved title. Test the chosen behavior for keyboard input, paste, editing, and cancellation.
4. Use a clear reference clock and local time zone for relative phrases. Test boundaries such as a time that has already passed, midnight, month ends, leap days, and daylight-saving changes. Do not copy the article's ambiguous examples without checking them.
5. Stash's [projects and tasks document](PROJECTS_AND_TASKS.md) describes date-only task fields, excludes reminders and notifications, and reserves `@` for object mentions in notes. A TickTick-style time, reminder, or repeat feature would need separate product and data-model decisions; the note editor's `@` behavior should be considered separately from task creation input.

## Limits of this research

No task was submitted, so saved title removal, exact due time, repeat rule, notification timing, persistence, and sync were not verified. The app's parser, complete supported language set, offline behavior, and settings-dependent differences were not inspected. TickTick's AI voice mode is a separate feature; this research does not claim that the typed parser uses AI or any particular implementation technique.
