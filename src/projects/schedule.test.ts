import { expect, it } from 'vitest'
import { previewProjectData } from './fixtures'
import {
  calendarItems,
  dayBounds,
  allDayBars,
  dragTop,
  isUnscheduled,
  movedStart,
  moveSchedule,
  planDrop,
  resizedSchedule,
  timedSegments,
} from './calendarLayout'
import {
  addDays,
  dayAt,
  effectiveDueDate,
  resolveWallTime,
  schedulePatch,
  validateSchedule,
  weekStart,
  type TaskSchedule,
} from './schedule'
import { scheduleDraft, scheduleFromDraft } from './ScheduleEditor'
import { dueState, todayGroups, upcomingGroups } from './model'

const task = (schedule: TaskSchedule | null = null) => ({
  ...previewProjectData().tasks[0],
  dueDate: null,
  dueTime: null,
  schedule,
  dueLinked: !!schedule,
})
const point = (date = '2026-11-03', time = '14:00', zone = 'Asia/Jakarta'): TaskSchedule => ({
  kind: 'point',
  start: resolveWallTime(date, time, zone),
  timeZone: zone,
})

it('uses calendar arithmetic at leap days, year boundaries and early years', () => {
  expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
  expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  expect(weekStart('2027-01-01')).toBe('2026-12-28')
  expect(weekStart('2027-01-01', 0)).toBe('2026-12-27')
  expect(addDays('0001-01-01', 1)).toBe('0001-01-02')
  expect(() => addDays('2026-02-29', 1)).toThrow()
})

it('rejects nonexistent times and requires a choice for repeated times', () => {
  expect(() => resolveWallTime('2026-03-08', '02:30', 'America/New_York')).toThrow('does not exist')
  expect(() => resolveWallTime('2026-11-01', '01:30', 'America/New_York')).toThrow('occurs twice')
  const early = resolveWallTime('2026-11-01', '01:30', 'America/New_York', 'earlier')
  const late = resolveWallTime('2026-11-01', '01:30', 'America/New_York', 'later')
  expect(late - early).toBe(3_600_000)
  expect(
    dayBounds('2026-03-08', 'America/New_York')[1] - dayBounds('2026-03-08', 'America/New_York')[0],
  ).toBe(23 * 3_600_000)
  expect(
    dayBounds('2026-11-01', 'America/New_York')[1] - dayBounds('2026-11-01', 'America/New_York')[0],
  ).toBe(25 * 3_600_000)
})

it('keeps points duration-free and derives linked days in the display zone', () => {
  const schedule = point('2026-11-03', '00:00')
  expect(schedule).not.toHaveProperty('end')
  expect(scheduleFromDraft(scheduleDraft(schedule))).toEqual(schedule)
  const record = task(schedule)
  expect(effectiveDueDate(record, 'Asia/Jakarta')).toBe('2026-11-03')
  expect(effectiveDueDate(record, 'America/Los_Angeles')).toBe('2026-11-02')
  expect(effectiveDueDate({ ...record, dueLinked: false, dueDate: '2026-11-09' }, 'UTC')).toBe(
    '2026-11-09',
  )
})

it('round-trips a range with different offsets within a repeated hour', () => {
  const zone = 'America/New_York'
  const schedule: TaskSchedule = {
    kind: 'range',
    timeZone: zone,
    start: resolveWallTime('2026-11-01', '01:45', zone, 'earlier'),
    end: resolveWallTime('2026-11-01', '01:15', zone, 'later'),
  }
  const draft = scheduleDraft(schedule)
  expect(draft).toMatchObject({ offset: 'earlier', endOffset: 'later' })
  expect(scheduleFromDraft(draft)).toEqual(schedule)
})

it('uses exclusive range ends for the linked deadline and preserves due when clearing', () => {
  const allDay: TaskSchedule = { kind: 'allDay', start: '2026-11-02', end: '2026-11-05' }
  expect(effectiveDueDate(task(allDay), 'UTC')).toBe('2026-11-04')
  expect(schedulePatch(task(allDay), null)).toMatchObject({
    schedule: null,
    dueLinked: false,
    dueDate: '2026-11-04',
  })
  const start = resolveWallTime('2026-11-02', '23:00', 'UTC')
  const end = resolveWallTime('2026-11-03', '00:00', 'UTC')
  expect(effectiveDueDate(task({ kind: 'range', start, end, timeZone: 'UTC' }), 'UTC')).toBe(
    '2026-11-02',
  )
  expect(schedulePatch(task(), point())).toMatchObject({ dueLinked: true, dueDate: null })
})

it('keeps independent deadlines and task start dates when scheduling', () => {
  const record = { ...task(), dueDate: '2026-12-01', startDate: '2026-10-01' }
  expect(schedulePatch(record, point())).toMatchObject({ dueLinked: false, dueDate: '2026-12-01' })
  expect(record.startDate).toBe('2026-10-01')
  // A deadline alone doesn't plan the work, so it can still be arranged.
  expect(isUnscheduled(record)).toBe(true)
  expect(isUnscheduled({ ...record, dueTime: '09:00' })).toBe(false)
  expect(isUnscheduled(task())).toBe(true)
  expect(isUnscheduled(task(point()))).toBe(false)
})

