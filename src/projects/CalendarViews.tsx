import { useMemo, type DragEvent, type PointerEvent, type ReactNode } from 'react'
import { Check, Flag, Plus } from '../icons'
import { notebookColorValue } from '../notebookColors'
import {
  boardPlacements,
  calendarItems,
  type BoardPlacement,
  type CalendarItem,
} from './calendarLayout'
import { addDays, calendarDate, weekStart } from './schedule'
import { dueState, type Project, type Task } from './model'

type Layout = { allDay: CalendarItem[]; timed: CalendarItem[] }
const weekdays = (first: string) =>
  Array.from({ length: 7 }, (_, i) =>
    calendarDate(addDays(first, i)).toLocaleString('en-US', { weekday: 'short' }),
  )
const className = (...names: (string | false)[]) => names.filter(Boolean).join(' ')

interface BoardProps {
  days: string[]
  /** The month being shown, as YYYY-MM. Days around it are dimmed. Null for Multi-Week. */
  month: string | null
  current: string
  firstDay: number
  tasks: Task[]
  zone: string
  showCompleted: boolean
  disabled: boolean
  ghost: { days?: [string, string]; timed?: { day: string }[]; label: string } | null
  renderItem: (
    item: CalendarItem,
    timed: boolean,
    bar: Omit<BoardPlacement, 'item'> & { days: string[] },
  ) => ReactNode
  onShowDay: (day: string) => void
  onBeginCreate: (event: PointerEvent, day: string) => void
  onAddDay: (day: string) => void
  onDragOver: (event: DragEvent<HTMLDivElement>) => void
  onDrop: (event: DragEvent<HTMLDivElement>) => void
  onDragLeave: (event: DragEvent<HTMLDivElement>) => void
}

