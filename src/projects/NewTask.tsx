import { DateCalendar } from '../components/DateField'
import {
  addDays,
  calendarDate,
  displayZone,
  resolveWallTime,
  subscribeDisplayZone,
  type TaskSchedule,
} from './schedule'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import AppTooltip from '../components/AppTooltip'
import { useApp } from '../app/context'
import type { Appearance } from '../model'
import { platform } from '../platform'
import { Calendar, Plus, X } from '../icons'
import { createTaskConfirmed } from './actions'
import { daysBetween, formatDate, today } from './model'
import {
  moveDismissedDates,
  recognizeDates,
  recognizeTimes,
  taskTitle,
  type ScheduleMatch,
} from './smartInput'

/** Re-evaluate calendar phrases at local midnight and when returning to the app. */
function useToday() {
  const [current, setCurrent] = useState(today)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const refresh = () => {
      setCurrent(today())
      const next = calendarDate(today()).add({ days: 1 }).toZonedDateTime(displayZone())
      clearTimeout(timer)
      timer = setTimeout(refresh, next.epochMilliseconds - Date.now() + 50)
    }
    refresh()
    const unsubscribe = subscribeDisplayZone(refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearTimeout(timer)
      unsubscribe()
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])
  return current
}

export default function NewTask(props: {
  projectId: string | null
  disabled: boolean
  dueToday?: boolean
}) {
  const app = useApp()
  return <NewTaskForm {...props} appearance={app.appearance} onAppearance={app.setAppearance} />
}

