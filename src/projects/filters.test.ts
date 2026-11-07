import { expect, it } from 'vitest'
import {
  blankFilter,
  describeFilter,
  filterGroups,
  matchesFilter,
  newTaskDefaults,
  normalizeTaskFilters,
  openFilterCount,
  type TaskFilter,
} from './filters'
import type { Task } from './model'

const current = '2026-11-07'
const task = (fields: Partial<Task> = {}): Task => ({
  id: fields.id ?? 't',
  title: 'Task',
  description: '',
  status: 'todo',
  projectId: null,
  priority: 0,
  startDate: null,
  dueDate: null,
  dueTime: null,
  tags: [],
  completedAt: null,
  sort: 0,
  deletedAt: null,
  created: 0,
  updated: 0,
  revision: 1,
  ...fields,
})
const filter = (fields: Partial<TaskFilter> = {}): TaskFilter => ({
  ...blankFilter('f'),
  name: 'Filter',
  ...fields,
})
const matches = (t: Partial<Task>, f: Partial<TaskFilter>) => matchesFilter(task(t), filter(f), current)

it('matches every open task when no condition is set', () => {
  expect(matches({}, {})).toBe(true)
  expect(matches({ status: 'doing' }, {})).toBe(true)
  expect(matches({ status: 'done' }, {})).toBe(false)
  expect(matches({ deletedAt: 1 }, {})).toBe(false)
})

it('chooses open, completed or both, never cancelled', () => {
  expect(matches({ status: 'done' }, { status: 'done' })).toBe(true)
  expect(matches({ status: 'todo' }, { status: 'done' })).toBe(false)
  expect(matches({ status: 'done' }, { status: 'all' })).toBe(true)
  expect(matches({ status: 'todo' }, { status: 'all' })).toBe(true)
  expect(matches({ status: 'cancelled' }, { status: 'all' })).toBe(false)
})

it('requires every condition, and any option within one', () => {
  const f = { projects: ['p1', 'inbox'], tags: ['work', 'home'], priorities: [3, 2] as TaskFilter['priorities'] }
  expect(matches({ projectId: 'p1', tags: ['home'], priority: 2 }, f)).toBe(true)
  expect(matches({ projectId: null, tags: ['work', 'x'], priority: 3 }, f)).toBe(true)
  expect(matches({ projectId: 'p2', tags: ['work'], priority: 3 }, f)).toBe(false)
  expect(matches({ projectId: 'p1', tags: ['x'], priority: 3 }, f)).toBe(false)
  expect(matches({ projectId: 'p1', tags: ['work'], priority: 1 }, f)).toBe(false)
  expect(matches({ projectId: 'p1', tags: undefined, priority: 3 }, f)).toBe(false)
})

it('sorts due dates into buckets, with Next 7 days including today and tomorrow', () => {
  const due = (dueDate: string | null, dates: TaskFilter['dates']) => matches({ dueDate }, { dates })
  expect(due('2026-11-06', ['overdue'])).toBe(true)
  expect(due('2026-11-07', ['overdue'])).toBe(false)
  expect(due('2026-11-07', ['today'])).toBe(true)
  expect(due('2026-11-08', ['tomorrow'])).toBe(true)
  expect(due('2026-11-07', ['next7'])).toBe(true)
  expect(due('2026-11-08', ['next7'])).toBe(true)
  expect(due('2026-11-13', ['next7'])).toBe(true)
  expect(due('2026-11-14', ['next7'])).toBe(false)
  expect(due('2026-11-14', ['later'])).toBe(true)
  expect(due('2026-11-06', ['next7'])).toBe(false)
  expect(due(null, ['none'])).toBe(true)
  expect(due(null, ['today', 'overdue'])).toBe(false)
  expect(due('2026-11-01', ['today', 'overdue'])).toBe(true)
})

it('groups matching tasks Overdue, To do and Completed', () => {
  const tasks = [
    task({ id: 'late', dueDate: '2026-11-01', tags: ['work'] }),
    task({ id: 'soon', dueDate: '2026-11-09', tags: ['work'] }),
    task({ id: 'undated', tags: ['work'] }),
    task({ id: 'done', status: 'done', completedAt: 5, tags: ['work'] }),
    task({ id: 'other', dueDate: '2026-11-01' }),
  ]
  const groups = filterGroups(tasks, filter({ tags: ['work'], status: 'all' }), current)
  expect(groups.map((g) => [g.id, g.tasks.map((t) => t.id)])).toEqual([
    ['overdue', ['late']],
    ['open', ['soon', 'undated']],
    ['done', ['done']],
  ])
  expect(openFilterCount(tasks, filter({ tags: ['work'], status: 'all' }), current)).toBe(3)
})

it('drops invalid saved filters and fields without losing the rest', () => {
  const saved = normalizeTaskFilters([
    { id: 'a', name: '  Work  ', projects: ['p1', 'p1', 4], tags: ['#Deep Work', ''], priorities: [3, 9, 3], dates: ['today', 'someday'], status: 'nope' },
    { id: 'a', name: 'Duplicate id' },
    { id: 'b', name: '   ' },
    { id: 'bad id!', name: 'Bad id' },
    null,
    'text',
    { id: 'c', name: 'Done', status: 'done' },
  ])
  expect(saved).toEqual([
    { id: 'a', name: 'Work', projects: ['p1'], tags: ['deep-work'], priorities: [3], dates: ['today'], status: 'open' },
    { ...blankFilter('c'), name: 'Done', status: 'done' },
  ])
  expect(normalizeTaskFilters({})).toEqual([])
  expect(normalizeTaskFilters(Array.from({ length: 60 }, (_, i) => ({ id: `f${i}`, name: 'x' })))).toHaveLength(50)
})

it('describes the conditions in one line', () => {
  const projects = [
    { id: 'p1', name: 'Launch', deletedAt: null },
    { id: 'p2', name: 'Gone', deletedAt: 1 },
  ]
  expect(describeFilter(filter(), projects)).toBe('Open tasks from every project')
  expect(
    describeFilter(
      filter({ projects: ['p1', 'inbox'], tags: ['work'], priorities: [3], dates: ['today', 'overdue'], status: 'all' }),
      projects,
    ),
  ).toBe('Open and completed tasks · Launch or Inbox · #work · High priority · Today or Overdue')
  expect(describeFilter(filter({ projects: ['p2'] }), projects)).toBe('Open tasks · A deleted project')
})

it('starts new tasks so they usually land on the filter page', () => {
  expect(newTaskDefaults(filter({ projects: ['p1'], tags: ['a', 'b'], dates: ['next7'] }))).toEqual({
    projectId: 'p1',
    tags: ['a'],
    dueToday: true,
  })
  expect(newTaskDefaults(filter({ projects: ['p1', 'p2'] }))).toEqual({ projectId: null, tags: [], dueToday: false })
  expect(newTaskDefaults(filter({ projects: ['inbox'] })).projectId).toBeNull()
})