/** Month and Multi-Week: a row per week, where each day grows to show all of its tasks. */
export function CalendarBoard({
  days,
  month,
  current,
  tasks,
  zone,
  showCompleted,
  disabled,
  ghost,
  renderItem,
  onShowDay,
  onBeginCreate,
  onAddDay,
  onDragOver,
  onDrop,
  onDragLeave,
}: BoardProps) {
  const weeks = useMemo(
    () =>
      Array.from({ length: days.length / 7 }, (_, i) => {
        const week = days.slice(i * 7, i * 7 + 7)
        const { allDay, timed } = calendarItems(tasks, week, zone, showCompleted)
        return { week, ...boardPlacements(allDay, timed, week) }
      }),
    [days, tasks, zone, showCompleted],
  )
  const ghostDays =
    ghost?.days ??
    (ghost?.timed?.length ? [ghost.timed[0].day, ghost.timed.at(-1)!.day] : null)
  return (
    <div
      className="calendar-board"
      style={{ gridTemplateRows: `auto repeat(${weeks.length}, minmax(112px, 1fr))` }}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragLeave={onDragLeave}
    >
      <div className="calendar-board-weekdays">
        {weekdays(days[0]).map((name) => (
          <span key={name}>{name}</span>
        ))}
      </div>
      {weeks.map(({ week, placements, rows }) => {
        const from = ghostDays ? week.findIndex((day) => day >= ghostDays[0]) : -1
        const to = ghostDays ? week.filter((day) => day <= ghostDays[1]).length - 1 : -1
        return (
          <div
            key={week[0]}
            className="calendar-board-week"
            style={{ gridTemplateRows: `32px repeat(${rows}, auto) 1fr` }}
          >
            {week.map((day, index) => (
              <div
                key={day}
                className={className(
                  'calendar-all-day-cell',
                  'calendar-board-cell',
                  day === current && 'is-today',
                  !!month && day.slice(0, 7) !== month && 'is-outside',
                )}
                data-calendar-day={day}
                style={{ gridColumn: index + 1 }}
              >
                <button
                  className="calendar-all-day-add"
                  aria-label={`Add all-day task on ${day}`}
                  disabled={disabled}
                  onPointerDown={(event) => onBeginCreate(event, day)}
                  onClick={(event) => {
                    if (event.detail === 0) onAddDay(day)
                  }}
                >
                  <Plus aria-hidden="true" />
                </button>
                <button
                  className="calendar-board-day"
                  aria-label={`Show ${day}`}
                  onClick={() => onShowDay(day)}
                >
                  {day.endsWith('-01')
                    ? calendarDate(day).toLocaleString('en-US', { month: 'short', day: 'numeric' })
                    : Number(day.slice(-2))}
                </button>
              </div>
            ))}
            {placements.map(({ item, ...bar }) =>
              renderItem(item, false, { ...bar, row: bar.row + 2, days: week }),
            )}
            {from >= 0 && to >= from && (
              <div
                className="calendar-ghost is-all-day"
                style={{ gridColumn: `${from + 1} / span ${to - from + 1}` }}
              >
                {ghost?.label}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** Twelve small months. A day with tasks has a mark, and opening it shows that day. */
export function CalendarYear({
  year,
  current,
  firstDay,
  layout,
  onShowDay,
  onShowMonth,
}: {
  year: string
  current: string
  firstDay: number
  layout: Layout
  onShowDay: (day: string) => void
  onShowMonth: (day: string) => void
}) {
  const counts = useMemo(() => {
    const result = new Map<string, number>()
    for (const { day } of [...layout.allDay, ...layout.timed])
      result.set(day, (result.get(day) ?? 0) + 1)
    return result
  }, [layout])
  const names = weekdays(weekStart(`${year}-01-01`, firstDay))
  return (
    <div className="calendar-year">
      {Array.from({ length: 12 }, (_, index) => {
        const first = calendarDate(`${year}-${String(index + 1).padStart(2, '0')}-01`)
        const lead = calendarDate(weekStart(first.toString(), firstDay)).until(first).days
        const key = first.toString()
        return (
          <section key={key} className="calendar-year-month">
            <button className="calendar-year-title" onClick={() => onShowMonth(key)}>
              {first.toLocaleString('en-US', { month: 'long' })}
            </button>
            <div className="calendar-year-days">
              {names.map((name) => (
                <span key={name} aria-hidden="true">
                  {name[0]}
                </span>
              ))}
              {/* Always six weeks, so every month lines up. Days around it are only context. */}
              {Array.from({ length: 42 }, (_, i) => {
                const day = addDays(key, i - lead)
                if (day.slice(0, 7) !== key.slice(0, 7))
                  return (
                    <span key={day} className="is-outside" aria-hidden="true">
                      {Number(day.slice(-2))}
                    </span>
                  )
                const count = counts.get(day) ?? 0
                return (
                  <button
                    key={day}
                    className={className(day === current && 'is-today', count > 0 && 'has-tasks')}
                    aria-label={`Show ${day}${count ? `, ${count} ${count === 1 ? 'task' : 'tasks'}` : ''}`}
                    onClick={() => onShowDay(day)}
                  >
                    {Number(day.slice(-2))}
                  </button>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}

/** The next 30 days as a list. A task spanning several days is listed where it first appears. */
export function CalendarAgenda({
  layout,
  current,
  nowMinute,
  disabled,
  selectedId,
  projects,
  onSelect,
  onToggle,
}: {
  layout: Layout
  current: string
  nowMinute: number
  disabled: boolean
  selectedId: string | null
  projects: Project[]
  onSelect: (id: string, trigger: HTMLElement) => void
  onToggle: (task: Task) => void
}) {
  const groups = useMemo(() => {
    const seen = new Set<string>()
    const result = new Map<string, { item: CalendarItem; timed: boolean }[]>()
    const items = [
      ...layout.allDay.map((item) => ({ item, timed: false })),
      ...[...layout.timed]
        .sort((a, b) => a.start - b.start)
        .map((item) => ({ item, timed: true })),
    ].sort((a, b) => a.item.day.localeCompare(b.item.day))
    for (const entry of items) {
      const key = `${entry.item.task.id}:${entry.item.marker}`
      if (seen.has(key)) continue
      seen.add(key)
      result.set(entry.item.day, [...(result.get(entry.item.day) ?? []), entry])
    }
    return [...result]
  }, [layout])
  if (!groups.length) return <p className="task-empty calendar-agenda-empty">Nothing planned in these 30 days.</p>
  return (
    <div className="calendar-agenda">
      {groups.map(([day, entries]) => (
        <section key={day}>
          <h2 className={day === current ? 'is-today' : undefined}>
            {calendarDate(day).toLocaleString('en-US', {
              weekday: 'long',
              month: 'short',
              day: 'numeric',
            })}
            {day === current && <span> · Today</span>}
          </h2>
          {entries.map(({ item, timed }) => {
            const { task, marker } = item
            const project = projects.find((p) => p.id === task.projectId)
            const color = notebookColorValue(project?.color)
            const late = marker && dueState(task, current) === 'late'
            const past =
              !marker && (day < current || (timed && day === current && item.end <= nowMinute))
            return (
              <div
                key={`${task.id}:${marker}`}
                className={className(
                  'calendar-agenda-row',
                  task.status === 'done' ? 'is-done' : past && 'is-past',
                  late && 'is-late',
                  selectedId === task.id && 'is-selected',
                )}
              >
                <button
                  className="calendar-complete"
                  role="checkbox"
                  aria-checked={task.status === 'done'}
                  aria-label={`${task.status === 'done' ? 'Reopen' : 'Complete'} ${task.title}`}
                  disabled={disabled}
                  onClick={() => onToggle(task)}
                >
                  <span className={`task-check is-${task.status}`}>
                    {task.status === 'done' && <Check aria-hidden="true" className="ui-icon" />}
                  </span>
                </button>
                <button
                  className="calendar-agenda-open"
                  disabled={disabled}
                  aria-label={`Open ${task.title}, ${item.label}, ${project?.name || 'Inbox'}`}
                  onClick={(event) => onSelect(task.id, event.currentTarget)}
                >
                  <time>{marker ? (late ? 'Overdue' : 'Due') : timed ? item.clock : 'All day'}</time>
                  <strong>
                    {marker && <Flag aria-hidden="true" className="calendar-due-flag" />}
                    {task.title}
                  </strong>
                  <small style={color ? { color } : undefined}>{project?.name || 'Inbox'}</small>
                </button>
              </div>
            )
          })}
        </section>
      ))}
    </div>
  )
}
