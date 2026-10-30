import { expect, it } from 'vitest'
import { dueState, elapsed, formatDate, formatRange, health, progress, sortBetween, today } from './model'

const project = (fields = {}) => ({
  status: 'active' as const,
  startDate: '2026-10-01',
  endDate: '2026-10-31',
  ...fields,
})
const tasks = (done: number, open: number, cancelled = 0) => [
  ...Array.from({ length: done }, () => ({ status: 'done' as const })),
  ...Array.from({ length: open }, () => ({ status: 'todo' as const })),
  ...Array.from({ length: cancelled }, () => ({ status: 'cancelled' as const })),
]

it('counts progress without cancelled tasks', () => {
  expect(progress(tasks(2, 2, 3))).toEqual({ done: 2, total: 4, ratio: 0.5 })
  expect(progress(tasks(0, 0, 2))).toEqual({ done: 0, total: 0, ratio: null })
  expect(progress([])).toEqual({ done: 0, total: 0, ratio: null })
})

it('measures elapsed time within the project dates', () => {
  expect(elapsed(project(), '2026-10-16')).toBe(0.5)
  expect(elapsed(project(), '2026-09-01')).toBe(0)
  expect(elapsed(project(), '2026-12-01')).toBe(1)
  expect(elapsed(project({ startDate: null }), '2026-10-16')).toBeNull()
  expect(elapsed(project({ startDate: '2026-10-31' }), '2026-10-31')).toBe(1)
})

it('reports health for active projects with an end date', () => {
  // Half the time elapsed: 40% done is within 15 points; 30% is not.
  expect(health(project(), tasks(4, 6), '2026-10-16')).toBe('on_track')
  expect(health(project(), tasks(3, 7), '2026-10-16')).toBe('at_risk')
  expect(health(project(), tasks(10, 0), '2026-11-01')).toBe('overdue')
  expect(health(project({ startDate: null }), tasks(0, 5), '2026-10-30')).toBe('on_track')
  expect(health(project(), [], '2026-10-30')).toBe('on_track')
  expect(health(project(), tasks(0, 0, 4), '2026-10-30')).toBe('on_track')
  expect(health(project({ status: 'planned' }), tasks(0, 5), '2026-11-02')).toBeNull()
  expect(health(project({ endDate: null }), tasks(0, 5), '2026-11-02')).toBeNull()
})

it('classifies due dates against today', () => {
  const due = (dueDate: string | null, status = 'todo' as const) => dueState({ dueDate, status }, '2026-10-30')
  expect(due('2026-10-29')).toBe('late')
  expect(due('2026-10-30')).toBe('soon')
  expect(due('2026-11-01')).toBe('soon')
  expect(due('2026-11-02')).toBe('later')
  expect(due(null)).toBe('none')
  expect(dueState({ dueDate: '2026-10-01', status: 'done' }, '2026-10-30')).toBe('none')
})

