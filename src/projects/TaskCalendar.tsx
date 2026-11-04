import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type DragEvent,
} from 'react'
import * as Dropdown from '@radix-ui/react-dropdown-menu'
import * as Popover from '@radix-ui/react-popover'
import CalendarOptions, { readCalendarOptions } from './CalendarOptions'
import CalendarDraft from './CalendarDraft'
import { CalendarAgenda, CalendarBoard, CalendarYear } from './CalendarViews'
import {
  Calendar,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Flag,
  Minus,
  Plus,
} from '../icons'
import AppTooltip from '../components/AppTooltip'
import { DateCalendar } from '../components/DateField'
import { notebookColorValue } from '../notebookColors'
import { moveDueMarker, saveTaskSchedule, toggleTask, type Notify } from './actions'
import {
  allDayBars,
  calendarItems,
  calendarSchedule,
  dragTop,
  isUnscheduled,
  minuteAt,
  moveSchedule,
  planDrop,
  resizedSchedule,
  shiftedDate,
  timedSegments,
  viewDays,
  type CalendarItem,
  type CalendarSpans,
  type CalendarView,
  type DragData,
  type DropPlan,
} from './calendarLayout'
import {
  addDays,
  calendarDate,
  dayAt,
  displayZone,
  effectiveDueDate,
  subscribeDisplayZone,
  type TaskSchedule,
} from './schedule'
import { dueState, formatDate, today, type Project, type Task } from './model'
import { scheduleDraft, scheduleFromDraft, type ScheduleDraft } from './ScheduleEditor'

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
const viewNames: [CalendarView, string, string][] = [
  ['day', 'Day', 'D/1'],
  ['week', 'Week', 'W/2'],
  ['month', 'Month', 'M/3'],
  ['year', 'Year', 'Y/4'],
  ['agenda', 'Agenda', 'A/5'],
]
const spanLimits = { days: [2, 14], weeks: [2, 8] } as const
const spanLabel = (count: number, unit: 'Day' | 'Week') => `${count} ${unit}s`
const readView = (): CalendarView => {
  try {
    const saved = localStorage.getItem('stash-calendar-view')
    if (saved === 'three') return 'days'
    if (saved === 'day' || saved === 'days' || saved === 'weeks') return saved
    if (saved === 'month' || saved === 'year' || saved === 'agenda') return saved
  } catch {
    /* Use the week. */
  }
  return 'week'
}
const readSpans = (): CalendarSpans => {
  try {
    const saved = JSON.parse(localStorage.getItem('stash-calendar-span') ?? '{}')
    const count = (value: unknown, [low, high]: readonly [number, number], fallback: number) =>
      Number.isInteger(value) && (value as number) >= low && (value as number) <= high
        ? (value as number)
        : fallback
    const legacy = localStorage.getItem('stash-calendar-view') === 'three'
    return {
      days: count(saved.days, spanLimits.days, legacy ? 3 : 5),
      weeks: count(saved.weeks, spanLimits.weeks, 2),
    }
  } catch {
    return { days: 5, weeks: 2 }
  }
}
const deviceZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone
// A wider block than its share, so overlapping titles stay readable.
const overlapWidth = 1.6
const slotGutter = 6
/** Where a drag would land: a band in the time grid or across the all-day row. */
interface Ghost {
  timed?: { day: string; start: number; end: number }[]
  days?: [string, string]
  label: string
}
const dayRangeLabel = (first: string, last: string) =>
  first === last ? 'All day' : `${formatDate(first)} – ${formatDate(last)}`
