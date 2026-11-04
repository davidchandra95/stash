import { Temporal } from '@js-temporal/polyfill'
import { clockAt, dayAt, displayZone, effectiveDueDate } from './schedule'
import { type Task } from './model'

/**
 * Reminders are minutes before a task's moment. `null` means the default: at the moment itself.
 * An empty list turns them off. The operating system holds what is scheduled, so nothing here
 * tracks delivery: only future times are scheduled, and a snooze is a pending notification.
 */
export const defaultReminders = [0]
export const maxReminders = 5
/** Date-only tasks remind at this local time, with day-sized offsets. */
export const allDayReminderTime = '09:00'
/** macOS keeps at most this many pending notifications; Android uses the same limit. */
export const maxPending = 64

const timedOffsets = [0, 5, 15, 30, 60, 120, 1440, 2880, 10080]
const dayOffsets = [0, 1440, 2880, 10080]
const units = [
  [10080, 'week'],
  [1440, 'day'],
  [60, 'hour'],
  [1, 'minute'],
] as const
const amount = (minutes: number) => {
  const [size, unit] = units.find(([size]) => minutes % size === 0) ?? units[3]
  const count = minutes / size
  return `${count} ${unit}${count === 1 ? '' : 's'}`
}

export type ReminderTask = Pick<
  Task,
  'dueDate' | 'dueTime' | 'schedule' | 'dueLinked' | 'reminders'
>
export interface ReminderAnchor {
  at: number
  kind: 'schedule' | 'due' | 'day'
}
const wallTime = (date: string, time: string, zone: string) =>
  Temporal.PlainDateTime.from(`${date}T${time}`).toZonedDateTime(zone, {
    disambiguation: 'compatible',
  }).epochMilliseconds

/** The moment offsets count back from: work time, then due time, then the due day's morning. */
export function reminderAnchor(task: ReminderTask, zone = displayZone()): ReminderAnchor | null {
  const { schedule } = task
  if (schedule && schedule.kind !== 'allDay') return { at: schedule.start, kind: 'schedule' }
  const date = effectiveDueDate(task, zone) ?? (schedule ? schedule.start : null)
  if (!date) return null
  try {
    return task.dueTime && !task.dueLinked
      ? { at: wallTime(date, task.dueTime, zone), kind: 'due' }
      : { at: wallTime(date, allDayReminderTime, zone), kind: 'day' }
  } catch {
    // A malformed legacy value can't be scheduled; the task itself still shows it.
    return null
  }
}
export const taskReminders = (task: Pick<Task, 'reminders'>) => task.reminders ?? defaultReminders

/** The choices for this task, keeping any saved value a shorter list would hide. */
export function reminderChoices(task: ReminderTask, zone = displayZone()) {
  const base = reminderAnchor(task, zone)?.kind === 'day' ? dayOffsets : timedOffsets
  return [...new Set([...base, ...taskReminders(task)])].sort((a, b) => a - b)
}
export function reminderLabel(minutes: number, kind: ReminderAnchor['kind']) {
  if (minutes) return `${amount(minutes)} before`
  return kind === 'day' ? 'On the day' : kind === 'schedule' ? 'When it starts' : 'At due time'
}
export function reminderBody(minutes: number, kind: ReminderAnchor['kind']) {
  const verb = kind === 'schedule' ? 'Starts' : 'Due'
  if (minutes) return `${verb} in ${amount(minutes)}`
  return kind === 'day' ? 'Due today' : `${verb} now`
}
/** When a reminder goes off, for the task's detail row. */
export function reminderTime(at: number, now = Date.now(), zone = displayZone()) {
  const day = dayAt(at, zone)
  const date = Temporal.PlainDate.from(day)
  const today = dayAt(now, zone) === day
  const label = date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(day.slice(0, 4) === dayAt(now, zone).slice(0, 4) ? {} : { year: 'numeric' }),
  })
  return `${today ? 'Today' : label}, ${clockAt(at, zone)}`
}

const isOpen = (task: Pick<Task, 'status' | 'deletedAt'>) =>
  task.deletedAt === null && (task.status === 'todo' || task.status === 'doing')

export interface ReminderEntry {
  id: string
  title: string
  body: string
  fireAt: number
}
const taskPrefix = 'stash.task.'
const snoozePrefix = 'stash.snooze.'
/** Task IDs contain no dots. Native code rebuilds snooze IDs from the same fields. */
const reminderId = (taskId: string, minutes: number, anchor: number) =>
  `${taskPrefix}${taskId}.${minutes}.${anchor}`

