import { newId, projectStore } from './store'
import { bySort, sortBetween, type Project, type Task, type TaskStatus } from './model'

/** Shows an undo notice; the app supplies it. */
export type Notify = (notice: { message: string; undo?: () => void } | null) => void

// Failures are shown from the store's saveError, so callers don't handle them.
const save = (changes: Parameters<typeof projectStore.save>[0]) =>
  void projectStore.save(changes).catch(() => {})
const live = () => {
  const { projects, tasks } = projectStore.getSnapshot()
  return {
    projects: projects.filter((p) => p.deletedAt === null),
    tasks: tasks.filter((t) => t.deletedAt === null),
  }
}
const latest = (task: Task) => projectStore.getSnapshot().tasks.find((t) => t.id === task.id) ?? task

export function updateTask(task: Task, patch: Partial<Task>) {
  save({ tasks: [{ ...latest(task), ...patch }] })
}
export function setTaskStatus(task: Task, status: TaskStatus) {
  updateTask(task, { status })
}
/** The checkbox: done tasks reopen as to do; anything else completes. */
export function toggleTask(task: Task) {
  setTaskStatus(task, latest(task).status === 'done' ? 'todo' : 'done')
}
/** New tasks go to the top of To do. */
export function createTask(
  projectId: string | null,
  title: string,
  fields: Partial<Pick<Task, 'dueDate'>> = {},
): Task {
  const siblings = live().tasks.filter((t) => t.projectId === projectId && t.status === 'todo')
  const first = siblings.sort(bySort)[0]
  const at = Date.now()
  const task: Task = {
    id: newId(),
    title: title.trim(),
    description: '',
    status: 'todo',
    projectId,
    priority: 0,
    startDate: null,
    dueDate: null,
    completedAt: null,
    sort: sortBetween(undefined, first?.sort),
    deletedAt: null,
    created: at,
    updated: at,
    revision: 0,
    ...fields,
  }
  save({ tasks: [task] })
  return task
}
export function moveTask(task: Task, projectId: string | null) {
  const last = live()
    .tasks.filter((t) => t.projectId === projectId)
    .sort(bySort)
    .at(-1)
  updateTask(task, { projectId, sort: sortBetween(last?.sort) })
}
/** Places `task` between two neighbours in its group. */
export function reorderTask(task: Task, before?: Task, after?: Task) {
  updateTask(task, { sort: sortBetween(before?.sort, after?.sort) })
}
export function deleteTask(task: Task, notify: Notify) {
  const original = latest(task)
  save({ tasks: [{ ...original, deletedAt: Date.now() }] })
  notify({
    message: `Deleted “${original.title}”`,
    undo: () => save({ tasks: [{ ...original, deletedAt: null }] }),
  })
}

export type ProjectFields = Pick<
  Project,
  'name' | 'description' | 'status' | 'startDate' | 'endDate' | 'notebookId' | 'color'
>
export function createProject(fields: ProjectFields): Project {
  const last = live().projects.sort(bySort).at(-1)
  const at = Date.now()
  const project: Project = {
    ...fields,
    id: newId(),
    completedAt: null,
    sort: sortBetween(last?.sort),
    deletedAt: null,
    created: at,
    updated: at,
    revision: 0,
  }
  save({ projects: [project] })
  return project
}
export function updateProject(project: Project, patch: Partial<Project>) {
  const current = projectStore.getSnapshot().projects.find((p) => p.id === project.id) ?? project
  save({ projects: [{ ...current, ...patch }] })
}
/** Deletes a project and either moves its tasks to the Inbox or deletes them too. */
export function deleteProject(project: Project, deleteTasks: boolean, notify: Notify) {
  const at = Date.now()
  const original = projectStore.getSnapshot().projects.find((p) => p.id === project.id) ?? project
  const tasks = live().tasks.filter((t) => t.projectId === project.id)
  const inboxEnd = live()
    .tasks.filter((t) => t.projectId === null)
    .sort(bySort)
    .at(-1)?.sort
  let sort = inboxEnd
  save({
    projects: [{ ...original, deletedAt: at }],
    tasks: tasks.map((t) =>
      deleteTasks
        ? { ...t, deletedAt: at }
        : { ...t, projectId: null, sort: (sort = sortBetween(sort)) },
    ),
  })
  notify({
    message: deleteTasks
      ? `Deleted “${original.name}” and its tasks`
      : `Deleted “${original.name}”. Its tasks moved to the Inbox.`,
    undo: () => save({ projects: [{ ...original, deletedAt: null }], tasks }),
  })
}
