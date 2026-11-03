import { Temporal } from '@js-temporal/polyfill'

/** Ranges use exclusive ends. Timed values are instants, never floating wall times. */
export type TaskSchedule =
  | { kind: 'allDay'; start: string; end: string }
  | { kind: 'point'; start: number; timeZone: string }
  | { kind: 'range'; start: number; end: number; timeZone: string }

const zoneListeners = new Set<() => void>()
export const deviceZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
export const displayZone = () => {
  try {
    const zone = localStorage.getItem('stash-calendar-zone')
    if (zone && !/^[+-]/.test(zone)) {
      new Intl.DateTimeFormat('en', { timeZone: zone })
      return zone
    }
  } catch {
    /* Use the device zone when settings are unavailable or invalid. */
  }
  return deviceZone()
}
export function setDisplayZone(zone: string) {
  if (zone) {
    if (/^[+-]/.test(zone)) throw Error('Enter a named time zone, such as Asia/Jakarta.')
    new Intl.DateTimeFormat('en', { timeZone: zone })
  }
  localStorage.setItem('stash-calendar-zone', zone)
  zoneListeners.forEach((listener) => listener())
}
export function subscribeDisplayZone(listener: () => void) {
  zoneListeners.add(listener)
  window.addEventListener('focus', listener)
  return () => {
    zoneListeners.delete(listener)
    window.removeEventListener('focus', listener)
  }
}
export const calendarDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '0001-01-01')
    throw Error('Enter a valid calendar date.')
  return Temporal.PlainDate.from(value, { overflow: 'reject' })
}
export const addDays = (date: string, days: number) => calendarDate(date).add({ days }).toString()
export const localTime = (instant: number, zone = displayZone()) =>
  Temporal.Instant.fromEpochMilliseconds(instant).toZonedDateTimeISO(zone)
export const dayAt = (instant: number, zone = displayZone()) =>
  localTime(instant, zone).toPlainDate().toString()
export const clockAt = (instant: number, zone = displayZone()) =>
  localTime(instant, zone).toPlainTime().toString({ smallestUnit: 'minute' })

/** Reject gaps. A repeated wall time requires the user's explicit offset choice. */
export function resolveWallTime(
  date: string,
  time: string,
  zone = displayZone(),
  choice?: 'earlier' | 'later',
) {
  calendarDate(date)
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw Error('Enter a time as HH:mm.')
  const wall = Temporal.PlainDateTime.from(`${date}T${time}`)
  const early = wall.toZonedDateTime(zone, { disambiguation: 'earlier' })
  const late = wall.toZonedDateTime(zone, { disambiguation: 'later' })
  if (!early.toPlainDateTime().equals(wall) || !late.toPlainDateTime().equals(wall))
    throw Error(
      `This time does not exist in ${zone} because the clocks change. Choose another time.`,
    )
  if (early.epochMilliseconds !== late.epochMilliseconds && !choice)
    throw Error(`This time occurs twice in ${zone}. Choose the earlier or later offset.`)
  return (choice === 'later' ? late : early).epochMilliseconds
}

export function validateSchedule(schedule: TaskSchedule | null | undefined) {
  if (!schedule) return
  if (schedule.kind === 'allDay') {
    calendarDate(schedule.start)
    calendarDate(schedule.end)
    if (schedule.end <= schedule.start)
      throw Error('The last day must be on or after the first day.')
  } else if (schedule.kind === 'point' || schedule.kind === 'range') {
    for (const instant of [schedule.start, ...(schedule.kind === 'range' ? [schedule.end] : [])]) {
      if (!Number.isSafeInteger(instant) || instant < -62135596800000 || instant > 253402300799999)
        throw Error('Choose a time between years 1 and 9999.')
    }
    if (
      typeof schedule.timeZone !== 'string' ||
      !schedule.timeZone ||
      schedule.timeZone.length > 100 ||
      /^[+-]/.test(schedule.timeZone)
    )
      throw Error('Choose a named time zone, such as Asia/Jakarta.')
    localTime(schedule.start, schedule.timeZone)
    if (schedule.kind === 'range' && schedule.end <= schedule.start)
      throw Error('The end must be after the start.')
  } else throw Error('Unknown schedule kind.')
}

export function scheduleDueDay(schedule: TaskSchedule, zone = displayZone()) {
  return schedule.kind === 'allDay'
    ? addDays(schedule.end, -1)
    : dayAt(schedule.kind === 'range' ? schedule.end - 1 : schedule.start, zone)
}

export type DueFields = {
  dueDate: string | null
  dueLinked?: boolean
  schedule?: TaskSchedule | null
}
export const effectiveDueDate = (task: DueFields, zone = displayZone()) =>
  task.dueLinked && task.schedule ? scheduleDueDay(task.schedule, zone) : task.dueDate

export function schedulePatch(
  task: DueFields & { dueTime?: string | null },
  schedule: TaskSchedule | null,
) {
  validateSchedule(schedule)
  if (!schedule)
    return {
      schedule: null,
      dueLinked: false,
      dueDate: effectiveDueDate(task),
      dueTime: task.schedule ? null : (task.dueTime ?? null),
    }
  const linked = task.schedule ? !!task.dueLinked : !task.dueDate
  return { schedule, dueLinked: linked, dueDate: linked ? null : task.dueDate, dueTime: null }
}

export function weekStart(date: string, firstDay = 1) {
  const day = calendarDate(date).dayOfWeek % 7
  return addDays(date, -((day - firstDay + 7) % 7))
}