const edgeScrollZone = 32
// The ghost replaces the browser's drag image when a block moves within the grid.
const blankDragImage = typeof Image === 'undefined' ? null : new Image()
if (blankDragImage)
  blankDragImage.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

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
  const [mode, setMode] = useState<CalendarView>(() => (mobile ? 'day' : readView()))
  const [storedSpans, setSpans] = useState(readSpans)
  const spans = useMemo(
    () => (mobile ? { ...storedSpans, days: 3 } : storedSpans),
    [mobile, storedSpans],
  )
  const [jumpOpen, setJumpOpen] = useState(false)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [arrange, setArrange] = useState(false)
  const [filter, setFilter] = useState('*')
  const [draft, setDraft] = useState<ScheduleDraft | null>(null)
  const [draftKey, setDraftKey] = useState(0)
  const draftDirty = useRef(false)
  const draftOpen = useRef(false)
  draftOpen.current = draft !== null
  const [error, setError] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const [preview, setPreview] = useState('')
  const [ghost, setGhost] = useState<Ghost | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [focusSlot, setFocusSlot] = useState<{ day: string; minute: number } | null>(null)
  const detailTrigger = useRef<HTMLElement | null>(null)
  const [now, setNow] = useState(Date.now())
  const scroll = useRef<HTMLDivElement>(null)
  const overflowList = useRef<HTMLDivElement>(null)
  const cancelGesture = useRef<(() => void) | null>(null)
  const dragging = useRef<DragData | null>(null)
  const draftRef = useRef<HTMLButtonElement>(null)
  const draftTrigger = useRef<HTMLElement | null>(null)
  const optionsRef = useRef<HTMLButtonElement>(null)
  const board = mode === 'month' || mode === 'weeks'
  const gridView = mode === 'day' || mode === 'week' || mode === 'days'
  const days = useMemo(
    () => viewDays(mode, date, options.firstDay, spans),
    [mode, date, options.firstDay, spans],
  )
  const start = days[0]
  const daysCount = days.length
  const narrowColumns = daysCount >= 5
  const denseLanes = mobile ? (daysCount === 3 ? 2 : 3) : narrowColumns ? 3 : 5
  const zone = useSyncExternalStore(subscribeDisplayZone, displayZone)
  const current = dayAt(now, zone)
  const nowMinute = minuteAt(now, zone)
  const layout = useMemo(
    () => calendarItems(tasks, days, zone, options.completed, ((mobile ? 48 : 16) / zoom) * 60),
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
    if (mobile) return
    try {
      localStorage.setItem('stash-calendar-view', mode)
    } catch {
      /* Session still works. */
    }
  }, [mode, mobile])
  useEffect(() => {
    try {
      localStorage.setItem('stash-calendar-span', JSON.stringify(storedSpans))
    } catch {
      /* Session still works. */
    }
  }, [storedSpans])
  useEffect(() => setError(''), [start, daysCount])
  // Now, a third of the way down, when it's on screen; otherwise the start of a working day.
  const scrollToNow = (visible: boolean) => {
    const element = scroll.current
    if (!element) return
    if (!gridView) {
      element.scrollTop = 0
      return
    }
    const top = ((visible ? nowMinute : 480) / 60 - options.firstHour) * zoom
    element.scrollTop = Math.max(0, top - (visible ? element.clientHeight / 3 : 0))
  }
  useEffect(() => {
    scrollToNow(!mobile && days.includes(current))
  }, [zoom, options.firstHour, gridView])

  const openDraftFields = (
    schedule: ScheduleDraft,
    trigger = document.activeElement as HTMLElement | null,
  ) => {
    if (draftDirty.current) return
    draftTrigger.current = trigger
    setError('')
    setDraft(schedule)
    setDraftKey((key) => key + 1)
  }
  const closeDraft = () => {
    draftDirty.current = false
    setDraft(null)
  }
  const openDraft = (schedule: TaskSchedule | null, trigger?: HTMLElement | null) =>
    openDraftFields(scheduleDraft(schedule, zone), trigger ?? undefined)
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
  const apply = async (task: Task, day: string, top: number | null, data: DragData) => {
    try {
      setError('')
      const plan = planDrop(task, data, day, top, zone)
      if (plan.kind === 'deadline') {
        await moveDueMarker(task, plan.day, notify)
        setAnnouncement(`Moved deadline for ${task.title} to ${plan.day}`)
        return
      }
      const schedule = data.marker ? null : calendarSchedule(task, zone)
      await saveTaskSchedule(
        task,
        plan.kind === 'allDay'
          ? { kind: 'allDay', start: plan.start, end: plan.end }
          : moveSchedule(schedule, plan.day, plan.minute, zone),
        notify,
      )
      setAnnouncement(
        plan.kind === 'allDay'
          ? `Moved ${task.title} to ${plan.start}`
          : `Moved ${task.title} to ${plan.day} at ${clockLabel(plan.minute)}`,
      )
    } catch (error) {
      report(error)
    }
  }
  const firstMinute = options.firstHour * 60
  const lastMinute = options.lastHour * 60
  // The nearest column, so a gesture keeps working when the pointer leaves the grid.
  const locate = (x: number, y: number, timed: boolean) => {
    // A month grid has a row per week, so the pointer's height picks the week first.
    const weeks = [...(scroll.current?.querySelectorAll('.calendar-board-week') ?? [])]
    const week = weeks.find((row) => y < row.getBoundingClientRect().bottom) ?? weeks.at(-1)
    const cells = [
      ...((week ?? scroll.current)?.querySelectorAll<HTMLElement>(
        timed ? '.calendar-day-column' : '.calendar-all-day-cell',
      ) ?? []),
    ]
    const element = cells.find((cell) => x < cell.getBoundingClientRect().right) ?? cells.at(-1)
    if (!element) return null
    const day = element.dataset.calendarDay!
    if (!timed) return { day, minute: null, exact: 0 }
    const exact = Math.max(
      firstMinute,
      Math.min(
        lastMinute,
        ((y - element.getBoundingClientRect().top) / zoom) * 60 + firstMinute,
      ),
    )
    return { day, minute: Math.min(lastMinute - 15, Math.floor(exact / 15) * 15), exact }
  }
  type Located = NonNullable<ReturnType<typeof locate>>
  // Where a drop on a day column puts the top of what's dragged.
  const dropTop = (column: HTMLElement, y: number, data: DragData | null) => {
    const pointer = ((y - column.getBoundingClientRect().top) / zoom) * 60 + firstMinute
    return data?.block
      ? dragTop(data.block.top, data.block.grabOffset, pointer, firstMinute, lastMinute)
      : Math.max(firstMinute, Math.min(lastMinute - 15, Math.floor(pointer / 15) * 15))
  }
  const ghostKey = useRef('')
  const showGhost = (next: Ghost | null, spoken = '') => {
    const key = JSON.stringify(next)
    if (key === ghostKey.current) return
    ghostKey.current = key
    setGhost(next)
    setPreview(next ? spoken || next.label : '')
  }
  const timedGhost = (day: string, minute: number, minutes: number, label: string): Ghost => ({
    timed: timedSegments(
      day,
      minute,
      minutes,
      days,
      board ? 0 : firstMinute,
      board ? 1440 : lastMinute,
    ),
    label,
  })
  const scheduleGhost = (schedule: TaskSchedule): Ghost => {
    if (schedule.kind === 'allDay') {
      const last = addDays(schedule.end, -1)
      return { days: [schedule.start, last], label: dayRangeLabel(schedule.start, last) }
    }
    const end = schedule.kind === 'range' ? schedule.end : schedule.start
    const minutes = schedule.kind === 'range' ? (end - schedule.start) / 60_000 : 30
    const start = Math.floor(minuteAt(schedule.start, zone))
    return timedGhost(
      dayAt(schedule.start, zone),
      start,
      minutes,
      schedule.kind === 'range' ? `${clockLabel(start)}–${clockLabel(Math.floor(minuteAt(end, zone)))}` : clockLabel(start),
    )
  }
  const planGhost = (task: Task, data: DragData, plan: DropPlan): Ghost => {
    if (plan.kind === 'deadline')
      return { days: [plan.day, plan.day], label: `Due ${formatDate(plan.day)}` }
    if (plan.kind === 'allDay') {
      const last = addDays(plan.end, -1)
      return { days: [plan.start, last], label: dayRangeLabel(plan.start, last) }
    }
    const schedule = data.marker ? null : calendarSchedule(task, zone)
    if (schedule?.kind !== 'range')
      return timedGhost(plan.day, plan.minute, 30, clockLabel(plan.minute))
    const minutes = (schedule.end - schedule.start) / 60_000
    const end = (plan.minute + minutes) % 1440
    return timedGhost(
      plan.day,
      plan.minute,
      minutes,
      `${clockLabel(plan.minute)}–${clockLabel(end)}`,
    )
  }
  const showDrop = (day: string, top: number | null) => {
    const data = dragging.current
    const task = data && tasks.find((t) => t.id === data.id)
    if (!data || !task) return
    try {
      showGhost(planGhost(task, data, planDrop(task, data, day, top, zone)))
    } catch {
      showGhost(null)
    }
  }
  const edgeScrollStep = (y: number) => {
    const box = scroll.current?.getBoundingClientRect()
    const header = scroll.current?.querySelector('.calendar-sticky')?.getBoundingClientRect()
    if (!box || !header) return 0
    return y < header.bottom + edgeScrollZone ? -1 : y > box.bottom - edgeScrollZone ? 1 : 0
  }
  // A gesture is temporary until release. Escape, pointer cancellation and unmount never save.
  const gesture = (
    x: number,
    y: number,
    timed: boolean,
    update: (end: Located) => void,
    commit: (end: Located, moved: boolean) => void,
  ) => {
    cancelGesture.current?.()
    let end = locate(x, y, timed)
    let moved = false
    let last = { x, y }
    let frame = 0
    const refresh = () => {
      end = locate(last.x, last.y, timed) ?? end
      if (end && moved) update(end)
    }
    const tick = () => {
      const step = timed && moved ? edgeScrollStep(last.y) : 0
      if (step && scroll.current) {
        scroll.current.scrollTop += step * 8
        refresh()
      }
      frame = requestAnimationFrame(tick)
    }
    const move = (event: PointerEvent) => {
      moved ||= Math.hypot(event.clientX - x, event.clientY - y) > 5
      last = { x: event.clientX, y: event.clientY }
      refresh()
    }
    const cleanup = () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', key)
      cancelGesture.current = null
      showGhost(null)
      setDraggingId(null)
    }
    const cancel = () => cleanup()
    const up = (event: PointerEvent) => {
      const released = locate(event.clientX, event.clientY, timed)
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
    frame = requestAnimationFrame(tick)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', key)
  }
  // A drag covers every cell it touches, whichever way it goes.
  const createdRange = (anchor: Located, end: Located) => {
    const [first, last] = [anchor, end].sort(
      (a, b) => a.day.localeCompare(b.day) || a.minute! - b.minute!,
    )
    return { first, last, endMinute: last.minute! + 15 }
  }
  const beginCreate = (event: React.PointerEvent, day: string, minute: number | null) => {
    if (disabled || draftDirty.current || event.button !== 0 || event.pointerType === 'touch') return
    event.preventDefault()
    const trigger = event.currentTarget as HTMLElement
    const timed = minute !== null
    const anchor: Located = locate(event.clientX, event.clientY, timed) ?? {
      day,
      minute,
      exact: 0,
    }
    gesture(
      event.clientX,
      event.clientY,
      timed,
      (end) => {
        if (!timed) {
          const [first, last] = [anchor.day, end.day].sort()
          return showGhost({ days: [first, last], label: dayRangeLabel(first, last) })
        }
        const { first, last, endMinute } = createdRange(anchor, end)
        const span = calendarDate(first.day).until(calendarDate(last.day)).days
        showGhost(
          timedGhost(
            first.day,
            first.minute!,
            span * 1440 + endMinute - first.minute!,
            `${clockLabel(first.minute!)}–${clockLabel(endMinute % 1440)}`,
          ),
        )
      },
      (end, moved) => {
        try {
          if (!timed) {
            const ordered = [anchor.day, end.day].sort()
            openDraftFields(
              scheduleDraft(
                { kind: 'allDay', start: ordered[0], end: addDays(ordered[1], 1) },
                zone,
              ),
              trigger,
            )
          } else {
            // A click takes the start of the half-hour cell it highlights; a drag is finer.
            if (!moved) return openPoint(day, minute, trigger)
            const { first, last, endMinute } = createdRange(anchor, end)
            openDraftFields(
              {
                ...scheduleDraft(null, zone),
                kind: 'range',
                date: first.day,
                time: clockLabel(first.minute!),
                endDate: endMinute === 1440 ? addDays(last.day, 1) : last.day,
                endTime: clockLabel(endMinute % 1440),
              },
              trigger,
            )
          }
        } catch (error) {
          report(error)
        }
      },
    )
  }
  const resize = (event: React.PointerEvent, item: CalendarItem, edge: 'start' | 'end') => {
    event.stopPropagation()
    event.preventDefault()
    const schedule = item.task.schedule
    if (!schedule || disabled) return
    const timed = schedule.kind !== 'allDay'
    const resized = (end: Located) =>
      resizedSchedule(
        schedule,
        edge,
        end.day,
        timed ? Math.round(end.exact / 15) * 15 : null,
        zone,
      )
    setDraggingId(item.task.id)
    gesture(
      event.clientX,
      event.clientY,
      timed,
      (end) => {
        try {
          showGhost(scheduleGhost(resized(end)))
        } catch {
          /* A time that doesn't exist on this day has no preview; the release reports it. */
        }
      },
      async (end, moved) => {
        if (!moved) return
        try {
          await saveTaskSchedule(item.task, resized(end), notify)
          setAnnouncement(`Resized ${item.task.title}`)
        } catch (error) {
          report(error)
        }
      },
    )
  }
  const endDrag = () => {
    dragging.current = null
    setDraggingId(null)
    showGhost(null)
  }
  const drop = (event: DragEvent, day: string, timed: boolean) => {
    event.preventDefault()
    try {
      const data: DragData = JSON.parse(event.dataTransfer.getData(dragType))
      const task = tasks.find((t) => t.id === data.id)
      // On a month grid a timed task changes day and keeps its time.
      const top = timed
        ? dropTop(event.currentTarget as HTMLElement, event.clientY, data)
        : board
          ? (data.block?.top ?? null)
          : null
      if (task && !disabled) void apply(task, day, top, data)
    } catch {
      /* Ignore drops from other applications. */
    }
    endDrag()
  }
  const startDrag = (event: DragEvent, data: DragData) => {
    dragging.current = data
    event.dataTransfer.setData(dragType, JSON.stringify(data))
    event.dataTransfer.effectAllowed = 'move'
    if (data.block && blankDragImage) event.dataTransfer.setDragImage(blankDragImage, 0, 0)
    // After this frame, so the browser captures the drag image undimmed.
    requestAnimationFrame(() => {
      if (dragging.current === data) setDraggingId(data.id)
    })
  }
  const dragOverEdge = (y: number) => {
    const step = edgeScrollStep(y)
    if (step && scroll.current) scroll.current.scrollTop += step * 12
  }
  const renderItem = (
    item: CalendarItem,
    timed: boolean,
    bar?: { from: number; span: number; days?: string[]; row?: number },
  ) => {
    const { task, marker } = item
    // A timed task in a month grid: one line in the cell, but it still has a time to keep.
    const chip = !!bar?.days && !timed && item.clock !== ''
    const top = ((Math.max(item.start, firstMinute) - firstMinute) / 60) * zoom
    const bottom = Math.min(item.end, lastMinute)
    if (timed && (item.end <= firstMinute || item.start >= lastMinute)) return null
    const schedule = task.schedule
    const barDays = bar?.days ?? days
    const firstDay = bar ? barDays[bar.from] : item.day
    const lastDay = bar ? barDays[bar.from + bar.span - 1] : item.day
    const startsHere =
      schedule?.kind === 'allDay'
        ? schedule.start === firstDay
        : !!schedule && dayAt(schedule.start, zone) === item.day
    const endsHere =
      schedule?.kind === 'allDay'
        ? addDays(schedule.end, -1) === lastDay
        : schedule?.kind === 'range'
          ? item.end < 1440
          : startsHere
    const past =
      !marker &&
      (lastDay < current || ((timed || chip) && lastDay === current && item.end <= nowMinute))
    const due = marker ? dueState(task, current) : 'none'
    const color = notebookColorValue(projects.find((p) => p.id === task.projectId)?.color)
    const height = Math.max(
      mobile ? 48 : 16,
      ((bottom - Math.max(item.start, firstMinute)) / 60) * zoom - 1,
    )
    const left = (item.lane / item.lanes) * 100
    const detail = [due === 'late' && 'Overdue', (timed || chip) && startsHere && item.clock]
      .filter(Boolean)
      .join(' · ')
    const classes = [
      'calendar-item',
      item.lanes >= denseLanes && 'is-dense',
      timed && height < 40 && 'is-short',
      timed && item.lanes > 1 && narrowColumns && 'is-overlapped',
      timed && 'is-timed',
      marker && 'is-marker',
      due === 'late' && 'is-late',
      due === 'soon' && 'is-soon',
      task.status === 'done' ? 'is-done' : past && 'is-past',
      selectedId === task.id && 'is-selected',
      draggingId === task.id && 'is-dragging',
      schedule?.kind === 'allDay' && !marker && !startsHere && 'is-continued',
      schedule?.kind === 'allDay' && !marker && !endsHere && 'continues',
    ]
    return (
      <div
        key={`${task.id}:${marker}:${timed || chip ? item.day : ''}`}
        className={classes.filter(Boolean).join(' ')}
        data-task-id={task.id}
        data-marker={marker}
        data-calendar-first={firstDay}
        data-calendar-last={lastDay}
        draggable={!disabled && !mobile}
        onDragStart={(event) => {
          const box = event.currentTarget.getBoundingClientRect()
          startDrag(event, {
            id: task.id,
            marker,
            sourceDay: timed || chip ? item.day : locate(event.clientX, event.clientY, false)?.day,
            ...(timed
              ? {
                  block: {
                    top: Math.max(item.start, firstMinute),
                    grabOffset: ((event.clientY - box.top) / zoom) * 60,
                  },
                }
              : chip
                ? { block: { top: item.start, grabOffset: 0 } }
                : {}),
          })
        }}
        onDragEnd={endDrag}
        style={
          {
            ...(color ? { '--item-color': color } : {}),
            ...(timed
              ? {
                  top,
                  height,
                  left: `${left}%`,
                  width: `calc(${Math.min(100 - left, (100 / item.lanes) * overlapWidth)}% - ${mobile ? 0 : slotGutter}px)`,
                }
              : {
                  gridRow: bar?.row ?? item.lane + 2,
                  gridColumn: `${(bar?.from ?? 0) + (bar?.days ? 1 : 2)} / span ${bar?.span ?? 1}`,
                }),
          } as CSSProperties
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
          <span className={`task-check is-${task.status}`}>
            {task.status === 'done' && <Check aria-hidden="true" className="ui-icon" />}
          </span>
        </button>
        <AppTooltip label={`${task.title} · ${projectName(task)} · ${item.label}`}>
          <button
            className="calendar-item-open"
            disabled={disabled}
            onClick={(event) => selectTask(task.id, event.currentTarget)}
            aria-label={`Open ${task.title}, ${item.label}, ${projectName(task)}`}
          >
            <strong>
              {marker && <Flag aria-hidden="true" className="calendar-due-flag" />}
              {task.title}
            </strong>
            {detail && <small>{detail}</small>}
          </button>
        </AppTooltip>
        {!marker && !chip && startsHere && schedule && schedule.kind !== 'point' && (
          <span
            className={`calendar-resize is-start ${timed ? '' : 'is-day-edge'}`}
            onPointerDown={(event) => resize(event, item, 'start')}
            aria-hidden="true"
          />
        )}
        {!marker && !chip && endsHere && schedule && (
          <span
            className={`calendar-resize is-end ${timed ? '' : 'is-day-edge'}`}
            onPointerDown={(event) => resize(event, item, 'end')}
            aria-hidden="true"
          />
        )}
      </div>
    )
  }
  const hiddenItems = gridView
    ? layout.timed.filter((item) => item.end <= firstMinute || item.start >= lastMinute)
    : []
  const bars = allDayBars(layout.allDay, days)
  // An open draft holds its place on the grid until it's saved or dismissed.
  const draftGhost = (() => {
    if (!draft || mobile) return null
    try {
      const schedule = scheduleFromDraft(draft)
      return schedule && scheduleGhost(schedule)
    } catch {
      return null
    }
  })()
  const shownGhost = ghost ?? draftGhost
  const ghostDays = shownGhost?.days && {
    from: days.findIndex((day) => day >= shownGhost.days![0]),
    to: days.filter((day) => day <= shownGhost.days![1]).length - 1,
  }
  const showZone = zone !== deviceZone() || hiddenItems.length > 0
  const navigate = (amount: number) => {
    try {
      setDate(shiftedDate(mode, date, options.firstDay, spans, amount))
    } catch (error) {
      report(error)
    }
  }
  const goToday = () => {
    setDate(current)
    scrollToNow(!mobile)
  }
  const showDay = (day: string) => {
    setDate(day)
    setMode('day')
  }
  const viewLabel =
    mode === 'days'
      ? spanLabel(spans.days, 'Day')
      : mode === 'weeks'
        ? spanLabel(spans.weeks, 'Week')
        : viewNames.find(([view]) => view === mode)![1]
  const rangeLabel =
    mode === 'year'
      ? date.slice(0, 4)
      : mode === 'month'
        ? calendarDate(date).toLocaleString('en-US', { month: 'long', year: 'numeric' })
        : `${formatDate(start)}${daysCount > 1 ? ` – ${formatDate(days.at(-1)!)}` : ''}`
  useEffect(() => {
    if (mobile) return
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
      if (draft || cancelGesture.current) return
      const target = event.target as HTMLElement
      const arrow = event.key.startsWith('Arrow')
      const inCalendar = target === document.body || !!target.closest?.('.task-calendar')
      if (
        (arrow && !inCalendar) ||
        target.isContentEditable ||
        target.closest?.('input, textarea, select, [role="dialog"], [role="menu"]')
      )
        return
      const actions: Record<string, () => void> = {
        t: goToday,
        d: () => setMode('day'),
        1: () => setMode('day'),
        w: () => setMode('week'),
        2: () => setMode('week'),
        m: () => setMode('month'),
        3: () => setMode('month'),
        y: () => setMode('year'),
        4: () => setMode('year'),
        a: () => setMode('agenda'),
        5: () => setMode('agenda'),
        ArrowLeft: () => navigate(-1),
        ArrowRight: () => navigate(1),
        n: () => {
          if (!disabled)
            openDraft({ kind: 'allDay', start: date, end: addDays(date, 1) }, draftRef.current)
        },
      }
      const action = actions[event.key]
      if (!action) return
      event.preventDefault()
      action()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  return (
    <div
      className={`task-calendar ${mobile ? 'is-mobile' : ''}`}
      style={
        {
          '--calendar-days': daysCount,
          '--calendar-hour': `${zoom}px`,
          '--calendar-all-day': `${options.allDayHeight}px`,
          '--calendar-all-day-lanes': Math.max(1, ...layout.allDay.map((item) => item.lane + 1)),
        } as CSSProperties
      }
      aria-label="Task calendar"
    >
      <div className="calendar-toolbar" data-tauri-drag-region>
        <Calendar className="ui-icon" aria-hidden="true" />
        <h1>Calendar</h1>
        <Popover.Root open={jumpOpen} onOpenChange={setJumpOpen}>
          <Popover.Trigger asChild>
            <button className="btn btn-plain calendar-range" aria-label="Jump to a date">
              {rangeLabel}
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              className="popover date-picker"
              side="bottom"
              align="start"
              sideOffset={5}
              collisionPadding={8}
              aria-label="Jump to a date"
            >
              <DateCalendar
                value={date}
                onChange={(next) => {
                  setDate(next)
                  setJumpOpen(false)
                }}
              />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        <span className="pane-spacer" data-tauri-drag-region />
        {mobile ? (
          <select
            className="field"
            aria-label="Calendar view"
            value={mode === 'days' ? 'three' : 'day'}
            onChange={(event) => setMode(event.target.value === 'three' ? 'days' : 'day')}
          >
            <option value="day">Day</option>
            <option value="three">3 days</option>
          </select>
        ) : (
          <Dropdown.Root>
            <Dropdown.Trigger asChild>
              <button className="btn btn-plain calendar-view-trigger" aria-label={`Calendar view: ${viewLabel}`}>
                {viewLabel}
                <ChevronDown aria-hidden="true" className="ui-icon" />
              </button>
            </Dropdown.Trigger>
            <Dropdown.Portal>
              <Dropdown.Content
                className="menu calendar-view-menu"
                align="center"
                sideOffset={6}
                collisionPadding={8}
                onCloseAutoFocus={(event) => {
                  event.preventDefault()
                  scroll.current?.focus({ preventScroll: true })
                }}
              >
                <Dropdown.RadioGroup
                  value={mode}
                  onValueChange={(next) => setMode(next as CalendarView)}
                >
                  {viewNames.map(([view, name, keys]) => (
                    <Dropdown.RadioItem key={view} value={view} className="menu-item">
                      <span className="menu-check">
                        <Dropdown.ItemIndicator>
                          <Check aria-hidden="true" className="ui-icon" />
                        </Dropdown.ItemIndicator>
                      </span>
                      <span className="menu-text">{name}</span>
                      <span className="menu-shortcut">{keys}</span>
                    </Dropdown.RadioItem>
                  ))}
                  <Dropdown.Separator className="menu-separator" />
                  {(
                    [
                      ['days', 'Multi-Day', 'Day', spans.days],
                      ['weeks', 'Multi-Week', 'Week', spans.weeks],
                    ] as const
                  ).map(([view, name, unit, count]) => {
                    const [low, high] = spanLimits[view]
                    const step = (amount: number) => {
                      const next = Math.min(high, Math.max(low, count + amount))
                      setSpans({ ...storedSpans, [view]: next })
                      setMode(view)
                    }
                    // A press on − or + neither chooses the row nor takes focus from it, which
                    // would hide the buttons before the click lands.
                    const keepOpen = (event: React.SyntheticEvent) => event.stopPropagation()
                    return (
                      <Dropdown.RadioItem
                        key={view}
                        value={view}
                        className="menu-item calendar-span-item"
                        onKeyDown={(event) => {
                          if (event.key === 'ArrowLeft') step(-1)
                          if (event.key === 'ArrowRight') step(1)
                        }}
                      >
                        <span className="menu-check">
                          <Dropdown.ItemIndicator>
                            <Check aria-hidden="true" className="ui-icon" />
                          </Dropdown.ItemIndicator>
                        </span>
                        <span className="menu-text">{name}</span>
                        <span className="menu-detail">{spanLabel(count, unit)}</span>
                        <span
                          className="calendar-span-stepper"
                          onPointerDown={keepOpen}
                          onMouseDown={(event) => event.preventDefault()}
                          onPointerUp={keepOpen}
                          onClick={keepOpen}
                        >
                          <button
                            tabIndex={-1}
                            aria-label={`Fewer ${unit.toLowerCase()}s`}
                            disabled={count <= low}
                            onClick={() => step(-1)}
                          >
                            <Minus aria-hidden="true" className="ui-icon" />
                          </button>
                          <span>{count}</span>
                          <button
                            tabIndex={-1}
                            aria-label={`More ${unit.toLowerCase()}s`}
                            disabled={count >= high}
                            onClick={() => step(1)}
                          >
                            <Plus aria-hidden="true" className="ui-icon" />
                          </button>
                        </span>
                      </Dropdown.RadioItem>
                    )
                  })}
                </Dropdown.RadioGroup>
              </Dropdown.Content>
            </Dropdown.Portal>
          </Dropdown.Root>
        )}
        <div className="calendar-navigation">
          <AppTooltip label="Previous (←)" instant>
            <button className="icon-btn" aria-label="Previous period" onClick={() => navigate(-1)}>
              <ChevronLeft />
            </button>
          </AppTooltip>
          <AppTooltip label="Go to today (T)">
            <button className="btn btn-plain" onClick={goToday}>
              Today
            </button>
          </AppTooltip>
          <AppTooltip label="Next (→)" instant>
            <button className="icon-btn" aria-label="Next period" onClick={() => navigate(1)}>
              <ChevronRight />
            </button>
          </AppTooltip>
        </div>
        <div className="calendar-tools">
          <button
            className="btn btn-plain"
            aria-expanded={arrange}
            onClick={() => setArrange(!arrange)}
          >
            Arrange tasks
          </button>
          <button
            ref={optionsRef}
            className="btn btn-plain"
            onClick={() => setOptionsOpen(true)}
          >
            View options
          </button>
          <AppTooltip label="New task (N)">
            <button
              ref={draftRef}
              className="btn"
              disabled={disabled}
              onClick={(event) =>
                openDraft({ kind: 'allDay', start: date, end: addDays(date, 1) }, event.currentTarget)
              }
            >
              <Plus className="ui-icon" />
              Add task
            </button>
          </AppTooltip>
        </div>
      </div>
      {optionsOpen && (
        <CalendarOptions
          options={options}
          setOptions={setOptions}
          zone={zone}
          onClose={() => setOptionsOpen(false)}
          restoreFocus={() => optionsRef.current?.focus()}
        />
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <span role="status" className="sr-only">
        {preview || announcement}
      </span>
      {showZone && (
        <div className="calendar-zone">
          {zone !== deviceZone() ? <span>Times in {zone}</span> : <span />}
          {hiddenItems.length > 0 && (
            <button className="btn btn-plain btn-sm" onClick={() => overflowList.current?.focus()}>
              {hiddenItems.length} outside visible hours
            </button>
          )}
        </div>
      )}
      <div className={`calendar-workspace ${arrange ? 'has-arrange' : ''}`}>
        <div className="calendar-scroll" ref={scroll} tabIndex={-1}>
          {board && (
            <CalendarBoard
              days={days}
              month={mode === 'month' ? date.slice(0, 7) : null}
              current={current}
              firstDay={options.firstDay}
              tasks={tasks}
              zone={zone}
              showCompleted={options.completed}
              disabled={disabled}
              ghost={shownGhost}
              renderItem={renderItem}
              onShowDay={showDay}
              onBeginCreate={(event, day) => beginCreate(event, day, null)}
              onAddDay={(day) => openDraft({ kind: 'allDay', start: day, end: addDays(day, 1) })}
              onDragOver={(event) => {
                if (!event.dataTransfer.types.includes(dragType)) return
                event.preventDefault()
                dragOverEdge(event.clientY)
                const at = locate(event.clientX, event.clientY, false)
                if (at) showDrop(at.day, dragging.current?.block?.top ?? null)
              }}
              onDrop={(event) => {
                const at = locate(event.clientX, event.clientY, false)
                if (at) drop(event, at.day, false)
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) showGhost(null)
              }}
            />
          )}
          {mode === 'year' && (
            <CalendarYear
              year={date.slice(0, 4)}
              current={current}
              firstDay={options.firstDay}
              layout={layout}
              onShowDay={showDay}
              onShowMonth={(day) => {
                setDate(day)
                setMode('month')
              }}
            />
          )}
          {mode === 'agenda' && (
            <CalendarAgenda
              layout={layout}
              current={current}
              nowMinute={nowMinute}
              disabled={disabled}
              selectedId={selectedId}
              projects={projects}
              onSelect={selectTask}
              onToggle={toggleTask}
            />
          )}
          {gridView && (
          <div
            className="calendar-grid"
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) showGhost(null)
            }}
          >
            <div className="calendar-sticky">
              <div className="calendar-day-headings">
                <span />
                {days.map((day) => (
                  <div key={day} className={day === current ? 'is-today' : ''}>
                    <button
                      disabled={mobile || daysCount === 1}
                      aria-label={`Show ${day}`}
                      onClick={() => showDay(day)}
                    >
                      <span>{calendarDate(day).toLocaleString('en-US', { weekday: 'short' })}</span>
                      <strong>{Number(day.slice(-2))}</strong>
                    </button>
                  </div>
                ))}
              </div>
              <div
                className="calendar-all-day"
                onDragOver={(event) => {
                  if (!event.dataTransfer.types.includes(dragType)) return
                  event.preventDefault()
                  const at = locate(event.clientX, event.clientY, false)
                  if (at) showDrop(at.day, null)
                }}
                onDrop={(event) => {
                  const at = locate(event.clientX, event.clientY, false)
                  if (at) drop(event, at.day, false)
                }}
              >
                <span className="calendar-gutter">All day</span>
                {days.map((day, index) => (
                  <div
                    key={day}
                    className="calendar-all-day-cell"
                    data-calendar-day={day}
                    style={{ gridColumn: index + 2 }}
                    onPointerDown={(event) => {
                      if (event.target === event.currentTarget) beginCreate(event, day, null)
                    }}
                    onClick={(event) => {
                      if (mobile && !disabled && event.target === event.currentTarget)
                        openDraft({ kind: 'allDay', start: day, end: addDays(day, 1) })
                    }}
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
                  </div>
                ))}
                {bars.map((bar) => renderItem(bar.item, false, bar))}
                {ghostDays && ghostDays.from >= 0 && ghostDays.to >= ghostDays.from && (
                  <div
                    className="calendar-ghost is-all-day"
                    style={{
                      gridColumn: `${ghostDays.from + 2} / span ${ghostDays.to - ghostDays.from + 1}`,
                    }}
                  >
                    {shownGhost?.label}
                  </div>
                )}
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
                      dragOverEdge(event.clientY)
                      showDrop(day, dropTop(event.currentTarget, event.clientY, dragging.current))
                    }
                  }}
                  onDrop={(event) => drop(event, day, true)}
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
                    .sort((a, b) => a.lane - b.lane)
                    .map((item) => renderItem(item, true))}
                  {shownGhost?.timed
                    ?.filter((segment) => segment.day === day)
                    .map((segment) => (
                      <div
                        key={segment.start}
                        className="calendar-ghost"
                        style={{
                          top: ((segment.start - firstMinute) / 60) * zoom,
                          height: ((segment.end - segment.start) / 60) * zoom,
                        }}
                      >
                        {segment === shownGhost.timed?.[0] && shownGhost.label}
                      </div>
                    ))}
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
          )}
          {hiddenItems.length > 0 && (
            <div ref={overflowList} tabIndex={-1} aria-label="Additional calendar tasks">
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
                      onDragStart={(event) => startDrag(event, { id: task.id, marker: false })}
                      onDragEnd={endDrag}
                    >
                      <span>
                        {task.title}
                        {effectiveDueDate(task, zone) && (
                          <small>Due {formatDate(effectiveDueDate(task, zone)!)}</small>
                        )}
                      </span>
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
          key={draftKey}
          initial={draft}
          projects={projects}
          disabled={disabled}
          mobile={mobile}
          dirty={draftDirty}
          onChange={setDraft}
          onClose={closeDraft}
          onCreated={(title) => setAnnouncement(`Created ${title}`)}
          restoreFocus={() => {
            // Clicking another cell replaces the draft, and the new one keeps the focus.
            if (draftOpen.current) return
            const trigger = draftTrigger.current
            if (trigger?.isConnected) trigger.focus({ preventScroll: true })
            else draftRef.current?.focus()
          }}
        />
      )}
    </div>
  )
}
