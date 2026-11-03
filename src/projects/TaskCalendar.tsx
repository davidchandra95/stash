import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type DragEvent,
} from 'react'
import CalendarOptions, { readCalendarOptions } from './CalendarOptions'
import CalendarDraft from './CalendarDraft'
import { Calendar, Check, ChevronLeft, ChevronRight, Plus } from '../icons'
import AppTooltip from '../components/AppTooltip'
import { moveDueMarker, saveTaskSchedule, toggleTask, type Notify } from './actions'
import {
  calendarItems,
  calendarSchedule,
  isUnscheduled,
  moveSchedule,
  type CalendarItem,
} from './calendarLayout'
import {
  addDays,
  calendarDate,
  dayAt,
  displayZone,
  subscribeDisplayZone,
  weekStart,
  type TaskSchedule,
} from './schedule'
import { formatDate, today, type Project, type Task } from './model'
import { scheduleDraft, type ScheduleDraft } from './ScheduleEditor'

interface Props {
  tasks: Task[]
  projects: Project[]
  disabled: boolean
  selectedId: string | null
  onSelect: (id: string | null) => void
  notify: Notify
  mobile?: boolean
}
const clockLabel = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
const dragType = 'application/x-stash-calendar-task'

/** Shared desktop week and touch day/three-day surface. All edits use the task store. */
export default function TaskCalendar({
  tasks,
  projects,
  disabled,
  selectedId,
  onSelect,
  notify,
  mobile = false,
}: Props) {
  const [date, setDate] = useState(() => {
    try {
      const saved = localStorage.getItem('stash-calendar-date')
      if (saved) {
        calendarDate(saved)
        return saved
      }
    } catch {
      /* Use today. */
    }
    return today()
  })
  const [options, setOptions] = useState(readCalendarOptions)
  // Each half-hour slot is at least 48px tall on touch screens.
  const zoom = options.zoom + (mobile ? 56 : 0)
  const [mode, setMode] = useState<'week' | 'day' | 'three'>(mobile ? 'day' : 'week')
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [arrange, setArrange] = useState(false)
  const [filter, setFilter] = useState('*')
  const [draft, setDraft] = useState<ScheduleDraft | null>(null)
  const [error, setError] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const [preview, setPreview] = useState('')
  const [focusSlot, setFocusSlot] = useState<{ day: string; minute: number } | null>(null)
  const detailTrigger = useRef<HTMLElement | null>(null)
  const [now, setNow] = useState(Date.now())
  const scroll = useRef<HTMLDivElement>(null)
  const overflowList = useRef<HTMLDivElement>(null)
  const cancelGesture = useRef<(() => void) | null>(null)
  const draftRef = useRef<HTMLButtonElement>(null)
  const draftTrigger = useRef<HTMLElement | null>(null)
  const daysCount = mode === 'week' ? 7 : mode === 'three' ? 3 : 1
  const denseLanes = mobile && daysCount === 3 ? 2 : 3
  const start = mode === 'week' ? weekStart(date, options.firstDay) : date
  const days = useMemo(
    () => Array.from({ length: daysCount }, (_, i) => addDays(start, i)),
    [start, daysCount],
  )
  const zone = useSyncExternalStore(subscribeDisplayZone, displayZone)
  const current = dayAt(now, zone)
  const layout = useMemo(
    () => calendarItems(tasks, days, zone, options.completed, ((mobile ? 48 : 32) / zoom) * 60),
    [tasks, days, zone, options.completed, zoom, mobile],
  )
  const projectName = (task: Task) => projects.find((p) => p.id === task.projectId)?.name || 'Inbox'
  const height = (options.lastHour - options.firstHour) * zoom
  const unscheduled = tasks
    .filter(isUnscheduled)
    .filter((t) => filter === '*' || (t.projectId ?? '') === filter)

  useEffect(() => {
    try {
      localStorage.setItem('stash-calendar-date', date)
    } catch {
      /* Session still works. */
    }
  }, [date])
  useEffect(() => {
    try {
      localStorage.setItem('stash-calendar-options', JSON.stringify(options))
    } catch {
      /* Session still works. */
    }
  }, [options])
  useEffect(() => {
    const refresh = () => setNow(Date.now())
    const timer = setInterval(refresh, 30_000)
    window.addEventListener('focus', refresh)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', refresh)
      cancelGesture.current?.()
    }
  }, [])
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = Math.max(0, 8 - options.firstHour) * zoom
  }, [zoom, options.firstHour])

  const openDraftFields = (
    schedule: ScheduleDraft,
    trigger = document.activeElement as HTMLElement | null,
  ) => {
    draftTrigger.current = trigger
    setError('')
    setDraft(schedule)
  }
  const openDraft = (schedule: TaskSchedule | null) =>
    openDraftFields(scheduleDraft(schedule, zone))
  const openPoint = (day: string, minute: number, trigger?: HTMLElement) =>
    openDraftFields(
      {
        ...scheduleDraft(null, zone),
        kind: 'point',
        date: day,
        time: clockLabel(minute),
        endDate: day,
      },
      trigger,
    )
  const selectTask = (id: string, trigger: HTMLElement, schedule = false) => {
    detailTrigger.current = trigger
    onSelect(id)
    if (!mobile)
      requestAnimationFrame(() => {
        const detail = document.querySelector('[data-pane="task"]')
        detail
          ?.querySelector<HTMLElement>(schedule ? '.schedule-editor select' : '.task-title-input')
          ?.focus({ preventScroll: true })
      })
  }
  useEffect(() => {
    if (selectedId === null && detailTrigger.current) {
      if (detailTrigger.current.isConnected) detailTrigger.current.focus({ preventScroll: true })
      else draftRef.current?.focus()
      detailTrigger.current = null
    }
  }, [selectedId])
  const report = (error: unknown) => {
    setError(String(error))
    setPreview('')
  }
  const apply = async (
    task: Task,
    day: string,
    minute: number | null,
    marker = false,
    sourceDay?: string,
  ) => {
    try {
      setError('')
      if (marker) await moveDueMarker(task, day, notify)
      else {
        const schedule = task.schedule ?? calendarSchedule(task, zone)
        if (sourceDay && schedule?.kind === 'allDay' && minute === null) {
          const delta = calendarDate(sourceDay).until(calendarDate(day)).days
          day = addDays(schedule.start, delta)
        }
        await saveTaskSchedule(task, moveSchedule(schedule, day, minute, zone), notify)
      }
      setAnnouncement(
        `Moved ${task.title} to ${day}${minute === null ? '' : ` at ${Math.floor(minute / 60)}:${String(minute % 60).padStart(2, '0')}`}`,
      )
    } catch (error) {
      report(error)
    }
  }
  const locate = (x: number, y: number) => {
    const element = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-calendar-day]')
    if (!element) return null
    const day = element.dataset.calendarDay!
    const timed = element.classList.contains('calendar-day-column')
    const rect = element.getBoundingClientRect()
    const minute = timed
      ? Math.max(
          options.firstHour * 60,
          Math.min(
            options.lastHour * 60 - 15,
            Math.floor((((y - rect.top) / zoom) * 60 + options.firstHour * 60) / 15) * 15,
          ),
        )
      : null
    return { day, minute }
  }
  // A gesture is temporary until release. Escape, pointer cancellation and unmount never save.
  const gesture = (
    x: number,
    y: number,
    commit: (end: { day: string; minute: number | null }, moved: boolean) => void,
  ) => {
    cancelGesture.current?.()
    let end = locate(x, y)
    let moved = false
    const move = (event: PointerEvent) => {
      moved ||= Math.hypot(event.clientX - x, event.clientY - y) > 5
      end = locate(event.clientX, event.clientY) ?? end
      if (end && moved)
        setPreview(
          `${end.day}${end.minute === null ? ' · All day' : ` · ${String(Math.floor(end.minute / 60)).padStart(2, '0')}:${String(end.minute % 60).padStart(2, '0')}`}`,
        )
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', key)
      cancelGesture.current = null
      setPreview('')
    }
    const cancel = () => cleanup()
    const up = (event: PointerEvent) => {
      const released = locate(event.clientX, event.clientY)
      cleanup()
      if (released) commit(released, moved)
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        cancel()
      }
    }
    cancelGesture.current = cancel
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', key)
  }
  const beginCreate = (event: React.PointerEvent, day: string, minute: number | null) => {
    if (disabled || event.button !== 0 || event.pointerType === 'touch') return
    event.preventDefault()
    const trigger = event.currentTarget as HTMLElement
    const anchor = locate(event.clientX, event.clientY) ?? { day, minute }
    gesture(event.clientX, event.clientY, (end, moved) => {
      try {
        if (anchor.minute === null || end.minute === null) {
          const ordered = [anchor.day, end.day].sort()
          openDraftFields(
            scheduleDraft({ kind: 'allDay', start: ordered[0], end: addDays(ordered[1], 1) }, zone),
            trigger,
          )
        } else {
          if (!moved) return openPoint(anchor.day, anchor.minute, trigger)
          const points = [
            { day: anchor.day, minute: anchor.minute },
            { day: end.day, minute: end.minute },
          ].sort((a, b) => a.day.localeCompare(b.day) || a.minute - b.minute)
          const [first, last] = points
          const endMinute = last.minute + 15
          openDraftFields(
            {
              ...scheduleDraft(null, zone),
              kind: 'range',
              date: first.day,
              time: clockLabel(first.minute),
              endDate: endMinute === 1440 ? addDays(last.day, 1) : last.day,
              endTime: clockLabel(endMinute % 1440),
            },
            trigger,
          )
        }
      } catch (error) {
        report(error)
      }
    })
  }
  const resize = (event: React.PointerEvent, item: CalendarItem, edge: 'start' | 'end') => {
    event.stopPropagation()
    event.preventDefault()
    const schedule = item.task.schedule
    if (!schedule || disabled) return
    gesture(event.clientX, event.clientY, async (end, moved) => {
      if (!moved) return
      try {
        let next: TaskSchedule = schedule
        if (schedule.kind === 'allDay')
          next = { ...schedule, [edge]: edge === 'end' ? addDays(end.day, 1) : end.day }
        else if (schedule.kind === 'range' && end.minute !== null) {
          const point = moveSchedule(null, end.day, end.minute, zone)
          if (point.kind === 'point') next = { ...schedule, [edge]: point.start }
        }
        await saveTaskSchedule(item.task, next, notify)
        setAnnouncement(`Resized ${item.task.title}`)
      } catch (error) {
        report(error)
      }
    })
  }
  const drop = (event: DragEvent, day: string, minute: number | null) => {
    event.preventDefault()
    setPreview('')
    try {
      const data = JSON.parse(event.dataTransfer.getData(dragType))
      const task = tasks.find((t) => t.id === data.id)
      if (task && !disabled)
        void apply(
          task,
          day,
          minute,
          data.marker === true,
          typeof data.sourceDay === 'string' ? data.sourceDay : undefined,
        )
    } catch {
      /* Ignore drops from other applications. */
    }
  }
  const startDrag = (event: DragEvent, task: Task, marker = false, sourceDay?: string) => {
    event.dataTransfer.setData(dragType, JSON.stringify({ id: task.id, marker, sourceDay }))
    event.dataTransfer.effectAllowed = 'move'
  }
  const renderItem = (item: CalendarItem, timed = false) => {
    const { task } = item
    const top =
      ((Math.max(item.start, options.firstHour * 60) - options.firstHour * 60) / 60) * zoom
    const bottom = Math.min(item.end, options.lastHour * 60)
    const hidden =
      timed && (item.end <= options.firstHour * 60 || item.start >= options.lastHour * 60)
    if (hidden) return null
    return (
      <div
        key={`${task.id}:${item.marker}`}
        className={`calendar-item ${item.lanes >= denseLanes ? 'is-dense' : ''} ${timed ? 'is-timed' : ''} ${task.status === 'done' ? 'is-done' : ''} ${selectedId === task.id ? 'is-selected' : ''}`}
        data-task-id={task.id}
        data-marker={item.marker}
        draggable={!disabled && !mobile}
        onDragStart={(event) => startDrag(event, task, item.marker, item.day)}
        onDragEnd={() => setPreview('')}
        style={
          timed
            ? {
                top,
                height: Math.max(
                  mobile ? 48 : 32,
                  ((bottom - Math.max(item.start, options.firstHour * 60)) / 60) * zoom,
                ),
                left: `${(item.lane / item.lanes) * 100}%`,
                width: `${100 / item.lanes}%`,
              }
            : { gridRow: item.lane + 1 }
        }
      >
        <button
          className="calendar-complete"
          role="checkbox"
          aria-checked={task.status === 'done'}
          aria-label={`${task.status === 'done' ? 'Reopen' : 'Complete'} ${task.title}`}
          disabled={disabled}
          onClick={() => toggleTask(task)}
        >
          {task.status === 'done' ? (
            <Check aria-hidden="true" className="ui-icon" />
          ) : (
            <span className="calendar-empty-check" />
          )}
        </button>
        <AppTooltip label={`${task.title} · ${projectName(task)} · ${item.label}`}>
          <button
            className="calendar-item-open"
            disabled={disabled}
            onClick={(event) => selectTask(task.id, event.currentTarget)}
            aria-label={`Open ${task.title}, ${item.label}, ${projectName(task)}`}
          >
            <strong>{task.title}</strong>
            <small>
              {item.marker ? 'Due · ' : ''}
              {timed ? `${item.label} · ` : ''}
              {projectName(task)}
            </small>
          </button>
        </AppTooltip>
        {!item.marker && task.schedule && task.schedule.kind !== 'point' && (
          <>
            <span
              className={`calendar-resize is-start ${timed ? '' : 'is-day-edge'}`}
              onPointerDown={(event) => resize(event, item, 'start')}
              aria-hidden="true"
            />
            <span
              className={`calendar-resize is-end ${timed ? '' : 'is-day-edge'}`}
              onPointerDown={(event) => resize(event, item, 'end')}
              aria-hidden="true"
            />
          </>
        )}
      </div>
    )
  }
  const visibleTimed = layout.timed.filter(
    (item) => item.end > options.firstHour * 60 && item.start < options.lastHour * 60,
  )
  const visibleSet = new Set(visibleTimed)
  const hiddenItems = layout.timed.filter((item) => !visibleSet.has(item))
  const denseItems = visibleTimed.filter((item) => item.lanes >= denseLanes)
  const navigate = (amount: number) => {
    try {
      setDate(addDays(start, amount * daysCount))
    } catch (error) {
      report(error)
    }
  }
  return (
    <div
      className={`task-calendar ${mobile ? 'is-mobile' : ''}`}
      style={
        {
          '--calendar-days': daysCount,
          '--calendar-hour': `${zoom}px`,
          '--calendar-all-day': `${options.allDayHeight}px`,
        } as CSSProperties
      }
      aria-label="Task calendar"
    >
      <div className="calendar-toolbar">
        <Calendar className="ui-icon" aria-hidden="true" />
        <h1>Calendar</h1>
        <div className="calendar-navigation">
          <button className="icon-btn" aria-label="Previous period" onClick={() => navigate(-1)}>
            <ChevronLeft />
          </button>
          <button className="btn btn-plain" onClick={() => setDate(current)}>
            Today
          </button>
          <button className="icon-btn" aria-label="Next period" onClick={() => navigate(1)}>
            <ChevronRight />
          </button>
        </div>
        <span className="calendar-range">
          {formatDate(start)}
          {daysCount > 1 ? ` - ${formatDate(days.at(-1)!)}` : ''}
        </span>
        <select
          className="field"
          aria-label="Calendar view"
          value={mode}
          onChange={(event) => setMode(event.target.value as typeof mode)}
        >
          {!mobile && <option value="week">Week</option>}
          <option value="day">Day</option>
          <option value="three">3 days</option>
        </select>
        <div className="calendar-tools">
          <button
            className="btn btn-plain"
            aria-expanded={arrange}
            onClick={() => setArrange(!arrange)}
          >
            Arrange tasks
          </button>
          <button
            className="btn btn-plain"
            aria-expanded={optionsOpen}
            onClick={() => setOptionsOpen(!optionsOpen)}
          >
            View options
          </button>
          <button
            ref={draftRef}
            className="btn"
            disabled={disabled}
            onClick={() => openDraft({ kind: 'allDay', start: date, end: addDays(date, 1) })}
          >
            <Plus className="ui-icon" />
            Add task
          </button>
        </div>
      </div>
      {optionsOpen && (
        <CalendarOptions options={options} setOptions={setOptions} zone={zone} report={setError} />
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <div className="calendar-zone">
        {zone}
        {preview && <span>{preview}</span>}
        {(denseItems.length > 0 || hiddenItems.length > 0) && (
          <button className="btn btn-plain btn-sm" onClick={() => overflowList.current?.focus()}>
            More tasks ({denseItems.length + hiddenItems.length})
          </button>
        )}
        <span role="status" className="sr-only">
          {preview || announcement}
        </span>
      </div>
      <div className={`calendar-workspace ${arrange ? 'has-arrange' : ''}`}>
        <div className="calendar-scroll" ref={scroll}>
          <div className="calendar-grid">
            <div className="calendar-sticky">
              <div className="calendar-day-headings">
                <span />
                {days.map((day) => (
                  <div key={day} className={day === current ? 'is-today' : ''}>
                    <span>{calendarDate(day).toLocaleString('en-US', { weekday: 'short' })}</span>
                    <strong>{Number(day.slice(-2))}</strong>
                  </div>
                ))}
              </div>
              <div className="calendar-all-day">
                <span className="calendar-gutter">All day</span>
                {days.map((day) => (
                  <div
                    key={day}
                    className="calendar-all-day-cell"
                    data-calendar-day={day}
                    onPointerDown={(event) => {
                      if (event.target === event.currentTarget) beginCreate(event, day, null)
                    }}
                    onClick={(event) => {
                      if (mobile && !disabled && event.target === event.currentTarget)
                        openDraft({ kind: 'allDay', start: day, end: addDays(day, 1) })
                    }}
                    onDragOver={(event) => {
                      if (event.dataTransfer.types.includes(dragType)) {
                        event.preventDefault()
                        setPreview(`${day} · All day`)
                      }
                    }}
                    onDrop={(event) => drop(event, day, null)}
                  >
                    <button
                      className="calendar-all-day-add"
                      aria-label={`Add all-day task on ${day}`}
                      disabled={disabled}
                      onPointerDown={(event) => beginCreate(event, day, null)}
                      onClick={(event) => {
                        if (event.detail === 0 || mobile)
                          openDraft({ kind: 'allDay', start: day, end: addDays(day, 1) })
                      }}
                    >
                      <Plus aria-hidden="true" />
                    </button>
                    {layout.allDay
                      .filter((item) => item.day === day)
                      .map((item) => renderItem(item))}
                  </div>
                ))}
              </div>
            </div>
            <div className="calendar-time-grid" style={{ height }}>
              <div className="calendar-hours">
                {Array.from({ length: options.lastHour - options.firstHour }, (_, i) => (
                  <span key={i} style={{ top: i * zoom }}>
                    {String(i + options.firstHour).padStart(2, '0')}:00
                  </span>
                ))}
              </div>
              {days.map((day) => (
                <div
                  key={day}
                  data-calendar-day={day}
                  className={`calendar-day-column ${day === current ? 'is-today' : ''}`}
                  onDragOver={(event) => {
                    if (event.dataTransfer.types.includes(dragType)) {
                      event.preventDefault()
                      const end = locate(event.clientX, event.clientY)
                      setPreview(
                        `${day} · ${Math.floor((end?.minute ?? 0) / 60)}:${String((end?.minute ?? 0) % 60).padStart(2, '0')}`,
                      )
                    }
                  }}
                  onDrop={(event) =>
                    drop(
                      event,
                      day,
                      locate(event.clientX, event.clientY)?.minute ?? options.firstHour * 60,
                    )
                  }
                >
                  {Array.from({ length: (options.lastHour - options.firstHour) * 2 }, (_, i) => {
                    const minute = options.firstHour * 60 + i * 30
                    return (
                      <button
                        key={i}
                        className="calendar-slot"
                        style={{ top: (i * zoom) / 2, height: zoom / 2 }}
                        disabled={disabled}
                        data-calendar-minute={minute}
                        tabIndex={
                          focusSlot &&
                          days.includes(focusSlot.day) &&
                          focusSlot.minute >= options.firstHour * 60 &&
                          focusSlot.minute < options.lastHour * 60
                            ? focusSlot.day === day && focusSlot.minute === minute
                              ? 0
                              : -1
                            : day === (days.includes(current) ? current : start) &&
                                i === Math.min(18, (options.lastHour - options.firstHour) * 2 - 1)
                              ? 0
                              : -1
                        }
                        aria-label={`Add task on ${day} at ${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`}
                        onFocus={() => setFocusSlot({ day, minute })}
                        onKeyDown={(event) => {
                          const direction = event.key
                          if (
                            !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(direction)
                          )
                            return
                          event.preventDefault()
                          const dayIndex =
                            days.indexOf(day) +
                            (direction === 'ArrowLeft' ? -1 : direction === 'ArrowRight' ? 1 : 0)
                          const nextDay = days[dayIndex]
                          const nextMinute =
                            minute +
                            (direction === 'ArrowUp' ? -30 : direction === 'ArrowDown' ? 30 : 0)
                          if (nextDay)
                            scroll.current
                              ?.querySelector<HTMLElement>(
                                `[data-calendar-day="${nextDay}"] [data-calendar-minute="${nextMinute}"]`,
                              )
                              ?.focus()
                        }}
                        onPointerDown={(event) => beginCreate(event, day, minute)}
                        onClick={(event) => {
                          if (event.detail === 0 || mobile) {
                            openPoint(day, minute)
                          }
                        }}
                      />
                    )
                  })}
                  {layout.timed
                    .filter((item) => item.day === day)
                    .map((item) => renderItem(item, true))}
                  {day === current &&
                    (() => {
                      const parts = new Intl.DateTimeFormat('en-GB', {
                        timeZone: zone,
                        hour: '2-digit',
                        minute: '2-digit',
                        hourCycle: 'h23',
                      })
                        .format(new Date(now))
                        .split(':')
                        .map(Number)
                      const minute = parts[0] * 60 + parts[1]
                      return minute >= options.firstHour * 60 && minute < options.lastHour * 60 ? (
                        <div
                          className="calendar-now"
                          aria-label="Current time"
                          style={{ top: (minute / 60 - options.firstHour) * zoom }}
                        />
                      ) : null
                    })()}
                </div>
              ))}
            </div>
          </div>
          {(denseItems.length > 0 || hiddenItems.length > 0) && (
            <div ref={overflowList} tabIndex={-1} aria-label="Additional calendar tasks">
              {denseItems.length > 0 && (
                <div className="calendar-hidden">
                  <h2>Overlapping tasks</h2>
                  {denseItems.map((item) => (
                    <button
                      className="btn btn-plain"
                      key={`${item.task.id}:${item.day}`}
                      onClick={(event) => selectTask(item.task.id, event.currentTarget)}
                    >
                      {item.task.title} · {item.day} · {item.label}
                    </button>
                  ))}
                </div>
              )}
              {hiddenItems.length > 0 && (
                <div className="calendar-hidden">
                  <h2>Outside visible hours</h2>
                  {hiddenItems.map((item) => (
                    <button
                      className="btn btn-plain"
                      key={`${item.task.id}:${item.day}`}
                      onClick={(event) => selectTask(item.task.id, event.currentTarget)}
                    >
                      {item.task.title} · {item.day} · {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        {arrange && (
          <aside className="calendar-arrange" aria-label="Arrange tasks">
            <h2>
              Arrange tasks <span className="count">{unscheduled.length}</span>
            </h2>
            <label className="field-label">
              Project
              <select
                className="field"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              >
                <option value="*">All projects and Inbox</option>
                <option value="">Inbox</option>
                {projects
                  .filter((p) => !p.deletedAt)
                  .map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
            <p className="field-help">
              {mobile
                ? 'Choose Schedule to set a date and time.'
                : 'Drag a task onto the calendar, or choose Schedule to set its date and time.'}
            </p>
            {unscheduled.length === 0 && <p className="task-empty">No unscheduled tasks.</p>}
            {[...new Set(unscheduled.map((task) => task.projectId))].map((id) => (
              <div key={id ?? 'inbox'}>
                <h3>{projects.find((p) => p.id === id)?.name || 'Inbox'}</h3>
                {unscheduled
                  .filter((t) => t.projectId === id)
                  .map((task) => (
                    <div
                      key={task.id}
                      className="calendar-arrange-task"
                      draggable={!disabled && !mobile}
                      onDragStart={(event) => startDrag(event, task)}
                    >
                      <span>{task.title}</span>
                      <button
                        className="btn btn-sm"
                        disabled={disabled}
                        onClick={(event) => selectTask(task.id, event.currentTarget, true)}
                        aria-label={`Schedule ${task.title}`}
                      >
                        Schedule
                      </button>
                    </div>
                  ))}
              </div>
            ))}
          </aside>
        )}
      </div>
      {draft && (
        <CalendarDraft
          initial={draft}
          projects={projects}
          disabled={disabled}
          onClose={() => setDraft(null)}
          onCreated={(title) => setAnnouncement(`Created ${title}`)}
          restoreFocus={() => {
            const trigger = draftTrigger.current
            if (trigger?.isConnected) trigger.focus({ preventScroll: true })
            else draftRef.current?.focus()
          }}
        />
      )}
    </div>
  )
}
