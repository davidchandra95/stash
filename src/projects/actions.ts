import { effectiveDueDate, schedulePatch, type TaskSchedule } from './schedule'
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
const latest = (task: Task) =>
  projectStore.getSnapshot().tasks.find((t) => t.id === task.id) ?? task

export function updateTask(task: Task, patch: Partial<Task>) {
  const next = { ...latest(task), ...patch }
  if ('dueDate' in patch && !('dueLinked' in patch)) next.dueLinked = false
  if (!next.dueDate) next.dueTime = null
  save({ tasks: [next] })
}
export function setTaskStatus(task: Task, status: TaskStatus) {
  updateTask(task, { status })
}
/** The checkbox: done tasks reopen as to do; anything else completes. */
export function toggleTask(task: Task) {
  setTaskStatus(task, latest(task).status === 'done' ? 'todo' : 'done')
}
/** New tasks go to the top of To do. */
export function buildTask(
  projectId: string | null,
  title: string,
  fields: Partial<Pick<Task, 'dueDate' | 'dueTime' | 'schedule' | 'dueLinked'>> = {},
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
    dueTime: null,
    schedule: null,
    dueLinked: false,
    completedAt: null,
    sort: sortBetween(undefined, first?.sort),
    deletedAt: null,
    created: at,
    updated: at,
    revision: 0,
    ...fields,
  }
  return task
}
export function createTask(...args: Parameters<typeof buildTask>): Task {
  const task = buildTask(...args)
  save({ tasks: [task] })
  return task
}
export async function createTaskConfirmed(...args: Parameters<typeof buildTask>): Promise<Task> {
  const task = buildTask(...args)
  await projectStore.save({ tasks: [task] })
  return latest(task)
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

/** Calendar writes wait for confirmation; undo changes only scheduling fields. */
export async function saveTaskSchedule(task: Task, schedule: TaskSchedule | null, notify?: Notify) {
  const original = latest(task)
  const patch = schedulePatch(original, schedule)
  await projectStore.save({ tasks: [{ ...original, ...patch }] })
  const saved = latest(task)
  if (JSON.stringify(saved.schedule) !== JSON.stringify(patch.schedule)) return
  notify?.({
    message: `Scheduled “${saved.title}”`,
    undo: () => {
      const current = latest(task)
      if (
        JSON.stringify(current.schedule) !== JSON.stringify(patch.schedule) ||
        current.dueLinked !== patch.dueLinked ||
        current.dueDate !== patch.dueDate ||
        current.dueTime !== patch.dueTime
      ) {
        notify({ message: 'The schedule changed again. Open task details to edit it.' })
        return
      }
      save({
        tasks: [
          {
            ...current,
            schedule: original.schedule ?? null,
            dueLinked: original.dueLinked ?? false,
            dueDate: original.dueDate,
            dueTime: original.dueTime,
          },
        ],
      })
    },
  })
}

export async function moveDueMarker(task: Task, date: string, notify?: Notify) {
  const original = latest(task)
  await projectStore.save({ tasks: [{ ...original, dueDate: date, dueLinked: false }] })
  notify?.({
    message: `Moved deadline for “${original.title}”`,
    undo: () => {
      const current = latest(task)
      if (current.dueDate !== date || current.dueLinked) return
      save({
        tasks: [{ ...current, dueDate: effectiveDueDate(original), dueTime: original.dueTime }],
      })
    },
  })
}
