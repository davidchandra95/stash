import { useEffect, useRef, useState, type CSSProperties } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Check } from '../icons'
import { formatDate, today } from '../projects/model'
import { notebookColorValue } from '../notebookColors'
import { checkinOf, setCheckin } from './actions'
import { maxCheckinNote, weekdayLabel, weekdayOf, type Habit, type HabitCheckin, type HabitFrequency } from './model'

const longDay = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
/** "Tue, Nov 3" */
export const formatDay = (date: string) => longDay.format(new Date(`${date}T00:00:00Z`))

export const habitColor = (habit: Pick<Habit, 'color'>) =>
  ({ '--habit': notebookColorValue(habit.color) ?? 'var(--accent)' }) as CSSProperties

/**
 * One day of one habit. Clicking a day that isn't done checks it off and opens its note, so a
 * note like "Read chapter 3" is one click and some typing away; Escape or clicking elsewhere
 * keeps the check-in. Clicking a done day opens the note with Mark not done.
 */
export function HabitDay({
  habit,
  date,
  checkin,
  due,
  disabled,
  label,
}: {
  habit: Habit
  date: string
  checkin: HabitCheckin | undefined
  due: boolean
  disabled: boolean
  /** Visible text inside the cell, such as the day number in a month. */
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(checkin?.note ?? '')
  const noteRef = useRef<HTMLTextAreaElement>(null)
  const future = date > today()
  const done = !!checkin?.done
  const note = checkin?.note ?? ''
  useEffect(() => {
    if (!open) setDraft(note)
  }, [note, open])
  const commit = () => {
    const latest = checkinOf(habit.id, date)
    if (draft !== (latest?.note ?? '')) setCheckin(habit, date, { note: draft })
  }
  const name = `${habit.name}, ${formatDay(date)}${done ? ', done' : ''}${note.trim() ? ', has a note' : ''}`
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) commit()
        setOpen(next)
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          className={`habit-day${done ? ' is-done' : ''}${due ? '' : ' is-off'}${date === today() ? ' is-today' : ''}`}
          style={habitColor(habit)}
          aria-label={name}
          aria-pressed={done}
          disabled={disabled || future}
          onClick={() => {
            if (!done) setCheckin(habit, date, { done: true })
          }}
        >
          {label !== undefined ? <span className="habit-day-number">{label}</span> : done && <Check aria-hidden="true" />}
          {note.trim() && <span className="habit-day-note" aria-hidden="true" />}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="popover habit-checkin"
          side="bottom"
          align="center"
          sideOffset={6}
          collisionPadding={8}
          aria-label={`${habit.name} on ${formatDay(date)}`}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            noteRef.current?.focus()
          }}
        >
          <div className="habit-checkin-header">
            <span className="habit-checkin-title">{habit.name}</span>
            <span className="habit-checkin-date">{formatDate(date)}</span>
          </div>
          <textarea
            ref={noteRef}
            className="field habit-checkin-note"
            aria-label="Check-in note"
            placeholder={done ? 'Add a note, like what you read' : 'Add a note'}
            rows={3}
            maxLength={maxCheckinNote}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                commit()
                setOpen(false)
              }
            }}
          />
          <div className="habit-checkin-footer">
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                commit()
                setCheckin(habit, date, { done: !done })
                setOpen(false)
              }}
            >
              {done ? 'Mark not done' : 'Mark done'}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => {
                commit()
                setOpen(false)
              }}
            >
              Done
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

/** Every day, chosen weekdays, or a number of times a week. */
export function FrequencyEditor({
  value,
  onChange,
  disabled,
}: {
  value: HabitFrequency
  onChange: (value: HabitFrequency) => void
  disabled?: boolean
}) {
  // Remember the other modes' choices while switching between them.
  const [days, setDays] = useState(value.kind === 'weekdays' ? value.days : [1, 2, 3, 4, 5])
  const [times, setTimes] = useState(value.kind === 'weekly' ? value.times : 3)
  return (
    <div className="habit-frequency">
      <div className="segmented" role="group" aria-label="Frequency">
        <button type="button" aria-pressed={value.kind === 'daily'} disabled={disabled} onClick={() => onChange({ kind: 'daily' })}>
          Daily
        </button>
        <button
          type="button"
          aria-pressed={value.kind === 'weekdays'}
          disabled={disabled}
          onClick={() => onChange({ kind: 'weekdays', days })}
        >
          Some days
        </button>
        <button
          type="button"
          aria-pressed={value.kind === 'weekly'}
          disabled={disabled}
          onClick={() => onChange({ kind: 'weekly', times })}
        >
          Weekly
        </button>
      </div>
      {value.kind === 'weekdays' && (
        <div className="filter-options" role="group" aria-label="Days">
          {[1, 2, 3, 4, 5, 6, 7].map((day) => {
            const pressed = value.days.includes(day)
            return (
              <button
                type="button"
                key={day}
                className="chip filter-option"
                aria-pressed={pressed}
                // The last chosen day stays: a habit needs at least one.
                disabled={disabled || (pressed && value.days.length === 1)}
                onClick={() => {
                  const next = pressed ? value.days.filter((d) => d !== day) : [...value.days, day].sort((a, b) => a - b)
                  setDays(next)
                  onChange({ kind: 'weekdays', days: next })
                }}
              >
                {weekdayLabel(day)}
              </button>
            )
          })}
        </div>
      )}
      {value.kind === 'weekly' && (
        <select
          className="field habit-times"
          aria-label="Times a week"
          value={value.times}
          disabled={disabled}
          onChange={(event) => {
            const next = Number(event.target.value)
            setTimes(next)
            onChange({ kind: 'weekly', times: next })
          }}
        >
          {[1, 2, 3, 4, 5, 6, 7].map((n) => (
            <option key={n} value={n}>
              {n === 1 ? 'Once a week' : `${n} times a week`}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}

export const isWeekend = (date: string) => weekdayOf(date) >= 6
