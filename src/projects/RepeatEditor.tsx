import { useEffect, useId, useState } from 'react'
import AppTooltip from '../components/AppTooltip'
import { Repeat } from '../icons'
import { updateTask } from './actions'
import { formatDate, today, type Task } from './model'
import {
  formatRepeat,
  maxRepeatInterval,
  nextOccurrence,
  repeatAnchor,
  weekdayNames,
  type TaskRepeat,
} from './repeat'
import { calendarDate } from './schedule'

type Preset = 'none' | TaskRepeat['unit'] | 'custom'
const units: { id: TaskRepeat['unit']; label: string }[] = [
  { id: 'day', label: 'days' },
  { id: 'week', label: 'weeks' },
  { id: 'month', label: 'months' },
  { id: 'year', label: 'years' },
]
const ordinal = (day: number) => {
  const tens = day % 100
  const suffix = tens >= 11 && tens <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][day % 10] ?? 'th')
  return `${day}${suffix}`
}
const isPlain = (repeat: TaskRepeat, weekday: number) =>
  repeat.interval === 1 &&
  (!repeat.weekdays?.length || (repeat.weekdays.length === 1 && repeat.weekdays[0] === weekday))

/** Marks a repeating task in rows and cards. */
export function RepeatMark({ repeat }: { repeat: TaskRepeat }) {
  const label = `Repeats: ${formatRepeat(repeat)}`
  return (
    <AppTooltip label={label}>
      <span className="task-due" role="img" aria-label={label}>
        <Repeat aria-hidden="true" />
      </span>
    </AppTooltip>
  )
}

export default function RepeatEditor({ task, disabled }: { task: Task; disabled: boolean }) {
  const id = useId()
  const repeat = task.repeat ?? null
  const current = today()
  const anchor = repeatAnchor(task) ?? current
  const date = calendarDate(anchor)
  const [custom, setCustom] = useState(false)
  const [interval, setInterval] = useState(String(repeat?.interval ?? 1))
  useEffect(() => setInterval(String(repeat?.interval ?? 1)), [repeat?.interval])
  useEffect(() => setCustom(false), [task.id])
  const preset: Preset = !repeat
    ? 'none'
    : custom || !isPlain(repeat, date.dayOfWeek)
      ? 'custom'
      : repeat.unit
  const fromSchedule = repeat?.from !== 'completion'
  const set = (next: TaskRepeat | null) =>
    // A repeat needs a date to come back to, so a dateless task starts today.
    updateTask(task, next && !repeatAnchor(task) ? { repeat: next, dueDate: current } : { repeat: next })
  const rule = (unit: TaskRepeat['unit'], from = repeat?.from ?? 'schedule', every = 1): TaskRepeat => ({
    unit,
    interval: every,
    from,
    ...(unit === 'week' && from === 'schedule' ? { weekdays: [date.dayOfWeek] } : {}),
  })
  const toggleDay = (day: number) => {
    if (!repeat) return
    const days = repeat.weekdays ?? []
    set({ ...repeat, weekdays: days.includes(day) ? days.filter((d) => d !== day) : [...days, day] })
  }
  const on = fromSchedule
    ? {
        week: ` on ${weekdayNames[date.dayOfWeek - 1]}`,
        month: ` on the ${ordinal(date.day)}`,
        year: ` on ${formatDate(anchor, `${anchor.slice(0, 4)}-01-01`)}`,
      }
    : { week: '', month: '', year: '' }
  return (
    <div className="repeat-editor">
      <label htmlFor={`${id}-preset`}>Repeat</label>
      <select
        id={`${id}-preset`}
        className="field"
        value={preset}
        disabled={disabled}
        onChange={(event) => {
          const value = event.target.value as Preset
          setCustom(value === 'custom')
          if (value === 'none') set(null)
          else if (value === 'custom') {
            if (!repeat) set(rule('week'))
          } else set(rule(value))
        }}
      >
        <option value="none">Never</option>
        <option value="day">Daily</option>
        <option value="week">Weekly{on.week}</option>
        <option value="month">Monthly{on.month}</option>
        <option value="year">Yearly{on.year}</option>
        <option value="custom">Custom…</option>
      </select>
      {repeat && preset === 'custom' && (
        <>
          <label htmlFor={`${id}-interval`}>Every</label>
          <div className="repeat-interval">
            <input
              id={`${id}-interval`}
              className="field"
              type="number"
              inputMode="numeric"
              min={1}
              max={maxRepeatInterval}
              value={interval}
              disabled={disabled}
              onChange={(event) => {
                setInterval(event.target.value)
                const value = Number(event.target.value)
                if (Number.isInteger(value) && value >= 1 && value <= maxRepeatInterval)
                  set({ ...repeat, interval: value })
              }}
              onBlur={() => setInterval(String(repeat.interval))}
            />
            <select
              className="field"
              aria-label="Repeat unit"
              value={repeat.unit}
              disabled={disabled}
              onChange={(event) =>
                set(rule(event.target.value as TaskRepeat['unit'], repeat.from, repeat.interval))
              }
            >
              {units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.label}
                </option>
              ))}
            </select>
          </div>
          {repeat.unit === 'week' && fromSchedule && (
            <>
              <span className="repeat-label">On</span>
              <div className="repeat-days" role="group" aria-label="Repeat on">
                {weekdayNames.map((name, index) => {
                  const pressed = !!repeat.weekdays?.includes(index + 1)
                  return (
                    <button
                      key={name}
                      type="button"
                      className="repeat-day"
                      aria-label={name}
                      aria-pressed={pressed}
                      // A weekly repeat from the schedule always keeps one day.
                      disabled={disabled || (pressed && repeat.weekdays?.length === 1)}
                      onClick={() => toggleDay(index + 1)}
                    >
                      {name.slice(0, 1)}
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </>
      )}
      {repeat && (
        <>
          <label htmlFor={`${id}-from`}>From</label>
          <select
            id={`${id}-from`}
            className="field"
            value={repeat.from}
            disabled={disabled}
            onChange={(event) =>
              set(rule(repeat.unit, event.target.value as TaskRepeat['from'], repeat.interval))
            }
          >
            <option value="schedule">Scheduled date</option>
            <option value="completion">After completion</option>
          </select>
          <p className="field-help">
            {fromSchedule
              ? `After you complete this, it returns on ${formatDate(nextOccurrence(repeat, anchor, current).date, current)}.`
              : `After you complete this, it returns ${formatRepeat(repeat)}.`}
          </p>
        </>
      )}
    </div>
  )
}
