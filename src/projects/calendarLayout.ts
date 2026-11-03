import type { Task } from './model'
import {
  addDays,
  calendarDate,
  clockAt,
  dayAt,
  effectiveDueDate,
  localTime,
  resolveWallTime,
  type TaskSchedule,
} from './schedule'

export interface CalendarItem {
  task: Task
  day: string
  marker: boolean
  start: number
  end: number
  lane: number
  lanes: number
  label: string
}
export const minuteAt = (instant: number, zone: string) => {
  const local = localTime(instant, zone)
  return local.hour * 60 + local.minute + local.second / 60
}
export const dayBounds = (day: string, zone: string) =>
  [
    calendarDate(day).toZonedDateTime(zone).epochMilliseconds,
    calendarDate(addDays(day, 1)).toZonedDateTime(zone).epochMilliseconds,
  ] as const

/** Legacy wall-clock deadlines keep their old floating semantics until explicitly edited. */
export function calendarSchedule(task: Task, zone: string): TaskSchedule | null {
  if (task.schedule) return task.schedule
  if (task.dueDate && task.dueTime) {
    try {
      return {
        kind: 'point',
        start: resolveWallTime(task.dueDate, task.dueTime, zone),
        timeZone: zone,
      }
    } catch {
      /* Keep an unresolvable legacy deadline visible in the all-day area. */
    }
  }
  return null
}

export function calendarItems(
  tasks: Task[],
  days: string[],
  zone: string,
  showCompleted: boolean,
  minimumMinutes = 15,
) {
  const allDay: CalendarItem[] = []
  const timed: CalendarItem[] = []
  const boundaries = new Map(days.map((day) => [day, dayBounds(day, zone)]))
  for (const task of tasks) {
    if (
      task.deletedAt !== null ||
      task.status === 'cancelled' ||
      (!showCompleted && task.status === 'done')
    )
      continue
    const schedule = calendarSchedule(task, zone)
    const due = effectiveDueDate(task, zone)
    for (const day of days) {
      const base = { task, day, marker: false, start: 0, end: 0, lane: 0, lanes: 1, label: '' }
      let covered = false
      if (schedule?.kind === 'allDay' && day >= schedule.start && day < schedule.end) {
        allDay.push({ ...base, label: `${schedule.start} to ${addDays(schedule.end, -1)}` })
        covered = true
      } else if (schedule && schedule.kind !== 'allDay') {
        const [from, until] = boundaries.get(day)!
        const end = schedule.kind === 'range' ? schedule.end : schedule.start + 1
        if (schedule.start < until && end > from) {
          const startMinute = schedule.start < from ? 0 : minuteAt(schedule.start, zone)
          const endMinute = end >= until ? 1440 : minuteAt(end, zone)
          timed.push({
            ...base,
            start: startMinute,
            end: Math.min(1440, Math.max(startMinute + minimumMinutes, endMinute)),
            label: `${clockAt(schedule.start, zone)}${schedule.kind === 'range' ? ` to ${clockAt(schedule.end, zone)}` : ''} (${localTime(schedule.start, zone).offset})`,
          })
          covered = true
        }
      }
      if (day === due && !covered)
        allDay.push({
          ...base,
          marker: true,
          label: `Due ${day}${task.dueTime ? ` at ${task.dueTime}` : ''}`,
        })
    }
  }
  // A multi-day all-day block stays in the same row across every visible day.
  const spans = new Map<string, CalendarItem[]>()
  for (const item of allDay) {
    const key = `${item.task.id}:${item.marker}`
    const span = spans.get(key) ?? []
    span.push(item)
    spans.set(key, span)
  }
  const rows: Set<string>[] = []
  for (const span of [...spans.values()].sort(
    (a, b) =>
      b.length - a.length ||
      a[0].day.localeCompare(b[0].day) ||
      a[0].task.id.localeCompare(b[0].task.id),
  )) {
    let lane = rows.findIndex((days) => span.every((item) => !days.has(item.day)))
    if (lane < 0) {
      lane = rows.length
      rows.push(new Set())
    }
    for (const item of span) {
      rows[lane].add(item.day)
      item.lane = lane
    }
  }
  // Allocate lanes within each connected overlap group, with stable ordering.
  for (const day of days) {
    const items = timed
      .filter((item) => item.day === day)
      .sort((a, b) => a.start - b.start || b.end - a.end || a.task.id.localeCompare(b.task.id))
    let group: CalendarItem[] = []
    let ends: number[] = []
    let groupEnd = -1
    const finish = () =>
      group.forEach((item) => {
        item.lanes = ends.length
      })
    for (const item of items) {
      if (item.start >= groupEnd) {
        finish()
        group = []
        ends = []
      }
      let lane = ends.findIndex((end) => end <= item.start)
      if (lane === -1) lane = ends.length
      ends[lane] = item.end
      item.lane = lane
      group.push(item)
      groupEnd = Math.max(...ends)
    }
    finish()
  }
  return { allDay, timed }
}

export function moveSchedule(
  schedule: TaskSchedule | null,
  day: string,
  minute: number | null,
  zone: string,
): TaskSchedule {
  if (minute === null) {
    const duration =
      schedule?.kind === 'allDay'
        ? calendarDate(schedule.start).until(calendarDate(schedule.end)).days
        : 1
    return { kind: 'allDay', start: day, end: addDays(day, duration) }
  }
  const time = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
  const start = resolveWallTime(day, time, zone)
  return schedule?.kind === 'range'
    ? { ...schedule, start, end: start + schedule.end - schedule.start, timeZone: zone }
    : { kind: 'point', start, timeZone: zone }
}

export const isUnscheduled = (task: Task) =>
  task.deletedAt === null &&
  (task.status === 'todo' || task.status === 'doing') &&
  !task.schedule &&
  !effectiveDueDate(task)
