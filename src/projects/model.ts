export type ProjectStatus = 'planned' | 'active' | 'on_hold' | 'done' | 'cancelled'
export type TaskStatus = 'todo' | 'doing' | 'done' | 'cancelled'
export type Priority = 0 | 1 | 2 | 3

export interface Project {
  id: string
  name: string
  description: string
  status: ProjectStatus
  /** Calendar dates as YYYY-MM-DD. */
  startDate: string | null
  endDate: string | null
  completedAt: number | null
  notebookId: string | null
  color: string
  sort: number
  deletedAt: number | null
  created: number
  updated: number
  revision: number
}
export interface Task {
  id: string
  title: string
  description: string
  status: TaskStatus
  /** `null` is the Inbox. */
  projectId: string | null
  priority: Priority
  startDate: string | null
  dueDate: string | null
  completedAt: number | null
  sort: number
  deletedAt: number | null
  created: number
  updated: number
  revision: number
}
export interface ProjectData {
  projects: Project[]
  tasks: Task[]
}

export const projectStatuses: { id: ProjectStatus; label: string }[] = [
  { id: 'planned', label: 'Planned' },
  { id: 'active', label: 'Active' },
  { id: 'on_hold', label: 'On hold' },
  { id: 'done', label: 'Done' },
  { id: 'cancelled', label: 'Cancelled' },
]
export const taskStatuses: { id: TaskStatus; label: string }[] = [
  { id: 'todo', label: 'To do' },
  { id: 'doing', label: 'Doing' },
  { id: 'done', label: 'Done' },
  { id: 'cancelled', label: 'Cancelled' },
]
export const priorities: { id: Priority; label: string }[] = [
  { id: 0, label: 'None' },
  { id: 1, label: 'Low' },
  { id: 2, label: 'Medium' },
  { id: 3, label: 'High' },
]
export const projectStatusLabel = (status: ProjectStatus) =>
  projectStatuses.find((s) => s.id === status)?.label ?? status
export const taskStatusLabel = (status: TaskStatus) =>
  taskStatuses.find((s) => s.id === status)?.label ?? status

/** Projects shown directly in the sidebar; the rest sit under "Other projects". */
export const isOpenProject = (project: Project) =>
  project.status === 'active' || project.status === 'planned'

/** Today's local calendar date as YYYY-MM-DD. */
export function today(now = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}
const dayNumber = (date: string) => {
  const [y, m, d] = date.split('-').map(Number)
  return Date.UTC(y, m - 1, d) / 86_400_000
}
export const daysBetween = (from: string, to: string) => dayNumber(to) - dayNumber(from)

const dateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const yearFormat = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
})
/** "Nov 4", or "Nov 4, 2027" outside the current year. */
export function formatDate(date: string, current = today()) {
  const value = new Date(dayNumber(date) * 86_400_000)
  return (date.slice(0, 4) === current.slice(0, 4) ? dateFormat : yearFormat).format(value)
}
export function formatRange(start: string | null, end: string | null, current = today()) {
  if (start && end) return `${formatDate(start, current)} – ${formatDate(end, current)}`
  if (start) return `From ${formatDate(start, current)}`
  if (end) return `Until ${formatDate(end, current)}`
  return ''
}
/** How a due date reads against today: overdue, due within two days, or later. */
export function dueState(task: Pick<Task, 'dueDate' | 'status'>, current = today()) {
  if (!task.dueDate || task.status === 'done' || task.status === 'cancelled') return 'none'
  const days = daysBetween(current, task.dueDate)
  return days < 0 ? 'late' : days <= 2 ? 'soon' : 'later'
}

export interface Progress {
  done: number
  /** Tasks that count: everything except cancelled. */
  total: number
  /** 0–1, or null when nothing counts. */
  ratio: number | null
}
export function progress(tasks: Pick<Task, 'status'>[]): Progress {
  const counted = tasks.filter((task) => task.status !== 'cancelled')
  const done = counted.filter((task) => task.status === 'done').length
  return { done, total: counted.length, ratio: counted.length ? done / counted.length : null }
}

