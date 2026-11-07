import { invoke, isTauri } from '@tauri-apps/api/core'
import { useEffect, useSyncExternalStore } from 'react'
import { previewHabitData } from './fixtures'
import { checkinId, validateCheckin, validateHabit, type Habit, type HabitCheckin, type HabitData } from './model'

/**
 * Habits and check-ins, saved like projects and tasks: edits apply to the snapshot at once and
 * save in order through one queue, each with the last revision the store confirmed. A failed save
 * reloads the stored state and shows the error.
 */
const native = isTauri()
type Snapshot = HabitData & { ready: boolean; error: string; saveError: string }
let snapshot: Snapshot = { habits: [], checkins: [], ready: false, error: '', saveError: '' }
const listeners = new Set<() => void>()
const publish = (patch: Partial<Snapshot>) => {
  snapshot = { ...snapshot, ...patch }
  listeners.forEach((listener) => listener())
}
const confirmed = { habits: new Map<string, Habit>(), checkins: new Map<string, HabitCheckin>() }
const remember = (data: Partial<HabitData>) => {
  data.habits?.forEach((h) => confirmed.habits.set(h.id, h))
  data.checkins?.forEach((c) => confirmed.checkins.set(c.id, c))
}
const merge = <T extends { id: string }>(list: T[], changed: T[] = []) => {
  if (!changed.length) return list
  const byId = new Map(changed.map((item) => [item.id, item]))
  const next = list.map((item) => byId.get(item.id) ?? item)
  for (const item of changed) if (!list.some((old) => old.id === item.id)) next.push(item)
  return next
}

export type HabitChanges = { habits?: Habit[]; checkins?: HabitCheckin[] }
let queue: Promise<void> = Promise.resolve()
let opening: Promise<void> | undefined
let saveGeneration = 0
let reloading = false

const saveRequest = (changes: HabitChanges) => ({
  habits: (changes.habits ?? []).map((h) => ({
    id: h.id,
    name: h.name,
    color: h.color,
    frequency: h.frequency,
    startDate: h.startDate,
    archivedAt: h.archivedAt,
    sort: h.sort,
    deleted: h.deletedAt !== null,
    expectedRevision: confirmed.habits.get(h.id)?.revision ?? 0,
  })),
  checkins: (changes.checkins ?? []).map((c) => ({
    habitId: c.habitId,
    date: c.date,
    done: c.done,
    note: c.note,
    expectedRevision: confirmed.checkins.get(c.id)?.revision ?? 0,
  })),
})

/** What the native store does to saved records, for the browser preview. */
function previewSave(changes: HabitChanges): HabitData {
  const at = Date.now()
  const stamp = <T extends Habit | HabitCheckin>(record: T, kind: 'habits' | 'checkins'): T => {
    const revision = confirmed[kind].get(record.id)?.revision ?? 0
    return { ...record, created: revision ? record.created : at, updated: at, revision: revision + 1 }
  }
  return {
    habits: (changes.habits ?? []).map((h) =>
      stamp({ ...h, name: h.name.trim(), color: h.color.toLowerCase(), deletedAt: h.deletedAt === null ? null : h.deletedAt || at }, 'habits'),
    ),
    checkins: (changes.checkins ?? []).map((c) => stamp(c, 'checkins')),
  }
}

async function load() {
  const data = native ? await invoke<HabitData>('list_habits') : previewHabitData()
  confirmed.habits.clear()
  confirmed.checkins.clear()
  remember(data)
  publish({ ...data, ready: true, error: '' })
}

export const habitStore = {
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  getSnapshot: () => snapshot,
  async open() {
    if (snapshot.ready) return
    opening ??= load()
      .catch((error) => publish({ error: String(error) }))
      .finally(() => {
        opening = undefined
      })
    await opening
  },
  save(changes: HabitChanges): Promise<void> {
    if (reloading) return Promise.reject(Error('Reloading stored habits. Try again in a moment.'))
    try {
      changes.habits?.forEach(validateHabit)
      for (const c of changes.checkins ?? []) {
        validateCheckin(c)
        if (c.id !== checkinId(c.habitId, c.date)) throw Error('Invalid habit check-in.')
      }
    } catch (error) {
      saveGeneration++
      publish({ saveError: String(error) })
      return Promise.reject(error)
    }
    const generation = saveGeneration
    publish({
      habits: merge(snapshot.habits, changes.habits),
      checkins: merge(snapshot.checkins, changes.checkins),
      saveError: '',
    })
    const run = async () => {
      if (generation !== saveGeneration)
        throw Error('An earlier save failed. Review the restored habit and try again.')
      try {
        const saved = native
          ? await invoke<HabitData>('save_habits', { changes: saveRequest(changes) })
          : previewSave(changes)
        remember(saved)
        // A record edited again while this save ran keeps its newer local value.
        const unchanged =
          <T extends { id: string }>(list: T[], sent: T[] = []) =>
          (record: T) => {
            const local = list.find((old) => old.id === record.id)
            return !local || sent.includes(local)
          }
        publish({
          habits: merge(snapshot.habits, saved.habits.filter(unchanged(snapshot.habits, changes.habits))),
          checkins: merge(snapshot.checkins, saved.checkins.filter(unchanged(snapshot.checkins, changes.checkins))),
        })
      } catch (error) {
        saveGeneration++
        reloading = true
        publish({
          habits: [...confirmed.habits.values()],
          checkins: [...confirmed.checkins.values()],
          saveError: String(error),
        })
        try {
          await load().catch((reload) => publish({ error: String(reload) }))
        } finally {
          reloading = false
        }
        throw error
      }
    }
    const result = queue.then(run)
    queue = result.catch(() => {})
    return result
  },
  /** Waits for queued saves, so a sync uploads them. */
  settle: () => queue,
  /** Reloads after a sync. */
  refresh(): Promise<void> {
    if (!snapshot.ready && !opening) return Promise.resolve()
    const result = queue.then(load)
    queue = result.catch(() => {})
    return result
  },
  /** Waits for queued saves, for quit. */
  flush: async () => {
    await queue
    if (snapshot.saveError) throw Error(snapshot.saveError)
  },
  clearSaveError: () => publish({ saveError: '' }),
}

export function useHabits(enabled: boolean) {
  const value = useSyncExternalStore(habitStore.subscribe, habitStore.getSnapshot)
  useEffect(() => {
    if (enabled) void habitStore.open()
  }, [enabled])
  return value
}
