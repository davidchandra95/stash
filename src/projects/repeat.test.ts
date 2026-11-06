import { expect, it } from 'vitest'
import { formatRepeat, nextOccurrence, shiftSchedule, validateRepeat, type TaskRepeat } from './repeat'

const rule = (fields: Partial<TaskRepeat>): TaskRepeat => ({
  unit: 'day',
  interval: 1,
  from: 'schedule',
  ...fields,
})
const next = (fields: Partial<TaskRepeat>, anchor: string, current = anchor) =>
  nextOccurrence(rule(fields), anchor, current).date

it('repeats daily and weekly from the scheduled date', () => {
  expect(next({}, '2026-11-04')).toBe('2026-11-05')
  expect(next({ interval: 3 }, '2026-11-04')).toBe('2026-11-07')
  expect(next({ unit: 'week' }, '2026-11-04')).toBe('2026-11-11')
})

it('completing early moves one step past the scheduled date', () => {
  expect(next({ unit: 'week' }, '2026-11-16', '2026-11-04')).toBe('2026-11-23')
})

it('skips occurrences that have already passed', () => {
  expect(next({ unit: 'week' }, '2026-10-05', '2026-11-04')).toBe('2026-11-09')
  expect(next({ unit: 'month' }, '2026-08-15', '2026-11-04')).toBe('2026-11-15')
})

it('uses the next selected weekday, respecting the week interval', () => {
  // 2026-11-02 is a Monday.
  expect(next({ unit: 'week', weekdays: [1, 5] }, '2026-11-02')).toBe('2026-11-06')
  expect(next({ unit: 'week', weekdays: [1, 5] }, '2026-11-06')).toBe('2026-11-09')
  expect(next({ unit: 'week', weekdays: [1, 5], interval: 2 }, '2026-11-06')).toBe('2026-11-16')
  // Sunday ends the ISO week the anchor belongs to.
  expect(next({ unit: 'week', weekdays: [7], interval: 2 }, '2026-11-02')).toBe('2026-11-08')
})

it('keeps a month-end day through shorter months', () => {
  const first = nextOccurrence(rule({ unit: 'month' }), '2027-01-31', '2027-01-31')
  expect(first.date).toBe('2027-02-28')
  expect(first.repeat.monthDay).toBe(31)
  const second = nextOccurrence(first.repeat, first.date, first.date)
  expect(second.date).toBe('2027-03-31')
})

it('takes a new day when the date was moved by hand', () => {
  const moved = nextOccurrence(rule({ unit: 'month', monthDay: 31 }), '2027-02-15', '2027-02-15')
  expect(moved.date).toBe('2027-03-15')
  expect(moved.repeat.monthDay).toBeUndefined()
})

it('keeps leap day on yearly repeats', () => {
  const first = nextOccurrence(rule({ unit: 'year' }), '2028-02-29', '2028-02-29')
  expect(first.date).toBe('2029-02-28')
  expect(next({ unit: 'year', monthDay: 29, interval: 3 }, '2029-02-28')).toBe('2032-02-29')
})

it('counts from the completion day when repeating after completion', () => {
  const after = { from: 'completion' as const }
  expect(next({ ...after, interval: 3 }, '2026-11-01', '2026-11-04')).toBe('2026-11-07')
  expect(next({ ...after, unit: 'week' }, '2026-12-25', '2026-11-04')).toBe('2026-11-11')
  expect(next({ ...after, unit: 'month' }, '2026-01-01', '2027-01-31')).toBe('2027-02-28')
  expect(nextOccurrence(rule({ ...after, unit: 'month', monthDay: 31 }), '2027-01-31', '2027-01-31').repeat.monthDay).toBeUndefined()
})

it('shifts schedules by calendar days, keeping the wall clock across daylight saving', () => {
  expect(shiftSchedule({ kind: 'allDay', start: '2026-11-02', end: '2026-11-05' }, 7)).toEqual({
    kind: 'allDay',
    start: '2026-11-09',
    end: '2026-11-12',
  })
  const zone = 'America/New_York'
  // 09:00 on Oct 31 is EDT; a week later 09:00 is EST, one elapsed hour more than 7 × 24.
  const start = Date.parse('2026-10-31T13:00:00Z')
  expect(shiftSchedule({ kind: 'point', start, timeZone: zone }, 7)).toEqual({
    kind: 'point',
    start: Date.parse('2026-11-07T14:00:00Z'),
    timeZone: zone,
  })
  const end = Date.parse('2026-10-31T14:30:00Z')
  expect(shiftSchedule({ kind: 'range', start, end, timeZone: zone }, 7)).toMatchObject({
    end: Date.parse('2026-11-07T15:30:00Z'),
  })
})

it('describes rules', () => {
  expect(formatRepeat(rule({}))).toBe('Every day')
  expect(formatRepeat(rule({ unit: 'week', interval: 2, weekdays: [5, 1] }))).toBe(
    'Every 2 weeks on Mon, Fri',
  )
  expect(formatRepeat(rule({ unit: 'month', interval: 1, from: 'completion' }))).toBe(
    '1 month after completion',
  )
})

it('rejects invalid rules', () => {
  expect(() => validateRepeat(null)).not.toThrow()
  for (const invalid of [
    { interval: 0 },
    { interval: 100 },
    { interval: 1.5 },
    { unit: 'fortnight' as TaskRepeat['unit'] },
    { unit: 'week' as const, weekdays: [8] },
    { unit: 'week' as const, weekdays: [1, 1] },
    { weekdays: [1] },
    { unit: 'week' as const, weekdays: [1], from: 'completion' as const },
    { monthDay: 3 },
    { unit: 'month' as const, monthDay: 32 },
  ])
    expect(() => validateRepeat(rule(invalid)), JSON.stringify(invalid)).toThrow()
})
