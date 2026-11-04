import type { Task } from './model'
import {
  addDays,
  calendarDate,
  clockAt,
  dayAt,
  effectiveDueDate,
  localTime,
  resolveWallTime,
  weekStart,
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
  /** Full description for tooltips and screen readers. */
  label: string
  /** Short visible time, such as 09:00–10:30. */
  clock: string
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
      const base = {
        task,
        day,
        marker: false,
        start: 0,
        end: 0,
        lane: 0,
        lanes: 1,
        label: '',
        clock: '',
      }
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
            // A point has no length of its own, so it fills the half-hour cell it starts in.
            end: Math.min(
              1440,
              Math.max(
                startMinute + minimumMinutes,
                schedule.kind === 'point' ? startMinute + 30 : endMinute,
              ),
            ),
            label: `${clockAt(schedule.start, zone)}${schedule.kind === 'range' ? ` to ${clockAt(schedule.end, zone)}` : ''} (${localTime(schedule.start, zone).offset})`,
            clock: clockAt(schedule.start, zone),
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

/** Open work with no time on the calendar. A deadline alone doesn't plan when to do it. */
export const isUnscheduled = (task: Task) =>
  task.deletedAt === null &&
  (task.status === 'todo' || task.status === 'doing') &&
  !task.schedule &&
  !(task.dueDate && task.dueTime)

const snapMinutes = 15

/**
 * Where a dragged block's top lands, given how far down it was grabbed. A move of less than half
 * a snap keeps the exact time, so changing only the day never changes the time.
 */
export function dragTop(
  top: number,
  grabOffset: number,
  pointer: number,
  firstMinute: number,
  lastMinute: number,
) {
  const next = pointer - grabOffset
  if (Math.abs(next - top) < snapMinutes / 2) return top
  const snapped = Math.round(next / snapMinutes) * snapMinutes
  return Math.max(firstMinute, Math.min(lastMinute - snapMinutes, snapped))
}

/** The new start of a block moved between days, including a later day of a multi-day block. */
export function movedStart(
  schedule: Extract<TaskSchedule, { kind: 'point' | 'range' }>,
  from: { day: string; top: number },
  to: { day: string; top: number },
  zone: string,
) {
  const minute = Math.floor(minuteAt(schedule.start, zone) + to.top - from.top)
  const days = calendarDate(from.day).until(calendarDate(to.day)).days
  return {
    day: addDays(dayAt(schedule.start, zone), days + Math.floor(minute / 1440)),
    minute: ((minute % 1440) + 1440) % 1440,
  }
}

/** One bar per all-day task, spanning the visible days it covers. */
export function allDayBars(items: CalendarItem[], days: string[]) {
  const bars = new Map<string, { item: CalendarItem; from: number; span: number }>()
  for (const item of items) {
    const key = `${item.task.id}:${item.marker}`
    const index = days.indexOf(item.day)
    const bar = bars.get(key)
    if (bar) bar.span = index - bar.from + 1
    else bars.set(key, { item, from: index, span: 1 })
  }
  return [...bars.values()]
}

/** The visible parts of a stretch of time, one per day. */
export function timedSegments(
  day: string,
  minute: number,
  minutes: number,
  days: string[],
  firstMinute: number,
  lastMinute: number,
) {
  const segments: { day: string; start: number; end: number }[] = []
  let start = minute
  let remaining = minutes
  for (let current = day; remaining > 0 && current <= days.at(-1)!; current = addDays(current, 1)) {
    const end = Math.min(1440, start + remaining)
    if (days.includes(current) && end > firstMinute && start < lastMinute)
      segments.push({
        day: current,
        start: Math.max(start, firstMinute),
        end: Math.min(end, lastMinute),
      })
    remaining -= end - start
    start = 0
  }
  return segments
}

export interface DragData {
  id: string
  marker: boolean
  sourceDay?: string
  /** Set for a block dragged from the time grid: its top, and how far down it was grabbed. */
  block?: { top: number; grabOffset: number }
}
export type DropPlan =
  | { kind: 'deadline'; day: string }
  | { kind: 'allDay'; start: string; end: string }
  | { kind: 'timed'; day: string; minute: number }

/** What a drop does. The drag preview and the save both follow this. */
export function planDrop(
  task: Task,
  data: DragData,
  day: string,
  top: number | null,
  zone: string,
): DropPlan {
  // A deadline chip moves the deadline, unless it lands on the grid with no work time yet.
  if (data.marker && (top === null || task.schedule)) return { kind: 'deadline', day }
  const schedule = data.marker ? null : calendarSchedule(task, zone)
  if (schedule?.kind === 'allDay') {
    const length = calendarDate(schedule.start).until(calendarDate(schedule.end)).days
    // Several days of work stay all-day; only a single day can become a timed block.
    if (top === null || length > 1) {
      const shift = data.sourceDay ? calendarDate(data.sourceDay).until(calendarDate(day)).days : 0
      const start = data.sourceDay ? addDays(schedule.start, shift) : day
      return { kind: 'allDay', start, end: addDays(start, length) }
    }
  }
  if (top === null) return { kind: 'allDay', start: day, end: addDays(day, 1) }
  if (schedule && schedule.kind !== 'allDay' && data.block && data.sourceDay)
    return {
      kind: 'timed',
      ...movedStart(schedule, { day: data.sourceDay, top: data.block.top }, { day, top }, zone),
    }
  return { kind: 'timed', day, minute: top }
}

export const minimumBlockMinutes = 15

/** A resize follows the pointer, but the block always keeps a minimum length. */
export function resizedSchedule(
  schedule: TaskSchedule,
  edge: 'start' | 'end',
  day: string,
  minute: number | null,
  zone: string,
): TaskSchedule {
  if (schedule.kind === 'allDay') {
    if (edge === 'end') {
      const end = addDays(day, 1)
      return { ...schedule, end: end > schedule.start ? end : addDays(schedule.start, 1) }
    }
    const last = addDays(schedule.end, -1)
    return { ...schedule, start: day < last ? day : last }
  }
  const moved = moveSchedule(
    null,
    minute === 1440 ? addDays(day, 1) : day,
    minute === null ? 0 : minute % 1440,
    zone,
  )
  if (moved.kind !== 'point') return schedule
  const gap = minimumBlockMinutes * 60_000
  if (edge === 'end')
    return {
      kind: 'range',
      start: schedule.start,
      end: Math.max(moved.start, schedule.start + gap),
      timeZone: schedule.timeZone,
    }
  if (schedule.kind !== 'range') return schedule
  return { ...schedule, start: Math.min(moved.start, schedule.end - gap) }
}

export type CalendarView = 'day' | 'week' | 'month' | 'year' | 'agenda' | 'days' | 'weeks'
export interface CalendarSpans {
  days: number
  weeks: number
}
const agendaDays = 30
const dayList = (first: string, length: number) =>
  Array.from({ length }, (_, i) => addDays(first, i))

/** Every day a view shows. Month keeps whole weeks, so it can start and end in other months. */
export function viewDays(view: CalendarView, date: string, firstDay: number, spans: CalendarSpans) {
  const value = calendarDate(date)
  switch (view) {
    case 'day':
      return [date]
    case 'days':
      return dayList(date, spans.days)
    case 'week':
      return dayList(weekStart(date, firstDay), 7)
    case 'weeks':
      return dayList(weekStart(date, firstDay), spans.weeks * 7)
    case 'agenda':
      return dayList(date, agendaDays)
    case 'year':
      return dayList(value.with({ month: 1, day: 1 }).toString(), value.daysInYear)
    case 'month': {
      const first = weekStart(value.with({ day: 1 }).toString(), firstDay)
      const last = weekStart(value.with({ day: value.daysInMonth }).toString(), firstDay)
      return dayList(first, calendarDate(first).until(calendarDate(last)).days + 7)
    }
  }
}

/** The date one period before or after, for the view's arrows. */
export function shiftedDate(
  view: CalendarView,
  date: string,
  firstDay: number,
  spans: CalendarSpans,
  amount: number,
) {
  const value = calendarDate(date)
  switch (view) {
    case 'month':
      return value.with({ day: 1 }).add({ months: amount }).toString()
    case 'year':
      return value.with({ month: 1, day: 1 }).add({ years: amount }).toString()
    case 'day':
      return addDays(date, amount)
    case 'days':
      return addDays(date, amount * spans.days)
    case 'agenda':
      return addDays(date, amount * agendaDays)
    case 'week':
      return addDays(weekStart(date, firstDay), amount * 7)
    case 'weeks':
      return addDays(weekStart(date, firstDay), amount * spans.weeks * 7)
  }
}

export interface BoardPlacement {
  item: CalendarItem
  from: number
  span: number
  row: number
}
/** One week of a month grid: all-day bars keep their rows, and timed tasks fill in below. */
export function boardPlacements(allDay: CalendarItem[], timed: CalendarItem[], week: string[]) {
  const taken = week.map(() => new Set<number>())
  const placements: BoardPlacement[] = allDayBars(allDay, week).map(({ item, from, span }) => {
    for (let i = from; i < from + span; i++) taken[i].add(item.lane)
    return { item, from, span, row: item.lane }
  })
  for (const item of [...timed].sort((a, b) => a.start - b.start)) {
    const from = week.indexOf(item.day)
    let row = 0
    while (taken[from].has(row)) row++
    taken[from].add(row)
    placements.push({ item, from, span: 1, row })
  }
  return { placements, rows: Math.max(0, ...placements.map((p) => p.row + 1)) }
}
