import { effectiveDueDate } from './schedule'
import { taskTagName } from '../tags'
import { daysBetween, dueGroups, priorities, today, type DateGroup, type Priority, type Project, type Task } from './model'

/**
 * Saved filters: smart lists the person builds from task fields. A task must match every
 * condition; within a condition any selected option matches, and an empty one matches anything.
 * Filters are a device preference (`Appearance.taskFilters`), like the sidebar's layout.
 */
export type FilterDate = 'overdue' | 'today' | 'tomorrow' | 'next7' | 'later' | 'none'
export type FilterStatus = 'open' | 'done' | 'all'
export interface TaskFilter {
  id: string
  name: string
  /** Project IDs, or 'inbox' for tasks without a project. */
  projects: string[]
  tags: string[]
  priorities: Priority[]
  dates: FilterDate[]
  status: FilterStatus
}

export const filterDates: { id: FilterDate; label: string }[] = [
  { id: 'overdue', label: 'Overdue' },
  { id: 'today', label: 'Today' },
  { id: 'tomorrow', label: 'Tomorrow' },
  { id: 'next7', label: 'Next 7 days' },
  { id: 'later', label: 'Later' },
  { id: 'none', label: 'No date' },
]
export const filterStatuses: { id: FilterStatus; label: string }[] = [
  { id: 'open', label: 'Open' },
  { id: 'done', label: 'Completed' },
  { id: 'all', label: 'All' },
]
export const maxFilters = 50
export const maxFilterName = 60
const maxOptions = 100

export const filterView = (filter: Pick<TaskFilter, 'id'>) => `filter:${filter.id}` as const
export const isFilterView = (view: string | null): view is `filter:${string}` =>
  !!view?.startsWith('filter:')
export const filterOf = (filters: TaskFilter[], view: string | null) =>
  isFilterView(view) ? filters.find((f) => f.id === view.slice('filter:'.length)) : undefined

export const blankFilter = (id: string): TaskFilter => ({
  id,
  name: '',
  projects: [],
  tags: [],
  priorities: [],
  dates: [],
  status: 'open',
})

const dateIds = new Set<string>(filterDates.map((d) => d.id))
const strings = (value: unknown, valid: (s: string) => boolean) =>
  Array.isArray(value)
    ? [...new Set(value.filter((v): v is string => typeof v === 'string' && valid(v)))].slice(0, maxOptions)
    : []

/** Saved filters with invalid entries and fields dropped; a broken filter never blocks the rest. */
export function normalizeTaskFilters(value: unknown): TaskFilter[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const filters: TaskFilter[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const raw = item as Record<string, unknown>
    const id = raw.id
    const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, maxFilterName) : ''
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(id) || seen.has(id) || !name) continue
    seen.add(id)
    filters.push({
      id,
      name,
      projects: strings(raw.projects, (s) => s.length > 0 && s.length <= 128),
      tags: [...new Set(strings(raw.tags, (s) => !!taskTagName(s)).map((s) => taskTagName(s)!))],
      priorities: Array.isArray(raw.priorities)
        ? [...new Set(raw.priorities)].filter((p): p is Priority =>
            priorities.some((option) => option.id === p),
          )
        : [],
      dates: strings(raw.dates, (s) => dateIds.has(s)) as FilterDate[],
      status: filterStatuses.some((s) => s.id === raw.status) ? (raw.status as FilterStatus) : 'open',
    })
    if (filters.length === maxFilters) break
  }
  return filters
}

function dateBucket(task: Task, current: string): FilterDate {
  const due = effectiveDueDate(task)
  if (!due) return 'none'
  const days = daysBetween(current, due)
  if (days < 0) return 'overdue'
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  return days <= 6 ? 'next7' : 'later'
}

export function matchesFilter(task: Task, filter: TaskFilter, current = today()) {
  if (task.deletedAt !== null) return false
  const open = task.status === 'todo' || task.status === 'doing'
  if (filter.status === 'open' ? !open : filter.status === 'done' ? task.status !== 'done' : task.status === 'cancelled')
    return false
  if (filter.projects.length && !filter.projects.includes(task.projectId ?? 'inbox')) return false
  if (filter.tags.length && !filter.tags.some((tag) => task.tags?.includes(tag))) return false
  if (filter.priorities.length && !filter.priorities.includes(task.priority)) return false
  if (filter.dates.length) {
    const bucket = dateBucket(task, current)
    // Next 7 days includes today and tomorrow, as the Next 7 Days list does.
    const next7 = bucket === 'today' || bucket === 'tomorrow' || bucket === 'next7'
    if (!filter.dates.includes(bucket) && !(next7 && filter.dates.includes('next7'))) return false
  }
  return true
}

/** Matching tasks grouped Overdue, To do (soonest first), Completed, like a tag's page. */
export const filterGroups = (tasks: Task[], filter: TaskFilter, current = today()): DateGroup[] =>
  dueGroups(
    tasks.filter((t) => matchesFilter(t, filter, current)),
    current,
  )

/** Open tasks a filter shows, for the sidebar count. */
export const openFilterCount = (tasks: Task[], filter: TaskFilter, current = today()) =>
  tasks.filter((t) => (t.status === 'todo' || t.status === 'doing') && matchesFilter(t, filter, current)).length

/** One line describing the conditions, for the filter page header. */
export function describeFilter(filter: TaskFilter, projects: Pick<Project, 'id' | 'name' | 'deletedAt'>[]) {
  const parts: string[] = []
  if (filter.projects.length) {
    const names = filter.projects
      .map((id) =>
        id === 'inbox' ? 'Inbox' : projects.find((p) => p.id === id && p.deletedAt === null)?.name,
      )
      .filter((name): name is string => !!name)
    parts.push(names.length ? names.join(' or ') : 'A deleted project')
  }
  if (filter.tags.length) parts.push(filter.tags.map((tag) => `#${tag}`).join(' or '))
  if (filter.priorities.length)
    parts.push(
      `${filter.priorities
        .map((p) => priorities.find((option) => option.id === p)!.label)
        .join(' or ')} priority`,
    )
  if (filter.dates.length)
    parts.push(filter.dates.map((d) => filterDates.find((option) => option.id === d)!.label).join(' or '))
  const status = { open: 'Open tasks', done: 'Completed tasks', all: 'Open and completed tasks' }[
    filter.status
  ]
  return parts.length ? `${status} · ${parts.join(' · ')}` : `${status} from every project`
}

/** What a task added from the filter's page starts with, so it usually lands on the page. */
export function newTaskDefaults(filter: TaskFilter) {
  const realProjects = filter.projects.filter((id) => id !== 'inbox')
  return {
    projectId: filter.projects.length === 1 && realProjects.length === 1 ? realProjects[0] : null,
    tags: filter.tags.slice(0, 1),
    dueToday: filter.dates.includes('today') || filter.dates.includes('next7'),
  }
}
