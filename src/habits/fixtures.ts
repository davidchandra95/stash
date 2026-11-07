import { today } from '../projects/model'
import { addDays } from '../projects/schedule'
import { checkinId, weekdayOf, type Habit, type HabitCheckin, type HabitData } from './model'

/** Fictional session-only habits for the browser preview. Dates follow today. */
export function previewHabitData(now = new Date()): HabitData {
  const current = today(now)
  const at = now.getTime()
  const habit = (fields: Pick<Habit, 'id' | 'name' | 'color' | 'frequency' | 'sort'>): Habit => ({
    startDate: addDays(current, -30),
    archivedAt: null,
    deletedAt: null,
    created: at,
    updated: at,
    revision: 1,
    ...fields,
  })
  const checkin = (habitId: string, daysAgo: number, note = ''): HabitCheckin => {
    const date = addDays(current, -daysAgo)
    return { id: checkinId(habitId, date), habitId, date, done: true, note, created: at, updated: at, revision: 1 }
  }
  const read = 'preview-habit-read'
  const walk = 'preview-habit-walk'
  const strength = 'preview-habit-strength'
  return {
    habits: [
      habit({ id: read, name: 'Read a book', color: '#428e8e', frequency: { kind: 'daily' }, sort: 1 }),
      habit({ id: walk, name: 'Morning walk', color: '#688b60', frequency: { kind: 'weekdays', days: [1, 3, 5] }, sort: 2 }),
      habit({ id: strength, name: 'Strength training', color: '#8b75a5', frequency: { kind: 'weekly', times: 3 }, sort: 3 }),
    ],
    checkins: [
      checkin(read, 1, 'The Lighthouse Keeper, chapters 4–5'),
      checkin(read, 2, 'The Lighthouse Keeper, chapter 3'),
      checkin(read, 3),
      checkin(read, 4, 'Started The Lighthouse Keeper'),
      checkin(read, 6),
      // Every Monday, Wednesday and Friday of the past two weeks but the oldest.
      ...Array.from({ length: 13 }, (_, i) => i + 1)
        .filter((days) => [1, 3, 5].includes(weekdayOf(addDays(current, -days))))
        .slice(0, -1)
        .map((days) => checkin(walk, days)),
      checkin(strength, 1, 'Squats and rows'),
      checkin(strength, 3),
      checkin(strength, 8),
      checkin(strength, 10),
      checkin(strength, 12),
    ],
  }
}
