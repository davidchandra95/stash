import { Temporal } from '@js-temporal/polyfill'
import { addDays, calendarDate, dayAt, type TaskSchedule } from './schedule'

/**
 * How a task comes back once completed. `weekdays` are ISO numbers (Monday is 1) and only apply
 * to weekly repeats from the schedule. `monthDay` remembers a day that a shorter month clamped,
 * so a task on the 31st returns to the 31st after February.
 */
export interface TaskRepeat {
  unit: 'day' | 'week' | 'month' | 'year'
  interval: number
  weekdays?: number[]
  monthDay?: number
  from: 'schedule' | 'completion'
}
export const maxRepeatInterval = 99
export const weekdayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

export function validateRepeat(repeat: TaskRepeat | null | undefined) {
  if (!repeat) return
  const weekdays = repeat.weekdays ?? []
  if (
    !['day', 'week', 'month', 'year'].includes(repeat.unit) ||
    !['schedule', 'completion'].includes(repeat.from) ||
    !Number.isInteger(repeat.interval) ||
    repeat.interval < 1 ||
    repeat.interval > maxRepeatInterval ||
    new Set(weekdays).size !== weekdays.length ||
    weekdays.some((day) => !Number.isInteger(day) || day < 1 || day > 7) ||
    (weekdays.length > 0 && (repeat.unit !== 'week' || repeat.from !== 'schedule')) ||
    (repeat.monthDay !== undefined &&
      (!Number.isInteger(repeat.monthDay) ||
        repeat.monthDay < 1 ||
        repeat.monthDay > 31 ||
        (repeat.unit !== 'month' && repeat.unit !== 'year')))
  )
    throw Error('Invalid task repeat. Check the interval and weekdays.')
}

function onWeekdays(repeat: TaskRepeat, weekdays: number[], anchor: string, floor: string) {
  const start = calendarDate(anchor)
  const firstWeek = start.subtract({ days: start.dayOfWeek - 1 })
  for (let date = start.add({ days: 1 }); ; date = date.add({ days: 1 })) {
    const weeks = Math.floor(firstWeek.until(date).days / 7)
    if (weeks % repeat.interval === 0 && weekdays.includes(date.dayOfWeek) && date.toString() > floor)
      return date.toString()
  }
}

/**
 * The date a task returns to, and the rule to keep using. Repeats from the schedule stay on their
 * pattern and skip dates that have passed; repeats from completion count from `current`.
 */
export function nextOccurrence(
  repeat: TaskRepeat,
  anchor: string,
  current: string,
): { date: string; repeat: TaskRepeat } {
  if (repeat.from === 'completion') {
    const base = calendarDate(current)
    const next =
      repeat.unit === 'day'
        ? base.add({ days: repeat.interval })
        : repeat.unit === 'week'
          ? base.add({ weeks: repeat.interval })
          : repeat.unit === 'month'
            ? base.add({ months: repeat.interval })
            : base.add({ years: repeat.interval })
    const { monthDay: _unused, ...rule } = repeat
    return { date: next.toString(), repeat: rule }
  }
  const floor = anchor > current ? anchor : current
  if (repeat.unit === 'week' && repeat.weekdays?.length)
    return { date: onWeekdays(repeat, repeat.weekdays, anchor, floor), repeat }
  let date = calendarDate(anchor)
  if (repeat.unit === 'day' || repeat.unit === 'week') {
    const step = repeat.interval * (repeat.unit === 'week' ? 7 : 1)
    do date = date.add({ days: step })
    while (date.toString() <= floor)
    return { date: date.toString(), repeat }
  }
  // A remembered day applies only while the date is still its clamped form; a date moved by hand
  // sets a new day.
  const remembered =
    repeat.monthDay && Math.min(repeat.monthDay, date.daysInMonth) === date.day ? repeat.monthDay : null
  const day = remembered ?? date.day
  const months = repeat.interval * (repeat.unit === 'year' ? 12 : 1)
  do date = date.add({ months }).with({ day }, { overflow: 'constrain' })
  while (date.toString() <= floor)
  const { monthDay: _unused, ...rule } = repeat
  return { date: date.toString(), repeat: day > 28 ? { ...rule, monthDay: day } : rule }
}

/** The day a repeat counts from: the first work day, then the deadline. */
export const repeatAnchor = (task: { dueDate: string | null; schedule?: TaskSchedule | null }) => {
  const { schedule } = task
  if (!schedule) return task.dueDate
  return schedule.kind === 'allDay' ? schedule.start : dayAt(schedule.start, schedule.timeZone)
}

/** Moves a schedule by whole calendar days, keeping its wall-clock times in its own zone. */
export function shiftSchedule(schedule: TaskSchedule, days: number): TaskSchedule {
  if (schedule.kind === 'allDay')
    return { ...schedule, start: addDays(schedule.start, days), end: addDays(schedule.end, days) }
  const move = (instant: number) =>
    Temporal.Instant.fromEpochMilliseconds(instant)
      .toZonedDateTimeISO(schedule.timeZone)
      .add({ days }).epochMilliseconds
  return schedule.kind === 'range'
    ? { ...schedule, start: move(schedule.start), end: move(schedule.end) }
    : { ...schedule, start: move(schedule.start) }
}

const unitNames = { day: 'day', week: 'week', month: 'month', year: 'year' }
/** "Every 2 weeks on Monday, Friday" or "1 month after completion". */
export function formatRepeat(repeat: TaskRepeat) {
  const unit = `${unitNames[repeat.unit]}${repeat.interval === 1 ? '' : 's'}`
  if (repeat.from === 'completion') return `${repeat.interval} ${unit} after completion`
  const every = repeat.interval === 1 ? `Every ${unit}` : `Every ${repeat.interval} ${unit}`
  const days = [...(repeat.weekdays ?? [])].sort((a, b) => a - b).map((day) => weekdayNames[day - 1].slice(0, 3))
  return days.length ? `${every} on ${days.join(', ')}` : every
}
