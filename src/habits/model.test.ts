import { expect, it } from 'vitest'
import {
  checkinId,
  formatFrequency,
  habitNotes,
  habitStats,
  isDue,
  validateCheckin,
  validateHabit,
  weekStart,
  type Habit,
  type HabitCheckin,
} from './model'

const habit = (fields: Partial<Habit> = {}): Habit => ({
  id: 'h',
  name: 'Read',
  color: '#3f9c2f',
  frequency: { kind: 'daily' },
  startDate: '2026-10-01',
  archivedAt: null,
  sort: 1,
  deletedAt: null,
  created: 0,
  updated: 0,
  revision: 1,
  ...fields,
})
const done = (dates: string[], note = '', habitId = 'h'): HabitCheckin[] =>
  dates.map((date) => ({
    id: checkinId(habitId, date),
    habitId,
    date,
    done: true,
    note,
    created: 0,
    updated: 0,
    revision: 1,
  }))

it('builds check-in IDs and describes frequencies', () => {
  expect(checkinId('abc-1', '2026-11-03')).toBe('abc-1_20261103')
  expect(formatFrequency({ kind: 'daily' })).toBe('Every day')
  expect(formatFrequency({ kind: 'weekdays', days: [5, 1, 2, 3, 4] })).toBe('Weekdays')
  expect(formatFrequency({ kind: 'weekdays', days: [6, 7] })).toBe('Weekends')
  expect(formatFrequency({ kind: 'weekdays', days: [3, 1] })).toBe('Mon, Wed')
  expect(formatFrequency({ kind: 'weekly', times: 1 })).toBe('Once a week')
  expect(formatFrequency({ kind: 'weekly', times: 3 })).toBe('3 times a week')
  expect(weekStart('2026-11-08')).toBe('2026-11-02')
  expect(weekStart('2026-11-02')).toBe('2026-11-02')
})

it('is due on chosen weekdays from the start date', () => {
  const h = habit({ frequency: { kind: 'weekdays', days: [1, 3] } })
  expect(isDue(h, '2026-11-02')).toBe(true) // Monday
  expect(isDue(h, '2026-11-03')).toBe(false)
  expect(isDue(h, '2026-11-04')).toBe(true)
  expect(isDue(habit({ startDate: '2026-11-05' }), '2026-11-04')).toBe(false)
})

it('counts daily streaks without breaking on today', () => {
  const h = habit()
  const checkins = done(['2026-11-01', '2026-11-02', '2026-11-04', '2026-11-05', '2026-11-06'])
  // Today (the 7th) isn't done yet, so the streak through yesterday stands.
  expect(habitStats(h, checkins, '2026-11-07')).toMatchObject({ unit: 'day', current: 3, best: 3, total: 5 })
  expect(habitStats(h, [...checkins, ...done(['2026-11-07'])], '2026-11-07').current).toBe(4)
  // A missed day before yesterday breaks it.
  expect(habitStats(h, checkins, '2026-11-08').current).toBe(0)
  // Days before the start date and future days don't count.
  expect(habitStats(habit({ startDate: '2026-11-05' }), checkins, '2026-11-07')).toMatchObject({ current: 2, total: 2 })
  expect(habitStats(h, done(['2026-11-09']), '2026-11-07').total).toBe(0)
})

it('skips days a weekday habit is not due', () => {
  const h = habit({ frequency: { kind: 'weekdays', days: [1, 3, 5] } })
  // Mon 2, Wed 4, Fri 6 done; Sat 7 isn't due.
  const checkins = done(['2026-10-30', '2026-11-02', '2026-11-04', '2026-11-06'])
  expect(habitStats(h, checkins, '2026-11-08').current).toBe(4)
  // Monday the 9th, not yet done, doesn't break it; Wednesday's absence on the 12th does.
  expect(habitStats(h, checkins, '2026-11-09').current).toBe(4)
  expect(habitStats(h, checkins, '2026-11-12').current).toBe(0)
  expect(habitStats(h, checkins, '2026-11-12').best).toBe(4)
})

it('counts weekly streaks in weeks that met the target', () => {
  const h = habit({ frequency: { kind: 'weekly', times: 2 }, startDate: '2026-10-19' })
  const checkins = done([
    '2026-10-20', '2026-10-22', // week of Oct 19: met
    '2026-10-27', '2026-10-30', // week of Oct 26: met
    '2026-11-03', // week of Nov 2: 1 of 2 so far
  ])
  expect(habitStats(h, checkins, '2026-11-05')).toMatchObject({ unit: 'week', current: 2, best: 2, thisWeek: 1 })
  expect(habitStats(h, [...checkins, ...done(['2026-11-05'])], '2026-11-05')).toMatchObject({ current: 3, best: 3, thisWeek: 2 })
  // The next week starting without the target met doesn't break it, but a missed full week does.
  expect(habitStats(h, checkins, '2026-11-10').current).toBe(0)
})

it('lists notes newest first', () => {
  const checkins = [
    ...done(['2026-11-01'], 'Read ABC, ch. 1'),
    ...done(['2026-11-02']),
    ...done(['2026-11-03'], 'Read ABC, ch. 2'),
    ...done(['2026-11-03'], 'Other habit', 'x'),
  ]
  expect(habitNotes(habit(), checkins).map((c) => c.note)).toEqual(['Read ABC, ch. 2', 'Read ABC, ch. 1'])
})

it('validates habits and check-ins like the native store', () => {
  expect(() => validateHabit(habit())).not.toThrow()
  for (const bad of [
    habit({ name: '  ' }),
    habit({ name: 'x'.repeat(201) }),
    habit({ color: 'green' }),
    habit({ frequency: { kind: 'weekdays', days: [] } }),
    habit({ frequency: { kind: 'weekdays', days: [1, 1] } }),
    habit({ frequency: { kind: 'weekly', times: 8 } }),
    habit({ startDate: '2026-02-30' }),
    habit({ id: 'x'.repeat(120) }),
  ])
    expect(() => validateHabit(bad)).toThrow()
  expect(() => validateCheckin({ date: '2026-11-03', note: 'Line\nline' })).not.toThrow()
  expect(() => validateCheckin({ date: '2026-11-03', note: 'x'.repeat(2001) })).toThrow(/2,000/)
  expect(() => validateCheckin({ date: '2026-13-01', note: '' })).toThrow()
})