/** Whether the task will still remind, for its indicator. */
export function hasUpcomingReminder(task: Task, now = Date.now(), zone = displayZone()) {
  if (!isOpen(task)) return false
  const anchor = reminderAnchor(task, zone)
  return !!anchor && taskReminders(task).some((minutes) => anchor.at - minutes * 60_000 > now)
}

/** The soonest future reminders. The rest are scheduled by a later sync as these go off. */
export function reminderEntries(
  tasks: Task[],
  now = Date.now(),
  limit = maxPending,
  zone = displayZone(),
): ReminderEntry[] {
  const entries: ReminderEntry[] = []
  for (const task of tasks) {
    if (!isOpen(task)) continue
    const anchor = reminderAnchor(task, zone)
    if (!anchor) continue
    for (const minutes of taskReminders(task)) {
      const fireAt = anchor.at - minutes * 60_000
      if (fireAt > now)
        entries.push({
          id: reminderId(task.id, minutes, anchor.at),
          title: task.title,
          body: reminderBody(minutes, anchor.kind),
          fireAt,
        })
    }
  }
  return entries.sort((a, b) => a.fireAt - b.fireAt).slice(0, Math.max(0, limit))
}

/** Pending reminders whose time has passed without delivery, for a task that has since changed. */
export function staleOverdue(ids: string[], tasks: Task[], now = Date.now(), zone = displayZone()) {
  return ids.filter((id) => {
    if (!id.startsWith(taskPrefix)) return false
    const [taskId, minutes, anchor] = id.slice(taskPrefix.length).split('.')
    if (Number(anchor) - Number(minutes) * 60_000 > now) return false
    const task = tasks.find((candidate) => candidate.id === taskId)
    return !(
      task &&
      isOpen(task) &&
      taskReminders(task).includes(Number(minutes)) &&
      reminderAnchor(task, zone)?.at === Number(anchor)
    )
  })
}

export interface Snooze {
  id: string
  taskId: string
  anchor: number
  until: number
}
export function parseSnooze(id: string): Snooze | null {
  if (!id.startsWith(snoozePrefix)) return null
  const [taskId, anchor, until] = id.slice(snoozePrefix.length).split('.')
  const parsed = { id, taskId, anchor: Number(anchor), until: Number(until) }
  return taskId && Number.isSafeInteger(parsed.anchor) && Number.isSafeInteger(parsed.until)
    ? parsed
    : null
}
/** A snooze ends early when its task is finished or moved, or its reminders are turned off. */
export function isCurrentSnooze(snooze: Snooze, tasks: Task[], zone = displayZone()) {
  const task = tasks.find((candidate) => candidate.id === snooze.taskId)
  return (
    !!task &&
    isOpen(task) &&
    taskReminders(task).length > 0 &&
    reminderAnchor(task, zone)?.at === snooze.anchor
  )
}

/** How far back Recent reminders looks. */
export const recentReminderDays = 7
export interface RecentReminder {
  id: string
  taskId: string
  title: string
  at: number
  label: string
}
/**
 * Reminder times that have passed for open tasks, newest first. These come from the tasks as
 * they are now, because the system can't report everything it delivered: this shows what was
 * due, and a finished or moved task leaves the list.
 */
export function recentReminders(tasks: Task[], now = Date.now(), zone = displayZone()) {
  const since = now - recentReminderDays * 86_400_000
  const recent: RecentReminder[] = []
  for (const task of tasks) {
    if (!isOpen(task)) continue
    const anchor = reminderAnchor(task, zone)
    if (!anchor) continue
    for (const minutes of taskReminders(task)) {
      const at = anchor.at - minutes * 60_000
      if (at <= now && at > since)
        recent.push({
          id: reminderId(task.id, minutes, anchor.at),
          taskId: task.id,
          title: task.title,
          at,
          label: reminderLabel(minutes, anchor.kind),
        })
    }
  }
  return recent.sort((a, b) => b.at - a.at || a.id.localeCompare(b.id))
}
/** When the next reminder goes off, so Recent reminders can update at that moment. */
export const nextReminderAt = (tasks: Task[], now = Date.now(), zone = displayZone()): number | null =>
  reminderEntries(tasks, now, 1, zone)[0]?.fireAt ?? null
