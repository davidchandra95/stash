import AppTooltip from '../components/AppTooltip'
import { Bell, X } from '../icons'
import { updateTask } from './actions'
import { maxReminders, reminderAnchor, reminderChoices, reminderLabel, reminderTime, hasUpcomingReminder, taskReminders } from './reminders'
import {
  cancelSnooze,
  openReminderSettings,
  reminderStatusText,
  requestReminderPermission,
  useReminderState,
  type ReminderStatus,
} from './reminderService'
import type { Task } from './model'

/** Why reminders won't appear, with the one action that helps. Quiet when they will. */
export function ReminderPermission({ status }: { status: ReminderStatus }) {
  const text = reminderStatusText(status)
  if (!text) return null
  return (
    <div className="reminder-permission" role="status">
      <span>{text}</span>
      {status === 'notDetermined' && (
        <button type="button" className="btn btn-sm" onClick={() => void requestReminderPermission()}>
          Turn on
        </button>
      )}
      {status === 'denied' && (
        <button type="button" className="btn btn-sm" onClick={() => void openReminderSettings()}>
          Open Settings
        </button>
      )}
    </div>
  )
}

export default function TaskReminders({ task, disabled }: { task: Task; disabled: boolean }) {
  const { status, snoozes, error } = useReminderState()
  const anchor = reminderAnchor(task)
  if (!anchor)
    return <p className="field-help">Set a due date or work time to get reminders.</p>
  const chosen = [...taskReminders(task)].sort((a, b) => a - b)
  const save = (reminders: number[]) => updateTask(task, { reminders })
  const available = reminderChoices(task).filter((minutes) => !chosen.includes(minutes))
  const now = Date.now()
  const snoozed = snoozes.filter((snooze) => snooze.taskId === task.id && snooze.until > now)
  return (
    <div className="task-reminders">
      <ul className="task-reminder-list">
        {chosen.map((minutes) => {
          const at = anchor.at - minutes * 60_000
          const label = reminderLabel(minutes, anchor.kind)
          return (
            <li key={minutes} className={at <= now ? 'is-past' : undefined}>
              <span className="truncate">{label}</span>
              <span className="task-reminder-time">{reminderTime(at, now)}</span>
              <AppTooltip instant label={`Remove “${label}”`} disabled={disabled}>
                <button
                  type="button"
                  className="icon-btn-sm"
                  aria-label={`Remove reminder ${label}`}
                  disabled={disabled}
                  onClick={() => save(chosen.filter((value) => value !== minutes))}
                >
                  <X aria-hidden="true" />
                </button>
              </AppTooltip>
            </li>
          )
        })}
        {snoozed.map((snooze) => (
          <li key={snooze.id}>
            <span className="truncate">Snoozed</span>
            <span className="task-reminder-time">{reminderTime(snooze.until, now)}</span>
            <AppTooltip instant label="Cancel snooze" disabled={disabled}>
              <button
                type="button"
                className="icon-btn-sm"
                aria-label="Cancel snooze"
                disabled={disabled}
                onClick={() => void cancelSnooze(snooze.id)}
              >
                <X aria-hidden="true" />
              </button>
            </AppTooltip>
          </li>
        ))}
      </ul>
      {!chosen.length && <p className="field-help">No reminders for this task.</p>}
      {chosen.length < maxReminders && available.length > 0 && (
        <select
          className="field task-reminder-add"
          aria-label="Add reminder"
          value=""
          disabled={disabled}
          onChange={(event) => {
            save([...chosen, Number(event.target.value)].sort((a, b) => a - b))
            if (status === 'notDetermined') void requestReminderPermission()
          }}
        >
          <option value="" disabled>
            Add reminder
          </option>
          {available.map((minutes) => (
            <option key={minutes} value={minutes}>
              {reminderLabel(minutes, anchor.kind)}
            </option>
          ))}
        </select>
      )}
      {chosen.length > 0 && <ReminderPermission status={status} />}
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
    </div>
  )
}

/** The small bell on a task row or card when the task will still remind. */
export function ReminderMark({ task }: { task: Task }) {
  if (!hasUpcomingReminder(task)) return null
  return (
    <span className="task-reminder-mark" role="img" aria-label="Reminder set">
      <Bell aria-hidden="true" />
    </span>
  )
}
