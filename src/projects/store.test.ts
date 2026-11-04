import { beforeEach, expect, it, vi } from 'vitest'

// The browser preview store: session data, applied in order.
beforeEach(() => vi.resetModules())
const load = async () => {
  const { projectStore } = await import('./store')
  const actions = await import('./actions')
  await projectStore.open()
  return { projectStore, ...actions }
}
const live = <T extends { deletedAt: number | null }>(items: T[]) =>
  items.filter((item) => item.deletedAt === null)

it('creates, completes and reopens tasks', async () => {
  const { projectStore, createTask, toggleTask } = await load()
  const task = createTask(null, '  Call the plumber ')
  await projectStore.flush()
  let saved = projectStore.getSnapshot().tasks.find((t) => t.id === task.id)!
  expect(saved).toMatchObject({ title: 'Call the plumber', revision: 1, status: 'todo' })
  // New tasks go to the top of To do.
  const inbox = live(projectStore.getSnapshot().tasks).filter(
    (t) => t.projectId === null && t.status === 'todo' && t.id !== task.id,
  )
  expect(inbox.every((t) => t.sort > saved.sort)).toBe(true)

  toggleTask(saved)
  await projectStore.flush()
  saved = projectStore.getSnapshot().tasks.find((t) => t.id === task.id)!
  expect(saved.status).toBe('done')
  expect(saved.completedAt).toEqual(expect.any(Number))
  toggleTask(saved)
  await projectStore.flush()
  saved = projectStore.getSnapshot().tasks.find((t) => t.id === task.id)!
  expect(saved).toMatchObject({ status: 'todo', completedAt: null, revision: 3 })
})

it('keeps quick successive edits', async () => {
  const { projectStore, createTask, updateTask } = await load()
  const task = createTask(null, 'Draft')
  updateTask(task, { title: 'Second' })
  updateTask(task, { priority: 3 })
  expect(projectStore.getSnapshot().tasks.find((t) => t.id === task.id)).toMatchObject({
    title: 'Second',
    priority: 3,
  })
  await projectStore.flush()
  expect(projectStore.getSnapshot().tasks.find((t) => t.id === task.id)).toMatchObject({
    title: 'Second',
    priority: 3,
    revision: 3,
  })
})

it('saves due times, keeps them on unrelated edits, and clears them with the due date', async () => {
  const { projectStore, createTask, updateTask } = await load()
  const task = createTask(null, 'Timed task', { dueDate: '2026-11-03', dueTime: '14:00' })
  await projectStore.flush()
  const find = () => projectStore.getSnapshot().tasks.find((item) => item.id === task.id)!
  expect(find()).toMatchObject({ dueDate: '2026-11-03', dueTime: '14:00' })
  updateTask(find(), { title: 'Renamed task' })
  await projectStore.flush()
  expect(find()).toMatchObject({ title: 'Renamed task', dueTime: '14:00' })
  updateTask(find(), { dueDate: null })
  await projectStore.flush()
  expect(find()).toMatchObject({ dueDate: null, dueTime: null })
})

it('deletes a task with undo', async () => {
  const { projectStore, deleteTask } = await load()
  const task = live(projectStore.getSnapshot().tasks)[0]
  const notify = vi.fn()
  deleteTask(task, notify)
  await projectStore.flush()
  expect(projectStore.getSnapshot().tasks.find((t) => t.id === task.id)?.deletedAt).not.toBeNull()
  notify.mock.calls[0][0].undo()
  await projectStore.flush()
  expect(projectStore.getSnapshot().tasks.find((t) => t.id === task.id)?.deletedAt).toBeNull()
})

it('undoes only scheduling fields and preserves a later title or status edit', async () => {
  const { projectStore, createTask, saveTaskSchedule, updateTask } = await load()
  const task = createTask(null, 'Plan work')
  await projectStore.flush()
  const notify = vi.fn()
  await saveTaskSchedule(task, { kind: 'allDay', start: '2026-11-03', end: '2026-11-05' }, notify)
  updateTask(task, { title: 'Renamed work', status: 'doing' })
  await projectStore.flush()
  notify.mock.calls[0][0].undo()
  await projectStore.flush()
  expect(projectStore.getSnapshot().tasks.find((t) => t.id === task.id)).toMatchObject({ title: 'Renamed work', status: 'doing', schedule: null, dueLinked: false })
})

it('does not undo a later deadline change over an earlier move', async () => {
  const { projectStore, createTask, saveTaskSchedule, updateTask } = await load()
  const task = createTask(null, 'Plan work')
  await projectStore.flush()
  const notify = vi.fn()
  await saveTaskSchedule(task, { kind: 'allDay', start: '2026-11-03', end: '2026-11-05' }, notify)
  updateTask(task, { dueDate: '2026-12-01' })
  await projectStore.flush()
  notify.mock.calls[0][0].undo()
  await projectStore.flush()
  expect(projectStore.getSnapshot().tasks.find((t) => t.id === task.id)).toMatchObject({ dueDate: '2026-12-01', dueLinked: false })
  expect(notify.mock.lastCall?.[0].message).toContain('changed again')
})

it('deletes a project, moving its tasks to the Inbox, and undoes it', async () => {
  const { projectStore, deleteProject } = await load()
  const project = projectStore.getSnapshot().projects[0]
  const own = live(projectStore.getSnapshot().tasks).filter((t) => t.projectId === project.id)
  expect(own.length).toBeGreaterThan(0)
  const notify = vi.fn()
  deleteProject(project, false, notify)
  await projectStore.flush()
  const after = projectStore.getSnapshot()
  expect(after.projects.find((p) => p.id === project.id)?.deletedAt).not.toBeNull()
  for (const task of own)
    expect(after.tasks.find((t) => t.id === task.id)).toMatchObject({
      projectId: null,
      deletedAt: null,
    })

  notify.mock.calls[0][0].undo()
  await projectStore.flush()
  const restored = projectStore.getSnapshot()
  expect(restored.projects.find((p) => p.id === project.id)?.deletedAt).toBeNull()
  for (const task of own)
    expect(restored.tasks.find((t) => t.id === task.id)?.projectId).toBe(project.id)
})

it('deletes a project with its tasks', async () => {
  const { projectStore, deleteProject } = await load()
  const project = projectStore.getSnapshot().projects[0]
  deleteProject(project, true, vi.fn())
  await projectStore.flush()
  const tasks = projectStore.getSnapshot().tasks.filter((t) => t.projectId === project.id)
  expect(tasks.length).toBeGreaterThan(0)
  expect(tasks.every((t) => t.deletedAt !== null)).toBe(true)
})

it('refresh waits for queued saves and keeps them', async () => {
  const { projectStore, createTask } = await load()
  const task = createTask(null, 'Queued')
  await projectStore.settle()
  expect(projectStore.getSnapshot().tasks.find((t) => t.id === task.id)?.revision).toBe(1)
  await projectStore.refresh()
  expect(projectStore.getSnapshot().ready).toBe(true)
})

it('refresh does nothing before the store opens', async () => {
  const { projectStore } = await import('./store')
  await projectStore.refresh()
  expect(projectStore.getSnapshot().ready).toBe(false)
})
