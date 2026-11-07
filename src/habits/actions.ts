import { newId } from '../projects/store'
import { today } from '../projects/model'
import { habitStore } from './store'
import { checkinId, type Habit, type HabitCheckin } from './model'

type Notify = (notice: { message: string; undo?: () => void }) => void

/** Saves report failures through the store's notice; callers don't need to handle them. */
const save = (changes: Parameters<typeof habitStore.save>[0]) =>
  habitStore.save(changes).catch((error) => console.error('Habit save failed', error))
const latest = (habit: Habit) => habitStore.getSnapshot().habits.find((h) => h.id === habit.id) ?? habit

export type HabitFields = Pick<Habit, 'name' | 'color' | 'frequency' | 'startDate'>

/** New habits go to the end of the list. */
export function createHabit(fields: HabitFields): Habit {
  const habits = habitStore.getSnapshot().habits
  const habit: Habit = {
    id: newId(),
    ...fields,
    name: fields.name.trim(),
    archivedAt: null,
    sort: Math.max(0, ...habits.map((h) => h.sort)) + 1,
    deletedAt: null,
    created: Date.now(),
    updated: Date.now(),
    revision: 0,
  }
  save({ habits: [habit] })
  return habit
}

export function updateHabit(habit: Habit, patch: Partial<Habit>) {
  save({ habits: [{ ...latest(habit), ...patch }] })
}

export function setHabitArchived(habit: Habit, archived: boolean) {
  updateHabit(habit, { archivedAt: archived ? Date.now() : null })
}

/** Deletion keeps the habit and its check-ins in storage, so Undo brings everything back. */
export function deleteHabit(habit: Habit, notify: Notify) {
  save({ habits: [{ ...latest(habit), deletedAt: Date.now() }] })
  notify({
    message: `Deleted “${habit.name}”.`,
    undo: () => save({ habits: [{ ...latest(habit), deletedAt: null }] }),
  })
}

export const checkinOf = (habitId: string, date: string) =>
  habitStore.getSnapshot().checkins.find((c) => c.id === checkinId(habitId, date))

/** Sets a day's done state and/or note, creating the check-in when needed. */
export function setCheckin(habit: Pick<Habit, 'id'>, date: string, patch: Partial<Pick<HabitCheckin, 'done' | 'note'>>) {
  if (date > today()) return
  const current = checkinOf(habit.id, date)
  const next: HabitCheckin = current
    ? { ...current, ...patch }
    : {
        id: checkinId(habit.id, date),
        habitId: habit.id,
        date,
        done: false,
        note: '',
        created: Date.now(),
        updated: Date.now(),
        revision: 0,
        ...patch,
      }
  if (current && current.done === next.done && current.note === next.note) return
  save({ checkins: [next] })
}
