import { beforeEach, expect, it, vi } from 'vitest'
import { previewProjectData } from './fixtures'
import { resolveWallTime } from './schedule'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke }))
beforeEach(() => {
  vi.resetModules()
  invoke.mockReset()
})

it('cancels queued edits after a failed save, restores confirmed records and allows a fresh retry', async () => {
  const data = previewProjectData()
  let reject!: (error: Error) => void
  invoke.mockImplementation((command: string) =>
    command === 'list_projects'
      ? Promise.resolve(structuredClone(data))
      : new Promise((_, no) => {
          reject = no
        }),
  )
  const { projectStore } = await import('./store')
  await projectStore.open()
  const original = projectStore.getSnapshot().tasks[0]
  const first = projectStore.save({
    tasks: [
      {
        ...original,
        schedule: {
          kind: 'point',
          start: resolveWallTime('2026-11-03', '14:00', 'UTC'),
          timeZone: 'UTC',
        },
      },
    ],
  })
  const second = projectStore.save({ tasks: [{ ...original, title: 'Newer queued title' }] })
  const outcomes = Promise.allSettled([first, second])
  await Promise.resolve()
  reject(Error('Disk full'))
  expect((await outcomes).map((result) => result.status)).toEqual(['rejected', 'rejected'])
  expect(invoke.mock.calls.filter(([command]) => command === 'save_projects')).toHaveLength(1)
  expect(projectStore.getSnapshot().tasks[0]).toEqual(original)
  expect(projectStore.getSnapshot().saveError).toContain('Disk full')
  await expect(projectStore.flush()).rejects.toThrow('Disk full')
  invoke.mockImplementation(async (command: string, args: { changes: { tasks: unknown[] } }) => {
    expect(command).toBe('save_projects')
    expect(args.changes.tasks[0]).toMatchObject({
      expectedRevision: original.revision,
      title: 'Retry title',
    })
    return {
      projects: [],
      tasks: [{ ...original, title: 'Retry title', revision: original.revision + 1 }],
    }
  })
  await projectStore.save({ tasks: [{ ...original, title: 'Retry title' }] })
  await projectStore.flush()
  expect(projectStore.getSnapshot().tasks[0].title).toBe('Retry title')
})

it('does not show an undo success notice after a rejected calendar write', async () => {
  const data = previewProjectData()
  invoke.mockImplementation((command: string) =>
    command === 'list_projects'
      ? Promise.resolve(structuredClone(data))
      : Promise.reject(Error('Revision conflict')),
  )
  const { projectStore } = await import('./store')
  const { saveTaskSchedule } = await import('./actions')
  await projectStore.open()
  const notify = vi.fn()
  await expect(
    saveTaskSchedule(
      data.tasks[0],
      { kind: 'allDay', start: '2026-11-03', end: '2026-11-04' },
      notify,
    ),
  ).rejects.toThrow('Revision conflict')
  expect(notify).not.toHaveBeenCalled()
  expect(projectStore.getSnapshot().tasks[0]).toEqual(data.tasks[0])
})

it('does not accept edits to an optimistic snapshot while recovery is reading disk', async () => {
  const data = previewProjectData()
  let reloaded!: (value: typeof data) => void
  let reloadStarted!: () => void
  const reading = new Promise<void>((resolve) => {
    reloadStarted = resolve
  })
  invoke.mockResolvedValueOnce(structuredClone(data))
  invoke.mockRejectedValueOnce(Error('Revision conflict'))
  invoke.mockImplementationOnce(() => {
    reloadStarted()
    return new Promise((resolve) => {
      reloaded = resolve
    })
  })
  const { projectStore } = await import('./store')
  await projectStore.open()
  const original = data.tasks[0]
  const saving = projectStore
    .save({ tasks: [{ ...original, title: 'Failed title' }] })
    .catch(String)
  await reading
  expect(projectStore.getSnapshot().tasks[0]).toEqual(original)
  await expect(projectStore.save({ tasks: [{ ...original, priority: 3 }] })).rejects.toThrow(
    'Reloading stored tasks',
  )
  reloaded(structuredClone(data))
  expect(await saving).toContain('Revision conflict')
  expect(invoke.mock.calls.filter(([command]) => command === 'save_projects')).toHaveLength(1)
})
