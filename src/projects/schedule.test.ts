import { expect, it } from 'vitest'
import { previewProjectData } from './fixtures'
import { calendarItems, dayBounds, isUnscheduled, moveSchedule } from './calendarLayout'
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
  expect(isUnscheduled(record)).toBe(false)
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
