import { addDays, calendarDate } from '../projects/schedule'
import { daysBetween, today } from '../projects/model'

/**
 * Habits: routines checked off once a day, each day with an optional note ("Read chapter 3").
 * Check-ins are one record per habit per date, so the same day checked on two devices merges.
 * The native store, the sync server and `validateHabit`/`validateCheckin` share these limits.
 */
export type HabitFrequency =
  | { kind: 'daily' }
  /** ISO weekdays; Monday is 1. */
  | { kind: 'weekdays'; days: number[] }
  | { kind: 'weekly'; times: number }

export interface Habit {
  id: string
  name: string
  color: string
  frequency: HabitFrequency
  /** YYYY-MM-DD; streaks don't count days before it. */
  startDate: string
  archivedAt: number | null
  sort: number
  deletedAt: number | null
  created: number
  updated: number
  revision: number
}
export interface HabitCheckin {
  /** `<habit ID>_<YYYYMMDD>`; see `checkinId`. */
  id: string
  habitId: string
  date: string
  done: boolean
  note: string
  created: number
  updated: number
  revision: number
}
export interface HabitData {
  habits: Habit[]
  checkins: HabitCheckin[]
}

export const maxHabitName = 200
export const maxCheckinNote = 2_000
export const checkinId = (habitId: string, date: string) => `${habitId}_${date.replaceAll('-', '')}`

const weekdayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
export const weekdayLabel = (day: number) => weekdayNames[day - 1]
/** ISO weekday of a YYYY-MM-DD date; Monday is 1. */
export const weekdayOf = (date: string) => calendarDate(date).dayOfWeek
/** The Monday on or before a date. */
export const weekStart = (date: string) => addDays(date, 1 - weekdayOf(date))

export function formatFrequency(frequency: HabitFrequency) {
  switch (frequency.kind) {
    case 'daily':
      return 'Every day'
    case 'weekdays': {
      const days = [...frequency.days].sort((a, b) => a - b)
      if (days.join() === '1,2,3,4,5') return 'Weekdays'
      if (days.join() === '6,7') return 'Weekends'
      return days.map(weekdayLabel).join(', ')
    }
    case 'weekly':
      return frequency.times === 1 ? 'Once a week' : `${frequency.times} times a week`
  }
}

/** Whether a habit expects a check-in on a date. Weekly habits can be done on any day. */
export function isDue(habit: Pick<Habit, 'frequency' | 'startDate'>, date: string) {
  if (date < habit.startDate) return false
  return habit.frequency.kind !== 'weekdays' || habit.frequency.days.includes(weekdayOf(date))
}

const hexColor = /^#[0-9a-f]{6}$/i
const datePattern = /^\d{4}-\d{2}-\d{2}$/
const validDate = (date: string) => {
  if (!datePattern.test(date)) return false
  try {
    return calendarDate(date).toString() === date
  } catch {
    return false
  }
}

export function validateHabit(habit: Habit) {
  const name = habit.name.trim()
  const f = habit.frequency
  const frequency =
    f?.kind === 'daily' ||
    (f?.kind === 'weekdays' &&
      f.days.length > 0 &&
      new Set(f.days).size === f.days.length &&
      f.days.every((d) => Number.isInteger(d) && d >= 1 && d <= 7)) ||
    (f?.kind === 'weekly' && Number.isInteger(f.times) && f.times >= 1 && f.times <= 7)
  if (!/^[A-Za-z0-9_-]{1,119}$/.test(habit.id)) throw Error('Invalid habit ID.')
  if (!name || [...name].length > maxHabitName) throw Error('A habit needs a name of up to 200 characters.')
  if (!hexColor.test(habit.color)) throw Error('Invalid habit color.')
  if (!frequency) throw Error('Choose every day, at least one weekday, or 1 to 7 times a week.')
  if (!validDate(habit.startDate)) throw Error('Invalid habit start date.')
}
export function validateCheckin(checkin: Pick<HabitCheckin, 'date' | 'note'>) {
  if (!validDate(checkin.date)) throw Error('Invalid habit check-in.')
  if ([...checkin.note].length > maxCheckinNote) throw Error('A check-in note can be up to 2,000 characters.')
}

/** Done dates of one habit, from its start date on. */
export function doneDates(habit: Pick<Habit, 'id' | 'startDate'>, checkins: HabitCheckin[]) {
  return new Set(
    checkins
      .filter((c) => c.habitId === habit.id && c.done && c.date >= habit.startDate)
      .map((c) => c.date),
  )
}

export interface HabitStats {
  /** Days for daily and weekday habits, weeks for weekly ones. */
  unit: 'day' | 'week'
  current: number
  best: number
  total: number
  /** Weekly habits: check-ins this week. */
  thisWeek: number
}

/**
 * Streaks count due days (or, for weekly habits, weeks that met the target) in a row. Today, or
 * this week, extends a streak once done but never breaks it while there's still time.
 */
export function habitStats(habit: Habit, checkins: HabitCheckin[], current = today()): HabitStats {
  const done = doneDates(habit, checkins)
  const total = [...done].filter((date) => date <= current).length
  if (habit.frequency.kind === 'weekly') {
    const target = habit.frequency.times
    const count = (monday: string) => {
      let n = 0
      for (let i = 0; i < 7; i++) if (done.has(addDays(monday, i))) n++
      return n
    }
    const thisMonday = weekStart(current)
    const firstMonday = weekStart(habit.startDate)
    const met = (monday: string) => count(monday) >= target
    let streak = met(thisMonday) ? 1 : 0
    for (let monday = addDays(thisMonday, -7); monday >= firstMonday && met(monday); monday = addDays(monday, -7))
      streak++
    let best = 0
    let run = 0
    for (let monday = firstMonday; monday <= thisMonday; monday = addDays(monday, 7)) {
      run = met(monday) ? run + 1 : monday === thisMonday ? run : 0
      best = Math.max(best, run)
    }
    return { unit: 'week', current: streak, best: Math.max(best, streak), total, thisWeek: count(thisMonday) }
  }
  if (current < habit.startDate) return { unit: 'day', current: 0, best: 0, total, thisWeek: 0 }
  let streak = 0
  for (let date = current; date >= habit.startDate; date = addDays(date, -1)) {
    if (!isDue(habit, date)) continue
    if (done.has(date)) streak++
    else if (date !== current) break
  }
  let best = 0
  let run = 0
  const days = daysBetween(habit.startDate, current)
  for (let i = 0; i <= days; i++) {
    const date = addDays(habit.startDate, i)
    if (!isDue(habit, date)) continue
    if (done.has(date)) run++
    else if (date !== current) run = 0
    best = Math.max(best, run)
  }
  return { unit: 'day', current: streak, best, total, thisWeek: 0 }
}

/** Check-ins with a note, newest first: the habit's journal. */
export const habitNotes = (habit: Pick<Habit, 'id'>, checkins: HabitCheckin[]) =>
  checkins
    .filter((c) => c.habitId === habit.id && c.note.trim())
    .sort((a, b) => b.date.localeCompare(a.date))

export const liveHabits = (habits: Habit[]) =>
  habits.filter((h) => h.deletedAt === null).sort((a, b) => a.sort - b.sort || a.created - b.created)

export const formatStreak = (stats: Pick<HabitStats, 'current' | 'unit'>) =>
  `${stats.current} ${stats.unit}${stats.current === 1 ? '' : 's'}`
