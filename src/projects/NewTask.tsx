import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import AppTooltip from '../components/AppTooltip'
import { DateCalendar } from '../components/DateField'
import { useApp } from '../app/context'
import { Calendar, Plus, X } from '../icons'
import { createTask } from './actions'
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
      const next = new Date()
      next.setHours(24, 0, 0, 0)
      clearTimeout(timer)
      timer = setTimeout(refresh, next.getTime() - Date.now() + 50)
    }
    refresh()
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])
  return current
}

export default function NewTask({
  projectId,
  disabled,
  dueToday = false,
}: {
  projectId: string | null
  disabled: boolean
  dueToday?: boolean
}) {
  const app = useApp()
  const [draft, setDraft] = useState('')
  const [dismissed, setDismissed] = useState<ScheduleMatch[]>([])
  const [explicit, setExplicit] = useState<{ date: string | null; time: string | null } | null>(
    null,
  )
  const enabled = app.appearance.smartTaskDates
  const keepDateWords = app.appearance.keepTaskDateWords
  const [open, setOpen] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const mirror = useRef<HTMLDivElement>(null)
  const composing = useRef(false)
  const id = useId()
  const current = useToday()
  const tomorrow = new Date(`${current}T12:00:00Z`)
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
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
  const label = `${dayLabel}${dueTime ? `, ${dueTime}` : ''}`
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
  }
  const cancelMatch = (match?: ScheduleMatch) => {
    setDismissed((items) => [...items, ...(match ? [match] : matches)])
    input.current?.focus()
  }

  return (
    <form
      className="new-task"
      onSubmit={(event) => {
        event.preventDefault()
        if (disabled || composing.current || !draft.trim()) return
        createTask(projectId, taskTitle(draft, matches, keepDateWords), { dueDate, dueTime })
        reset()
        input.current?.focus()
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
                  disabled={disabled}
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
          autoComplete="off"
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
            if (event.nativeEvent.isComposing || composing.current || event.keyCode === 229) {
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
        {`Due: ${label}${dueDate ? ` (${dueDate})` : ''}.`}
        {matches.length > 0 &&
          ` Recognized ${matches.map((match) => `“${match.text}”`).join(' and ')}. ${keepDateWords ? 'Recognized words stay in the title.' : 'Recognized words are removed when added.'} Select recognized words and press Delete to keep them as text.`}
      </span>
      <div className="smart-task-date">
        <Popover.Root open={open && !disabled} onOpenChange={setOpen}>
          <AppTooltip
            label={dueDate ? `Due ${label}. Change date` : 'Set due date and smart input options'}
          >
            <Popover.Trigger asChild>
              <button
                type="button"
                className="btn btn-plain btn-sm smart-task-date-trigger"
                aria-label={`Due: ${label}. Change date`}
                disabled={disabled}
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
                    if (!disabled) setExplicit({ date, time: dueTime })
                  }}
                />
              </div>
              <label className="field-label" htmlFor={`${id}-time`}>
                Due time
              </label>
              <div className="smart-task-shortcuts">
                <input
                  id={`${id}-time`}
                  className="field smart-task-time"
                  type="time"
                  value={dueTime ?? ''}
                  disabled={disabled}
                  onChange={(event) =>
                    setExplicit({ date: dueDate ?? current, time: event.target.value || null })
                  }
                />
                {dueTime && (
                  <button
                    type="button"
                    className="btn btn-plain btn-sm"
                    disabled={disabled}
                    onClick={() => setExplicit({ date: dueDate, time: null })}
                  >
                    Clear time
                  </button>
                )}
              </div>
              <div className="smart-task-shortcuts">
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={disabled}
                  onClick={() => setExplicit({ date: current, time: dueTime })}
                >
                  Today
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={disabled}
                  onClick={() =>
                    setExplicit({ date: tomorrow.toISOString().slice(0, 10), time: dueTime })
                  }
                >
                  Tomorrow
                </button>
                <button
                  type="button"
                  className="btn btn-plain btn-sm"
                  disabled={disabled}
                  onClick={() => setExplicit({ date: null, time: null })}
                >
                  No date
                </button>
              </div>
              {explicit && (
                <button
                  type="button"
                  className="btn-link"
                  disabled={disabled}
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
                  disabled={disabled}
                  onChange={(event) =>
                    app.setAppearance({ ...app.appearance, smartTaskDates: event.target.checked })
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
                    app.setAppearance({
                      ...app.appearance,
                      keepTaskDateWords: event.target.checked,
                    })
                  }
                />
                Keep recognized words in title
              </label>
              <p className="field-help">
                Try “tomorrow @2pm” or “at 14:30”. Times without a date use today. Repeats and
                reminders stay as text.
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
              disabled={disabled}
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
              disabled={disabled}
              onClick={() => setExplicit({ date: null, time: null })}
            >
              <X aria-hidden="true" />
            </button>
          </AppTooltip>
        )}
      </div>
      {draft && <kbd aria-hidden="true">↵</kbd>}
    </form>
  )
}
