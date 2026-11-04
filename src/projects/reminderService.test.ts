import { beforeEach, expect, it, vi } from 'vitest'
import type { Task } from './model'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({
  invoke,
  isTauri: () => true,
  addPluginListener: vi.fn(),
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }))

const start = Date.now() + 3_600_000
const task: Partial<Task> = {
  id: 't1',
  title: 'Call',
  status: 'todo',
  deletedAt: null,
  dueDate: null,
  dueTime: null,
  schedule: { kind: 'point', start, timeZone: 'UTC' },
}
let status = 'granted'
let pending: string[] = []
let tasks = [task]
async function load() {
  vi.resetModules()
  const store = await import('./store')
  const service = await import('./reminderService')
  invoke.mockImplementation(async (command: string) => {
    if (command === 'list_projects') return { projects: [], tasks }
    if (command === 'reminder_status') return status
    if (command === 'reminder_pending') return pending
  })
  await store.projectStore.open()
  return service
}
const syncCall = () => invoke.mock.calls.find(([command]) => command === 'reminder_sync')?.[1]

beforeEach(() => {
  invoke.mockReset()
  status = 'granted'
  pending = []
  tasks = [task]
})

it('schedules upcoming reminders once notifications are allowed', async () => {
  const { syncReminders } = await load()
  await syncReminders()
  expect(syncCall()).toEqual({
    entries: [
      { id: `stash.task.t1.0.${start}`, title: 'Call', body: 'Starts now', fireAt: start },
    ],
    drop: [],
  })
})
it.each(['notDetermined', 'denied', 'unavailable'])('schedules nothing while %s', async (value) => {
  status = value
  const { syncReminders } = await load()
  await syncReminders()
  expect(syncCall()).toBeUndefined()
})
it('keeps current snoozes, drops stale ones and leaves room for them in the limit', async () => {
  const current = `stash.snooze.t1.${start}.${start + 600_000}`
  const moved = `stash.snooze.t1.${start - 1000}.${start + 600_000}`
  pending = [current, moved, `stash.task.t1.0.${start}`]
  const { syncReminders } = await load()
  await syncReminders()
  expect(syncCall().drop).toEqual([moved])
  expect(syncCall().entries).toHaveLength(1)
})
it('reports a failed sync instead of hiding it', async () => {
  const { syncReminders, reminderState } = await load()
  const base = invoke.getMockImplementation()!
  invoke.mockImplementation(async (command: string, args: unknown) => {
    if (command === 'reminder_sync') throw 'Could not schedule reminders.'
    return base(command, args)
  })
  await syncReminders()
  expect(reminderState().error).toBe('Could not schedule reminders.')
})