export function NewTaskForm({
  projectId,
  disabled,
  dueToday = false,
  appearance,
  onAppearance,
}: {
  projectId: string | null
  disabled: boolean
  dueToday?: boolean
  appearance: Appearance
  onAppearance: (appearance: Appearance) => void
}) {
  const [draft, setDraft] = useState('')
  const [dismissed, setDismissed] = useState<ScheduleMatch[]>([])
  const [explicit, setExplicit] = useState<{
    date: string | null
    time: string | null
    endTime?: string | null
  } | null>(null)
  const enabled = appearance.smartTaskDates
  const keepDateWords = appearance.keepTaskDateWords
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [offset, setOffset] = useState<'' | 'earlier' | 'later'>('')
  const input = useRef<HTMLInputElement>(null)
  const mirror = useRef<HTMLDivElement>(null)
  // Touch keyboards compose every word, and Enter ends the word, so only desktop IMEs hold Enter.
  const composing = useRef(false)
  const imeComposing = () => !platform.mobile && composing.current
  const id = useId()
  const current = useToday()
  const tomorrow = addDays(current, 1)
  const eligible = (candidate: ScheduleMatch) =>
    !dismissed.some((item) => item.start === candidate.start && item.text === candidate.text)
  const automatic = enabled && explicit === null
  const dateMatch = automatic ? recognizeDates(draft, current).filter(eligible).at(-1) : undefined
  const timeMatch = automatic ? recognizeTimes(draft).filter(eligible).at(-1) : undefined
  const matches = [dateMatch, timeMatch]
    .filter((match): match is ScheduleMatch => !!match)
    .sort((a, b) => a.start - b.start)
  const dueDate = explicit
    ? explicit.date
    : (dateMatch?.date ?? (timeMatch || dueToday ? current : null))
  const dueTime = dueDate ? (explicit ? explicit.time : (timeMatch?.time ?? null)) : null
  const dayLabel = dueDate
    ? daysBetween(current, dueDate) === 0
      ? 'Today'
      : daysBetween(current, dueDate) === 1
        ? 'Tomorrow'
        : formatDate(dueDate, current)
    : 'No due date'
  const endTime = dueTime ? (explicit ? explicit.endTime : timeMatch?.endTime) : null
  const nextDay = endTime && dueTime && endTime < dueTime
  const label = `${dayLabel}${dueTime ? `, ${dueTime}${endTime ? ` to ${endTime}${nextDay ? ' next day' : ''}` : ''}` : ''}`
  const prefix = dueTime ? 'Schedule' : 'Due'
  const spanKey = matches.map((match) => `${match.start}:${match.end}`).join(',')
  const placeholder = dueToday ? 'New task due today' : 'New task'
  const syncScroll = () => {
    if (mirror.current && input.current)
      mirror.current.style.transform = `translateX(${-input.current.scrollLeft}px)`
  }
  useLayoutEffect(syncScroll, [draft, spanKey])

  const reset = () => {
    setDraft('')
    setDismissed([])
    setExplicit(null)
    setOffset('')
    setError('')
  }
  const cancelMatch = (match?: ScheduleMatch) => {
    setDismissed((items) => [...items, ...(match ? [match] : matches)])
    input.current?.focus()
  }

  return (
    <form
      className="new-task"
      onSubmit={async (event) => {
        event.preventDefault()
        if (disabled || saving || imeComposing() || !draft.trim()) return
        setError('')
        try {
          let schedule: TaskSchedule | null = null
          if (dueDate && dueTime) {
            const zone = displayZone()
            const start = resolveWallTime(dueDate, dueTime, zone, offset || undefined)
            schedule = endTime
              ? {
                  kind: 'range',
                  start,
                  end: resolveWallTime(
                    endTime < dueTime ? addDays(dueDate, 1) : dueDate,
                    endTime,
                    zone,
                    offset || undefined,
                  ),
                  timeZone: zone,
                }
              : { kind: 'point', start, timeZone: zone }
          }
          setSaving(true)
          await createTaskConfirmed(projectId, taskTitle(draft, matches, keepDateWords), {
            dueDate: schedule ? null : dueDate,
            dueTime: null,
            schedule,
            dueLinked: !!schedule,
          })
          reset()
        } catch (error) {
          setError(String(error))
        } finally {
          setSaving(false)
        }
      }}
    >
      <Plus aria-hidden="true" />
      <div className="smart-task-field">
        <div className="smart-task-overlay" aria-hidden="true">
          <div className="smart-task-mirror" ref={mirror}>
            {matches.map((match, index) => (
              <span key={`${match.start}:${match.text}`}>
                {draft.slice(index ? matches[index - 1].end : 0, match.start)}
                <button
                  type="button"
                  tabIndex={-1}
                  className="smart-task-match"
                  disabled={disabled || saving}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => cancelMatch(match)}
                >
                  {match.text}
                </button>
              </span>
            ))}
            {draft.slice(matches.at(-1)?.end ?? 0)}
          </div>
        </div>
        <input
          ref={input}
          className="new-task-input"
          aria-label={placeholder}
          aria-describedby={`${id}-preview`}
          placeholder={placeholder}
          value={draft}
          maxLength={500}
          disabled={disabled}
          readOnly={saving}
          autoComplete="off"
          enterKeyHint="done"
          onScroll={syncScroll}
          onSelect={syncScroll}
          onKeyUp={syncScroll}
          onCompositionStart={() => {
            composing.current = true
          }}
          onCompositionEnd={() => {
            composing.current = false
          }}
          onChange={(event) => {
            const next = event.target.value
            setDismissed((items) => moveDismissedDates(draft, next, items))
            setDraft(next)
          }}
          onKeyDown={(event) => {
            if (saving) return
            if (
              !platform.mobile &&
              (event.nativeEvent.isComposing || composing.current || event.keyCode === 229)
            ) {
              if (event.key === 'Enter') event.preventDefault()
              return
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              reset()
            }
            if (matches.length && ['Backspace', 'Delete'].includes(event.key)) {
              const { selectionStart: start, selectionEnd: end } = event.currentTarget
              const match = matches.find(
                (match) =>
                  (start === match.start && end === match.end) ||
                  (start === end &&
                    (event.key === 'Backspace' ? end === match.end : start === match.start)),
              )
              if (match) {
                event.preventDefault()
                cancelMatch(match)
              }
            }
          }}
        />
      </div>
      <span className="sr-only" id={`${id}-preview`} role="status">
        {`${prefix}: ${label}${dueDate ? ` (${dueDate})` : ''}.${dueTime ? ' Due day follows the schedule.' : ''}`}
        {matches.length > 0 &&
          ` Recognized ${matches.map((match) => `“${match.text}”`).join(' and ')}. ${keepDateWords ? 'Recognized words stay in the title.' : 'Recognized words are removed when added.'} Select recognized words and press Delete to keep them as text.`}
      </span>
      <div className="smart-task-date">
        <Popover.Root open={open && !disabled} onOpenChange={setOpen}>
          <AppTooltip
            label={
              dueDate ? `${prefix}: ${label}. Change date` : 'Set due date and smart input options'
            }
          >
            <Popover.Trigger asChild>
              <button
                type="button"
                className="btn btn-plain btn-sm smart-task-date-trigger"
                aria-label={`${prefix}: ${label}. Change date`}
                disabled={disabled || saving}
              >
                <Calendar aria-hidden="true" />
                {dueDate && <span>{label}</span>}
              </button>
            </Popover.Trigger>
          </AppTooltip>
          <Popover.Portal>
            <Popover.Content
              className="popover smart-task-options"
              align="end"
              sideOffset={6}
              collisionPadding={8}
              aria-label="Task date and smart input"
            >
              <div className="date-picker is-inline" role="group" aria-label="Due date">
                <DateCalendar
                  value={dueDate}
                  onChange={(date) => {
                    if (!disabled && !saving) setExplicit({ date, time: dueTime, endTime })
                  }}
                />
              </div>
              <label className="field-label" htmlFor={`${id}-time`}>
                Scheduled time
              </label>
              <div className="smart-task-shortcuts">
                <input
                  id={`${id}-time`}
                  className="field smart-task-time"
                  type="time"
                  value={dueTime ?? ''}
                  disabled={disabled || saving}
                  onChange={(event) =>
                    setExplicit({
                      date: dueDate ?? current,
                      time: event.target.value || null,
                      endTime,
                    })
                  }
                />
                {dueTime && (
                  <button
                    type="button"
                    className="btn btn-plain btn-sm"
                    disabled={disabled || saving}
                    onClick={() => setExplicit({ date: dueDate, time: null })}
                  >
                    Clear time
                  </button>
                )}
              </div>
              {dueTime && (
                <>
                  <label className="field-label" htmlFor={`${id}-end-time`}>
                    End time (optional)
                  </label>
                  <input
                    id={`${id}-end-time`}
                    className="field"
                    type="time"
                    value={endTime ?? ''}
                    disabled={disabled || saving}
                    onChange={(event) =>
                      setExplicit({
                        date: dueDate,
                        time: dueTime,
                        endTime: event.target.value || null,
                      })
                    }
                  />
                </>
              )}
              <div className="smart-task-shortcuts">
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={disabled || saving}
                  onClick={() => setExplicit({ date: current, time: dueTime, endTime })}
                >
                  Today
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={disabled || saving}
                  onClick={() =>
                    setExplicit({
                      date: tomorrow,
                      time: dueTime,
                      endTime,
                    })
                  }
                >
                  Tomorrow
                </button>
                <button
                  type="button"
                  className="btn btn-plain btn-sm"
                  disabled={disabled || saving}
                  onClick={() => setExplicit({ date: null, time: null })}
                >
                  No date
                </button>
              </div>
              {explicit && (
                <button
                  type="button"
                  className="btn-link"
                  disabled={disabled || saving}
                  onClick={() => {
                    setExplicit(null)
                    setDismissed([])
                  }}
                >
                  Use date and time from text
                </button>
              )}
              <div className="menu-separator" />
              <label className="smart-task-option">
                <input
                  type="checkbox"
                  checked={enabled}
                  disabled={disabled || saving}
                  onChange={(event) =>
                    onAppearance({ ...appearance, smartTaskDates: event.target.checked })
                  }
                />
                Recognize dates and times
              </label>
              <label className="smart-task-option">
                <input
                  type="checkbox"
                  checked={keepDateWords}
                  disabled={disabled || !enabled}
                  onChange={(event) =>
                    onAppearance({ ...appearance, keepTaskDateWords: event.target.checked })
                  }
                />
                Keep recognized words in title
              </label>
              <p className="field-help">
                Try “tomorrow @2pm” or “at 14:30”. Try “2pm to 3pm” for a range. Times without a
                date use today. Repeats and reminders stay as text.
              </p>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        {matches.length > 0 && (
          <AppTooltip instant label="Cancel recognition and keep words">
            <button
              type="button"
              className="icon-btn-sm"
              aria-label="Cancel schedule recognition"
              disabled={disabled || saving}
              onClick={() => cancelMatch()}
            >
              <X aria-hidden="true" />
            </button>
          </AppTooltip>
        )}
        {!matches.length && dueDate && (
          <AppTooltip instant label="Clear due date">
            <button
              type="button"
              className="icon-btn-sm"
              aria-label="Clear due date"
              disabled={disabled || saving}
              onClick={() => setExplicit({ date: null, time: null })}
            >
              <X aria-hidden="true" />
            </button>
          </AppTooltip>
        )}
      </div>
      {draft && <kbd aria-hidden="true">↵</kbd>}
      {error && (
        <div className="smart-task-error">
          <p className="field-error" role="alert">
            {error}
          </p>
          {error.includes('occurs twice') && (
            <label className="field-label">
              Repeated time
              <select
                className="field"
                aria-label="Repeated time"
                value={offset}
                onChange={(event) => setOffset(event.target.value as typeof offset)}
              >
                <option value="">Choose offset</option>
                <option value="earlier">Earlier offset</option>
                <option value="later">Later offset</option>
              </select>
            </label>
          )}
        </div>
      )}
    </form>
  )
}