export type Health = 'on_track' | 'at_risk' | 'overdue'
/** Progress more than this far behind elapsed time is at risk. */
export const atRiskGap = 0.15
export function elapsed(project: Pick<Project, 'startDate' | 'endDate'>, current = today()) {
  if (!project.startDate || !project.endDate) return null
  const span = daysBetween(project.startDate, project.endDate)
  if (span <= 0) return current >= project.endDate ? 1 : 0
  return Math.min(1, Math.max(0, daysBetween(project.startDate, current) / span))
}
/** Only active projects with an end date have a health. */
export function health(
  project: Pick<Project, 'status' | 'startDate' | 'endDate'>,
  tasks: Pick<Task, 'status'>[],
  current = today(),
): Health | null {
  if (project.status !== 'active' || !project.endDate) return null
  if (current > project.endDate) return 'overdue'
  const time = elapsed(project, current)
  const { ratio } = progress(tasks)
  if (time !== null && ratio !== null && time - ratio > atRiskGap) return 'at_risk'
  return 'on_track'
}
export const healthLabel: Record<Health, string> = {
  on_track: 'On track',
  at_risk: 'At risk',
  overdue: 'Overdue',
}

/** A sort key that places an item between two neighbours (either may be missing). */
export function sortBetween(before?: number, after?: number) {
  if (before === undefined && after === undefined) return 1
  if (before === undefined) return after! - 1
  if (after === undefined) return before + 1
  return (before + after) / 2
}

export type TaskGroup = 'doing' | 'todo' | 'done'
export const groupOf = (task: Pick<Task, 'status'>): TaskGroup =>
  task.status === 'doing' ? 'doing' : task.status === 'todo' ? 'todo' : 'done'
export const bySort = (a: { sort: number; created: number }, b: { sort: number; created: number }) =>
  a.sort - b.sort || a.created - b.created

export interface ProjectSummary {
  project: Project
  progress: Progress
  health: Health | null
  /** To do and doing. */
  open: number
  /** Open tasks past their due date. */
  overdue: number
}
export function summarize(
  projects: Project[],
  tasks: Task[],
  current = today(),
): ProjectSummary[] {
  return projects
    .filter((project) => project.deletedAt === null)
    .map((project) => {
      const own = tasks.filter((t) => t.deletedAt === null && t.projectId === project.id)
      return {
        project,
        progress: progress(own),
        health: health(project, own, current),
        open: own.filter((t) => t.status === 'todo' || t.status === 'doing').length,
        overdue: own.filter((t) => dueState(t, current) === 'late').length,
      }
    })
}

export type OverviewSort = 'health' | 'name' | 'status' | 'end' | 'progress' | 'open'
const healthRank: Record<Health, number> = { overdue: 0, at_risk: 1, on_track: 2 }
const statusRank: Record<ProjectStatus, number> = {
  active: 0,
  planned: 1,
  on_hold: 2,
  done: 3,
  cancelled: 4,
}
/**
 * Orders overview rows. Ascending `health` puts projects that need attention first; missing
 * values (no end date, no health, no counted tasks) always sort last.
 */
export function sortSummaries(rows: ProjectSummary[], key: OverviewSort, descending = false) {
  const value = (row: ProjectSummary): number | string | null => {
    switch (key) {
      case 'health':
        return row.health === null ? null : healthRank[row.health]
      case 'name':
        return row.project.name.toLocaleLowerCase()
      case 'status':
        return statusRank[row.project.status]
      case 'end':
        return row.project.endDate
      case 'progress':
        return row.progress.ratio
      case 'open':
        return row.open
    }
  }
  const byName = (a: ProjectSummary, b: ProjectSummary) =>
    a.project.name.localeCompare(b.project.name)
  return [...rows].sort((a, b) => {
    const x = value(a),
      y = value(b)
    if (x === null || y === null) return x === y ? byName(a, b) : x === null ? 1 : -1
    const order = x < y ? -1 : x > y ? 1 : 0
    // Equal health: the sooner deadline first.
    const deadline =
      key === 'health' ? (a.project.endDate ?? '9').localeCompare(b.project.endDate ?? '9') : 0
    return (descending ? -order : order) || deadline || byName(a, b)
  })
}

const addDays = (date: string, days: number) =>
  new Date((dayNumber(date) + days) * 86_400_000).toISOString().slice(0, 10)
const isOpen = (task: Pick<Task, 'status'>) => task.status === 'todo' || task.status === 'doing'
/** The local calendar date of a timestamp. */
export const dateOf = (timestamp: number) => today(new Date(timestamp))