it('uses effective due dates in grouped task views and urgency', () => {
  const record = task({ kind: 'allDay', start: '2026-11-02', end: '2026-11-04' })
  expect(todayGroups([record], '2026-11-03')[0].tasks).toEqual([record])
  expect(upcomingGroups([record], '2026-11-02')[0].tasks).toEqual([record])
  expect(dueState(record, '2026-11-04')).toBe('late')
})

it('clips multi-day spans and renders separate deadlines only on uncovered days', () => {
  const record = {
    ...task({ kind: 'allDay', start: '2026-10-30', end: '2026-11-04' }),
    dueLinked: false,
    dueDate: '2026-11-04',
  }
  const items = calendarItems([record], ['2026-11-02', '2026-11-03', '2026-11-04'], 'UTC', true)
  expect(items.allDay.map((item) => [item.day, item.marker])).toEqual([
    ['2026-11-02', false],
    ['2026-11-03', false],
    ['2026-11-04', true],
  ])
  const inside = calendarItems([{ ...record, dueDate: '2026-11-03' }], ['2026-11-03'], 'UTC', true)
  expect(inside.allDay).toHaveLength(1)
})

it('splits timed ranges across midnight, keeps overlaps deterministic and leaves records intact', () => {
  const start = resolveWallTime('2026-11-02', '23:00', 'UTC')
  const record = task({ kind: 'range', start, end: start + 2 * 3_600_000, timeZone: 'UTC' })
  const other = { ...task(point('2026-11-03', '00:30', 'UTC')), id: 'other' }
  const items = calendarItems([record, other], ['2026-11-02', '2026-11-03'], 'UTC', true)
  expect(items.timed).toHaveLength(3)
  expect(items.timed.filter((item) => item.day === '2026-11-03').map((item) => item.lanes)).toEqual(
    [2, 2],
  )
  expect(
    calendarItems([other, record], ['2026-11-02', '2026-11-03'], 'UTC', true).timed.find(
      (item) => item.task.id === other.id,
    )?.lane,
  ).toBe(items.timed.find((item) => item.task.id === other.id)?.lane)
  expect(record.schedule).toEqual({
    kind: 'range',
    start,
    end: start + 2 * 3_600_000,
    timeZone: 'UTC',
  })
})

it('filters completed and cancelled tasks without hiding active ones', () => {
  const record = task(point())
  const done = { ...record, id: 'done', status: 'done' as const }
  const cancelled = { ...record, id: 'cancelled', status: 'cancelled' as const }
  expect(
    calendarItems([record, done, cancelled], ['2026-11-03'], 'Asia/Jakarta', false).timed,
  ).toHaveLength(1)
  expect(
    calendarItems([record, done, cancelled], ['2026-11-03'], 'Asia/Jakarta', true).timed,
  ).toHaveLength(2)
})

it('moves ranges without changing duration and converts points to floating all-day dates', () => {
  const start = resolveWallTime('2026-11-03', '23:00', 'Asia/Jakarta')
  const range: TaskSchedule = {
    kind: 'range',
    start,
    end: start + 7_200_000,
    timeZone: 'Asia/Jakarta',
  }
  const moved = moveSchedule(range, '2026-11-04', 570, 'Asia/Jakarta')
  expect(moved.kind).toBe('range')
  if (moved.kind === 'range') expect(moved.end - moved.start).toBe(7_200_000)
  expect(moveSchedule(point(), '2026-11-05', null, 'UTC')).toEqual({
    kind: 'allDay',
    start: '2026-11-05',
    end: '2026-11-06',
  })
  expect(dayAt(start, 'Asia/Jakarta')).toBe('2026-11-03')
})

it('validates ranges, dates, instants and named zones at the frontend boundary', () => {
  expect(() =>
    validateSchedule({ kind: 'allDay', start: '2026-11-04', end: '2026-11-03' }),
  ).toThrow()
  expect(() => validateSchedule({ kind: 'range', start: 1, end: 1, timeZone: 'UTC' })).toThrow()
  expect(() => validateSchedule({ kind: 'point', start: 1.1, timeZone: 'UTC' })).toThrow()
  expect(() => validateSchedule({ kind: 'point', start: 1, timeZone: '+07:00' })).toThrow()
  expect(() => validateSchedule({ kind: 'point', start: 1, timeZone: 'Not/A_Zone' })).toThrow()
})

