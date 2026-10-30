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
