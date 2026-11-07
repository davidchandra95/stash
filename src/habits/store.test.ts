import { beforeEach, expect, it, vi } from 'vitest'

// The browser preview store: session data, applied in order.
beforeEach(() => vi.resetModules())
const load = async () => {
  const { habitStore } = await import('./store')
  const actions = await import('./actions')
  await habitStore.open()
  return { habitStore, ...actions }
}

it('creates habits and checks days off with notes', async () => {
  vi.useFakeTimers({ now: new Date('2026-11-07T12:00:00'), toFake: ['Date'] })
  try {
    const { habitStore, createHabit, setCheckin, checkinOf } = await load()
    const habit = createHabit({ name: ' Read a book ', color: '#112233', frequency: { kind: 'daily' }, startDate: '2026-11-01' })
    await habitStore.flush()
    const saved = habitStore.getSnapshot().habits.find((h) => h.id === habit.id)!
    expect(saved).toMatchObject({ name: 'Read a book', revision: 1, archivedAt: null })

    setCheckin(habit, '2026-11-06', { done: true })
    setCheckin(habit, '2026-11-06', { note: 'Read ABC, chapter 2' })
    await habitStore.flush()
    expect(checkinOf(habit.id, '2026-11-06')).toMatchObject({
      id: `${habit.id}_20261106`,
      done: true,
      note: 'Read ABC, chapter 2',
      revision: 2,
    })
    // Unchecking keeps the note; future days can't be checked.
    setCheckin(habit, '2026-11-06', { done: false })
    setCheckin(habit, '2026-11-08', { done: true })
    await habitStore.flush()
    expect(checkinOf(habit.id, '2026-11-06')).toMatchObject({ done: false, note: 'Read ABC, chapter 2' })
    expect(checkinOf(habit.id, '2026-11-08')).toBeUndefined()
  } finally {
    vi.useRealTimers()
  }
})

it('deletes with undo and rejects invalid records before saving', async () => {
  const { habitStore, createHabit, deleteHabit } = await load()
  const habit = createHabit({ name: 'Walk', color: '#112233', frequency: { kind: 'weekly', times: 3 }, startDate: '2026-11-01' })
  const notices: { message: string; undo?: () => void }[] = []
  deleteHabit(habit, (n) => notices.push(n))
  await habitStore.flush()
  expect(habitStore.getSnapshot().habits.find((h) => h.id === habit.id)?.deletedAt).toEqual(expect.any(Number))
  notices[0]!.undo!()
  await habitStore.flush()
  expect(habitStore.getSnapshot().habits.find((h) => h.id === habit.id)?.deletedAt).toBeNull()

  const saved = habitStore.getSnapshot().habits.find((h) => h.id === habit.id)!
  await expect(habitStore.save({ habits: [{ ...saved, frequency: { kind: 'weekly', times: 9 } }] })).rejects.toThrow(/times a week/)
  habitStore.clearSaveError()
  await expect(
    habitStore.save({
      checkins: [{ id: 'wrong', habitId: habit.id, date: '2026-11-03', done: true, note: '', created: 0, updated: 0, revision: 0 }],
    }),
  ).rejects.toThrow(/check-in/)
})