export interface DateGroup {
  id: string
  label: string
  tasks: Task[]
}
const byDue = (a: Task, b: Task) =>
  (a.dueDate ?? '').localeCompare(b.dueDate ?? '') || b.priority - a.priority || bySort(a, b)

/**
 * Today: open tasks that are overdue or due today, plus tasks due by today that were finished
 * today, so ticking one doesn't make it vanish.
 */
export function todayGroups(tasks: Task[], current = today()): DateGroup[] {
  const live = tasks.filter((t) => t.deletedAt === null && t.dueDate && t.dueDate <= current)
  const overdue = live.filter((t) => isOpen(t) && t.dueDate! < current).sort(byDue)
  const due = live
    .filter(
      (t) =>
        (isOpen(t) && t.dueDate === current) ||
        (t.status === 'done' && t.completedAt !== null && dateOf(t.completedAt) === current),
    )
    .sort((a, b) => Number(isOpen(b)) - Number(isOpen(a)) || byDue(a, b))
  return [
    { id: 'overdue', label: 'Overdue', tasks: overdue },
    { id: 'today', label: 'Today', tasks: due },
  ].filter((group) => group.tasks.length)
}

const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' })
/** Open tasks due after today: one group per day for the next week, then one per month. */
export function upcomingGroups(tasks: Task[], current = today()): DateGroup[] {
  const groups = new Map<string, DateGroup>()
  const weekEnd = addDays(current, 7)
  const sorted = tasks
    .filter((t) => t.deletedAt === null && isOpen(t) && t.dueDate && t.dueDate > current)
    .sort(byDue)
  for (const task of sorted) {
    const due = task.dueDate!
    const withinWeek = due <= weekEnd
    const id = withinWeek ? due : due.slice(0, 7)
    const label = withinWeek
      ? due === addDays(current, 1)
        ? 'Tomorrow'
        : `${weekday.format(new Date(dayNumber(due) * 86_400_000))}, ${formatDate(due, current)}`
      : `${due.slice(0, 7) === weekEnd.slice(0, 7) ? 'Later in ' : ''}${new Intl.DateTimeFormat(
          'en-US',
          {
            month: 'long',
            ...(due.slice(0, 4) === current.slice(0, 4) ? {} : { year: 'numeric' }),
            timeZone: 'UTC',
          },
        ).format(new Date(dayNumber(`${due.slice(0, 7)}-01`) * 86_400_000))}`
    const group = groups.get(id) ?? { id, label, tasks: [] }
    group.tasks.push(task)
    groups.set(id, group)
  }
  return [...groups.values()]
}

/** Board columns; cancelled tasks sit with done ones. */
export const boardColumns: { id: TaskGroup; status: TaskStatus; label: string }[] = [
  { id: 'todo', status: 'todo', label: 'To do' },
  { id: 'doing', status: 'doing', label: 'Doing' },
  { id: 'done', status: 'done', label: 'Done' },
]

export interface TimelineRange {
  start: string
  end: string
  /** First day of each month in the range. */
  months: string[]
}
/**
 * The months covering every dated project and today, with a month of margin on each side.
 * Returns null when no project has dates.
 */
export function timelineRange(
  projects: Pick<Project, 'startDate' | 'endDate'>[],
  current = today(),
): TimelineRange | null {
  const dates = projects.flatMap((p) => [p.startDate, p.endDate]).filter((d): d is string => !!d)
  if (!dates.length) return null
  const first = [...dates, current].sort()[0]
  const last = [...dates, current].sort().at(-1)!
  const month = (date: string, offset: number) => {
    const [y, m] = date.split('-').map(Number)
    const value = new Date(Date.UTC(y, m - 1 + offset, 1))
    return value.toISOString().slice(0, 10)
  }
  const start = month(first, -1)
  const end = addDays(month(last, 2), -1)
  const months: string[] = []
  for (let m = start; m <= end; m = month(m, 1)) months.push(m)
  return { start, end, months }
}
/** Where a date falls in the range, 0–1 (the start of that day). */
export function timelinePosition(range: TimelineRange, date: string) {
  const span = daysBetween(range.start, range.end) + 1
  return Math.min(1, Math.max(0, daysBetween(range.start, date) / span))
}