it('formats calendar dates without shifting time zones', () => {
  expect(formatDate('2026-11-04', '2026-10-30')).toBe('Nov 4')
  expect(formatDate('2027-01-02', '2026-10-30')).toBe('Jan 2, 2027')
  expect(formatRange('2026-10-06', '2026-11-28', '2026-10-30')).toBe('Oct 6 – Nov 28')
  expect(formatRange(null, '2026-11-28', '2026-10-30')).toBe('Until Nov 28')
  expect(formatRange(null, null)).toBe('')
  expect(today(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
})

it('sorts between neighbours', () => {
  expect(sortBetween()).toBe(1)
  expect(sortBetween(undefined, 4)).toBe(3)
  expect(sortBetween(4)).toBe(5)
  expect(sortBetween(1, 2)).toBe(1.5)
})

it('summarizes projects for the overview', async () => {
  const { summarize } = await import('./model')
  const base = {
    description: '',
    completedAt: null,
    notebookId: null,
    color: '#428e8e',
    sort: 1,
    deletedAt: null,
    created: 1,
    updated: 1,
    revision: 1,
  }
  const projects = [
    { ...base, id: 'p', name: 'P', status: 'active' as const, startDate: '2026-10-01', endDate: '2026-10-31' },
    { ...base, id: 'gone', name: 'Gone', status: 'active' as const, startDate: null, endDate: null, deletedAt: 5 },
  ]
  const task = (status: 'todo' | 'doing' | 'done' | 'cancelled', dueDate: string | null = null, deletedAt: number | null = null) => ({
    id: Math.random().toString(36).slice(2),
    title: 't',
    description: '',
    status,
    projectId: 'p',
    priority: 0 as const,
    startDate: null,
    dueDate,
    completedAt: null,
    sort: 1,
    deletedAt,
    created: 1,
    updated: 1,
    revision: 1,
  })
  const [row] = summarize(
    projects,
    [task('done'), task('todo', '2026-10-20'), task('doing'), task('cancelled'), task('todo', null, 9)],
    '2026-10-25',
  )
  expect(summarize(projects, [], '2026-10-25')).toHaveLength(1)
  expect(row).toMatchObject({ open: 2, overdue: 1, health: 'at_risk' })
  expect(row.progress).toEqual({ done: 1, total: 3, ratio: 1 / 3 })
})

it('sorts overview rows with missing values last', async () => {
  const { sortSummaries } = await import('./model')
  const row = (name: string, fields: Record<string, unknown>) =>
    ({
      project: { name, status: 'active', endDate: null, ...fields },
      progress: { done: 0, total: 0, ratio: null, ...(fields.progress as object) },
      health: null,
      open: 0,
      ...fields,
    }) as unknown as Parameters<typeof sortSummaries>[0][number]
  const rows = [
    row('Calm', { health: 'on_track', endDate: '2026-12-01' }),
    row('Late', { health: 'overdue', endDate: '2026-10-01' }),
    row('Someday', { status: 'planned' }),
    row('Risky', { health: 'at_risk', endDate: '2026-11-01' }),
  ]
  const names = (key: Parameters<typeof sortSummaries>[1], desc = false) =>
    sortSummaries(rows, key, desc).map((r) => r.project.name)
  expect(names('health')).toEqual(['Late', 'Risky', 'Calm', 'Someday'])
  expect(names('health', true)).toEqual(['Calm', 'Risky', 'Late', 'Someday'])
  expect(names('name')).toEqual(['Calm', 'Late', 'Risky', 'Someday'])
  expect(names('status')).toEqual(['Calm', 'Late', 'Risky', 'Someday'])
})

it('groups tasks for Today and Upcoming', async () => {
  const { todayGroups, upcomingGroups } = await import('./model')
  const at = (date: string) => new Date(`${date}T12:00:00`).getTime()
  const t = (id: string, dueDate: string | null, fields: Record<string, unknown> = {}) =>
    ({
      id,
      title: id,
      description: '',
      status: 'todo',
      projectId: null,
      priority: 0,
      startDate: null,
      dueDate,
      completedAt: null,
      sort: 1,
      deletedAt: null,
      created: 1,
      updated: 1,
      revision: 1,
      ...fields,
    }) as import('./model').Task
  const tasks = [
    t('late', '2026-10-28'),
    t('now', '2026-10-30'),
    t('doneNow', '2026-10-30', { status: 'done', completedAt: at('2026-10-30') }),
    t('doneBefore', '2026-10-29', { status: 'done', completedAt: at('2026-10-29') }),
    t('lateDoneToday', '2026-10-01', { status: 'done', completedAt: at('2026-10-30') }),
    t('tomorrow', '2026-10-31'),
    t('sunday', '2026-11-01', { priority: 3 }),
    t('sundayLow', '2026-11-01'),
    t('later', '2026-11-20'),
    t('nextYear', '2027-01-05'),
    t('none', null),
    t('cancelled', '2026-10-31', { status: 'cancelled' }),
    t('deleted', '2026-10-30', { deletedAt: 1 }),
  ]
  const ids = (groups: { id: string; label: string; tasks: { id: string }[] }[]) =>
    groups.map((g) => `${g.label}: ${g.tasks.map((x) => x.id).join(',')}`)
  expect(ids(todayGroups(tasks, '2026-10-30'))).toEqual([
    'Overdue: late',
    'Today: now,lateDoneToday,doneNow',
  ])
  expect(ids(upcomingGroups(tasks, '2026-10-30'))).toEqual([
    'Tomorrow: tomorrow',
    'Sunday, Nov 1: sunday,sundayLow',
    'Later in November: later',
    'January 2027: nextYear',
  ])
})

it('lays out a timeline by month', async () => {
  const { timelineRange, timelinePosition } = await import('./model')
  expect(timelineRange([{ startDate: null, endDate: null }])).toBeNull()
  const range = timelineRange(
    [
      { startDate: '2026-10-06', endDate: '2026-11-28' },
      { startDate: null, endDate: '2026-12-09' },
    ],
    '2026-10-30',
  )!
  expect(range).toEqual({
    start: '2026-09-01',
    end: '2027-01-31',
    months: ['2026-09-01', '2026-10-01', '2026-11-01', '2026-12-01', '2027-01-01'],
  })
  expect(timelinePosition(range, '2026-09-01')).toBe(0)
  expect(timelinePosition(range, '2025-01-01')).toBe(0)
  expect(timelinePosition(range, '2027-03-01')).toBe(1)
  expect(timelinePosition(range, '2026-11-16')).toBeCloseTo(76 / 153)
})