it('moves a dragged block by where it was grabbed', () => {
  // Grabbed 70 minutes down: the pointer at 11:10 puts the top at 10:00.
  expect(dragTop(600, 70, 670, 0, 1440)).toBe(600)
  expect(dragTop(600, 70, 730, 0, 1440)).toBe(660)
  // A day-only move keeps an off-grid time; a real move snaps to the grid.
  expect(dragTop(847, 30, 880, 0, 1440)).toBe(847)
  expect(dragTop(847, 30, 940, 0, 1440)).toBe(915)
  // The top stays on the visible hours, and a late block isn't pulled up by a day-only move.
  expect(dragTop(600, 70, 80, 480, 1200)).toBe(480)
  expect(dragTop(1430, 2, 1432, 0, 1440)).toBe(1430)
})

it('keeps the real start when a later day of a multi-day block moves', () => {
  const zone = 'Asia/Jakarta'
  const start = resolveWallTime('2026-11-03', '23:00', zone)
  const range = { kind: 'range' as const, start, end: start + 3 * 3_600_000, timeZone: zone }
  expect(
    movedStart(range, { day: '2026-11-04', top: 0 }, { day: '2026-11-05', top: 0 }, zone),
  ).toEqual({ day: '2026-11-04', minute: 1380 })
  expect(
    movedStart(range, { day: '2026-11-03', top: 1380 }, { day: '2026-11-03', top: 1425 }, zone),
  ).toEqual({ day: '2026-11-03', minute: 1425 })
})

it('plans drops by what is dragged and where it lands', () => {
  const zone = 'Asia/Jakarta'
  const dated = { ...task(), dueDate: '2026-11-04' }
  const chip = { id: dated.id, marker: true }
  expect(planDrop(dated, chip, '2026-11-05', 960, zone)).toEqual({
    kind: 'timed',
    day: '2026-11-05',
    minute: 960,
  })
  expect(planDrop(dated, chip, '2026-11-05', null, zone)).toEqual({
    kind: 'deadline',
    day: '2026-11-05',
  })
  expect(planDrop({ ...dated, schedule: point() }, chip, '2026-11-05', 960, zone)).toEqual({
    kind: 'deadline',
    day: '2026-11-05',
  })
  const days = task({ kind: 'allDay', start: '2026-11-03', end: '2026-11-07' })
  const bar = { id: days.id, marker: false, sourceDay: '2026-11-04' }
  // Grabbed on its second day and dropped on Nov 6: two days later, on the grid or the row.
  for (const top of [null, 600])
    expect(planDrop(days, bar, '2026-11-06', top, zone)).toEqual({
      kind: 'allDay',
      start: '2026-11-05',
      end: '2026-11-09',
    })
  const one = task({ kind: 'allDay', start: '2026-11-03', end: '2026-11-04' })
  expect(planDrop(one, bar, '2026-11-06', 600, zone)).toEqual({
    kind: 'timed',
    day: '2026-11-06',
    minute: 600,
  })
})

it('keeps a minimum length when resizing', () => {
  const zone = 'Asia/Jakarta'
  const start = resolveWallTime('2026-11-03', '10:00', zone)
  const end = resolveWallTime('2026-11-03', '11:00', zone)
  const range: TaskSchedule = { kind: 'range', start, end, timeZone: zone }
  expect(resizedSchedule(range, 'end', '2026-11-03', 480, zone)).toMatchObject({
    start,
    end: start + 900_000,
  })
  expect(resizedSchedule(range, 'start', '2026-11-03', 720, zone)).toMatchObject({
    start: end - 900_000,
    end,
  })
  expect(resizedSchedule(range, 'end', '2026-11-03', 1440, zone)).toMatchObject({
    end: resolveWallTime('2026-11-04', '00:00', zone),
  })
  // A point gains an end by dragging its bottom edge.
  expect(
    resizedSchedule(point('2026-11-03', '10:00'), 'end', '2026-11-03', 720, zone),
  ).toMatchObject({ kind: 'range', start, end: resolveWallTime('2026-11-03', '12:00', zone) })
  const allDay: TaskSchedule = { kind: 'allDay', start: '2026-11-03', end: '2026-11-06' }
  expect(resizedSchedule(allDay, 'end', '2026-11-01', null, zone)).toMatchObject({
    end: '2026-11-04',
  })
  expect(resizedSchedule(allDay, 'start', '2026-11-09', null, zone)).toMatchObject({
    start: '2026-11-05',
  })
})

it('joins all-day days into bars and splits timed stretches by day', () => {
  const days = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05']
  const items = calendarItems(
    [task({ kind: 'allDay', start: '2026-11-01', end: '2026-11-05' })],
    days,
    'UTC',
    true,
  ).allDay
  expect(allDayBars(items, days).map(({ from, span }) => [from, span])).toEqual([[0, 3]])
  expect(timedSegments('2026-11-02', 1380, 120, days, 480, 1440)).toEqual([
    { day: '2026-11-02', start: 1380, end: 1440 },
  ])
  expect(timedSegments('2026-11-02', 1380, 600, days, 0, 1440)).toEqual([
    { day: '2026-11-02', start: 1380, end: 1440 },
    { day: '2026-11-03', start: 0, end: 540 },
  ])
  expect(timedSegments('2026-11-09', 600, 60, days, 0, 1440)).toEqual([])
})
