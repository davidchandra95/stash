import { expect, it } from 'vitest'
import {
  hasUpcomingReminder,
  nextReminderAt,
  recentReminders,
  isCurrentSnooze,
  parseSnooze,
  reminderAnchor,
  reminderBody,
  reminderChoices,
  reminderEntries,
  reminderLabel,
  reminderTime,
  staleOverdue,
} from './reminders'
import type { Task } from './model'

const zone = 'Asia/Jakarta'
const at = (text: string) => Date.parse(text)
const task = (fields: Partial<Task> = {}): Task => ({
  id: 't1',
  title: 'Call the bank',
  description: '',
  status: 'todo',
  projectId: null,
  priority: 0,
  startDate: null,
  dueDate: null,
  dueTime: null,
  completedAt: null,
  sort: 1,
  deletedAt: null,
  created: 0,
  updated: 0,
  revision: 1,
  ...fields,
})
const start = at('2026-11-10T07:00:00Z') // 14:00 in Jakarta
const now = at('2026-11-04T00:00:00Z')
const point = { kind: 'point', start, timeZone: zone } as const

it('counts back from work time, then due time, then the due day at 09:00', () => {
  expect(reminderAnchor(task({ schedule: point }), zone)).toEqual({ at: start, kind: 'schedule' })
  expect(
    reminderAnchor(task({ schedule: { kind: 'range', start, end: start + 1000, timeZone: zone } }), zone),
  ).toEqual({ at: start, kind: 'schedule' })
  expect(reminderAnchor(task({ dueDate: '2026-11-10', dueTime: '16:30' }), zone)).toEqual({
    at: at('2026-11-10T09:30:00Z'),
    kind: 'due',
  })
  expect(reminderAnchor(task({ dueDate: '2026-11-10' }), zone)).toEqual({
    at: at('2026-11-10T02:00:00Z'),
    kind: 'day',
  })
  expect(
    reminderAnchor(
      task({ schedule: { kind: 'allDay', start: '2026-11-10', end: '2026-11-13' }, dueLinked: true }),
      zone,
    ),
  ).toEqual({ at: at('2026-11-12T02:00:00Z'), kind: 'day' })
  expect(reminderAnchor(task(), zone)).toBeNull()
})
it('keeps a legacy due time in a clock change schedulable', () => {
  const gap = reminderAnchor(task({ dueDate: '2026-03-08', dueTime: '02:30' }), 'America/New_York')
  expect(gap).toEqual({ at: at('2026-03-08T07:30:00Z'), kind: 'due' })
})
it('defaults to the moment itself, follows chosen offsets and allows none', () => {
  expect(reminderEntries([task({ schedule: point })], now, 64, zone)).toEqual([
    {
      id: `stash.task.t1.0.${start}`,
      title: 'Call the bank',
      body: 'Starts now',
      fireAt: start,
    },
  ])
  expect(
    reminderEntries([task({ schedule: point, reminders: [1440, 15] })], now, 64, zone).map(
      (entry) => [entry.fireAt, entry.body],
    ),
  ).toEqual([
    [start - 86_400_000, 'Starts in 1 day'],
    [start - 900_000, 'Starts in 15 minutes'],
  ])
  expect(reminderEntries([task({ schedule: point, reminders: [] })], now, 64, zone)).toEqual([])
})
it('schedules only future reminders of open, undeleted tasks', () => {
  const live = { schedule: point, reminders: [0, 60] }
  const late = start - 1_800_000
  expect(reminderEntries([task(live)], late, 64, zone).map((entry) => entry.fireAt)).toEqual([start])
  for (const fields of [{ status: 'done' }, { status: 'cancelled' }, { deletedAt: 1 }] as Partial<Task>[])
    expect(reminderEntries([task({ ...live, ...fields })], now, 64, zone)).toEqual([])
  expect(reminderEntries([task({ schedule: point })], start, 64, zone)).toEqual([])
})
it('keeps only the soonest within the system limit', () => {
  const tasks = [5, 1, 3].map((days) =>
    task({ id: `t${days}`, schedule: { ...point, start: start + days * 86_400_000 } }),
  )
  expect(reminderEntries(tasks, now, 2, zone).map((entry) => entry.id.split('.')[2])).toEqual([
    't1',
    't3',
  ])
  expect(reminderEntries(tasks, now, -1, zone)).toEqual([])
})
it('marks a task only while a reminder is still ahead', () => {
  expect(hasUpcomingReminder(task({ schedule: point }), now, zone)).toBe(true)
  expect(hasUpcomingReminder(task({ schedule: point }), start, zone)).toBe(false)
  expect(hasUpcomingReminder(task({ schedule: point, reminders: [] }), now, zone)).toBe(false)
  expect(hasUpcomingReminder(task({ schedule: point, status: 'done' }), now, zone)).toBe(false)
  expect(hasUpcomingReminder(task(), now, zone)).toBe(false)
})
it('parses snoozes and ends them when the task no longer matches', () => {
  const id = `stash.snooze.t1.${start}.${start + 600_000}`
  const snooze = parseSnooze(id)!
  expect(snooze).toEqual({ id, taskId: 't1', anchor: start, until: start + 600_000 })
  expect(parseSnooze(`stash.task.t1.0.${start}`)).toBeNull()
  expect(parseSnooze('stash.snooze.t1.x.y')).toBeNull()
  const open = task({ schedule: point })
  expect(isCurrentSnooze(snooze, [open], zone)).toBe(true)
  expect(isCurrentSnooze(snooze, [], zone)).toBe(false)
  expect(isCurrentSnooze(snooze, [{ ...open, status: 'done' }], zone)).toBe(false)
  expect(isCurrentSnooze(snooze, [{ ...open, reminders: [] }], zone)).toBe(false)
  expect(
    isCurrentSnooze(snooze, [{ ...open, schedule: { ...point, start: start + 1000 } }], zone),
  ).toBe(false)
})
it('describes reminders for the task and its notification', () => {
  expect(reminderLabel(0, 'schedule')).toBe('When it starts')
  expect(reminderLabel(0, 'due')).toBe('At due time')
  expect(reminderLabel(0, 'day')).toBe('On the day')
  expect(reminderLabel(90, 'due')).toBe('90 minutes before')
  expect(reminderLabel(10080, 'due')).toBe('1 week before')
  expect(reminderBody(0, 'day')).toBe('Due today')
  expect(reminderBody(0, 'due')).toBe('Due now')
  expect(reminderBody(120, 'due')).toBe('Due in 2 hours')
  expect(reminderTime(start, start - 1000, zone)).toBe('Today, 14:00')
  expect(reminderTime(start, now, zone)).toBe('Nov 10, 14:00')
  expect(reminderTime(start, at('2025-11-10T00:00:00Z'), zone)).toBe('Nov 10, 2026, 14:00')
})
it('offers day-sized choices for date-only tasks, keeping saved values', () => {
  expect(reminderChoices(task({ dueDate: '2026-11-10' }), zone)).toEqual([0, 1440, 2880, 10080])
  expect(reminderChoices(task({ dueDate: '2026-11-10', reminders: [30] }), zone)).toEqual([
    0, 30, 1440, 2880, 10080,
  ])
  expect(reminderChoices(task({ schedule: point }), zone)).toContain(5)
})
it('lets a late reminder deliver unless its task has changed', () => {
  const id = `stash.task.t1.15.${start}`
  const late = start - 60_000
  const open = task({ schedule: point, reminders: [15] })
  expect(staleOverdue([id], [open], late, zone)).toEqual([])
  expect(staleOverdue([id], [open], start - 3_600_000, zone)).toEqual([])
  expect(staleOverdue([id], [{ ...open, status: 'done' }], late, zone)).toEqual([id])
  expect(staleOverdue([id], [{ ...open, reminders: [] }], late, zone)).toEqual([id])
  expect(staleOverdue([id], [{ ...open, schedule: { ...point, start: start + 1000 } }], late, zone)).toEqual([id])
  expect(staleOverdue([id], [], late, zone)).toEqual([id])
  expect(staleOverdue([`stash.snooze.t1.${start}.${late}`], [], late, zone)).toEqual([])
})
it('lists passed reminders of open tasks from the last week, newest first', () => {
  const open = task({ schedule: point, reminders: [0, 60] })
  const after = start + 60_000
  expect(recentReminders([open], after, zone)).toEqual([
    { id: `stash.task.t1.0.${start}`, taskId: 't1', title: 'Call the bank', at: start, label: 'When it starts' },
    { id: `stash.task.t1.60.${start}`, taskId: 't1', title: 'Call the bank', at: start - 3_600_000, label: '1 hour before' },
  ])
  expect(recentReminders([open], start - 1_800_000, zone).map((item) => item.at)).toEqual([start - 3_600_000])
  expect(recentReminders([open], start + 8 * 86_400_000, zone)).toEqual([])
  for (const fields of [{ status: 'done' }, { status: 'cancelled' }, { deletedAt: 1 }, { reminders: [] }] as Partial<Task>[])
    expect(recentReminders([{ ...open, ...fields }], after, zone)).toEqual([])
})
it('finds the next reminder to wait for', () => {
  const open = task({ schedule: point, reminders: [0, 60] })
  expect(nextReminderAt([open], now, zone)).toBe(start - 3_600_000)
  expect(nextReminderAt([open], start - 1000, zone)).toBe(start)
  expect(nextReminderAt([open], start, zone)).toBeNull()
})
