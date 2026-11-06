import { useEffect, useId, useRef, useState } from 'react'
import DateField from '../components/DateField'
import {
  addDays,
  clockAt,
  dayAt,
  displayZone,
  localTime,
  resolveWallTime,
  validateSchedule,
  type TaskSchedule,
} from './schedule'
import { today } from './model'

export interface ScheduleDraft {
  kind: 'none' | TaskSchedule['kind']
  date: string
  time: string
  endDate: string
  endTime: string
  zone: string
  offset: '' | 'earlier' | 'later'
  endOffset: '' | 'earlier' | 'later'
}
function repeatedOffsets(date: string, time: string, zone: string) {
  try {
    const early = resolveWallTime(date, time, zone, 'earlier')
    const late = resolveWallTime(date, time, zone, 'later')
    return early === late
      ? null
      : { early, late, earlier: localTime(early, zone).offset, later: localTime(late, zone).offset }
  } catch {
    return null
  }
}
function savedOffset(instant: number, zone: string) {
  const options = repeatedOffsets(dayAt(instant, zone), clockAt(instant, zone), zone)
  return options ? (instant >= options.late ? 'later' : 'earlier') : ''
}
export function scheduleDraft(schedule?: TaskSchedule | null, zone = displayZone()): ScheduleDraft {
  const timed = schedule && schedule.kind !== 'allDay' ? schedule : null
  const date =
    schedule?.kind === 'allDay'
      ? schedule.start
      : timed
        ? dayAt(timed.start, timed.timeZone)
        : today()
  return {
    kind: schedule?.kind ?? 'none',
    date,
    time: timed ? clockAt(timed.start, timed.timeZone) : '09:00',
    endDate:
      schedule?.kind === 'allDay'
        ? addDays(schedule.end, -1)
        : timed?.kind === 'range'
          ? dayAt(timed.end, timed.timeZone)
          : date,
    endTime: timed?.kind === 'range' ? clockAt(timed.end, timed.timeZone) : '10:00',
    zone: timed?.timeZone ?? zone,
    offset: timed ? savedOffset(timed.start, timed.timeZone) : '',
    endOffset: timed?.kind === 'range' ? savedOffset(timed.end, timed.timeZone) : '',
  }
}
export function scheduleFromDraft(draft: ScheduleDraft): TaskSchedule | null {
  if (draft.kind === 'none') return null
  let schedule: TaskSchedule
  if (draft.kind === 'allDay') {
    schedule = { kind: 'allDay', start: draft.date, end: addDays(draft.endDate, 1) }
  } else {
    const start = resolveWallTime(draft.date, draft.time, draft.zone, draft.offset || undefined)
    schedule =
      draft.kind === 'point'
        ? { kind: 'point', start, timeZone: draft.zone }
        : {
            kind: 'range',
            start,
            end: resolveWallTime(
              draft.endDate,
              draft.endTime,
              draft.zone,
              draft.endOffset || undefined,
            ),
            timeZone: draft.zone,
          }
  }
  validateSchedule(schedule)
  return schedule
}

const oneHourLater = (date: string, time: string) => {
  const [hour, minute] = time.split(':').map(Number)
  const end = hour * 60 + minute + 60
  return {
    endDate: end >= 1440 ? addDays(date, 1) : date,
    endTime: `${String(Math.floor(end / 60) % 24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
  }
}
/** A new kind starts from a valid end, so changing it never shows an error by itself. */
function withKind(value: ScheduleDraft, kind: ScheduleDraft['kind']): ScheduleDraft {
  const ended = value.endDate < value.date ? { ...value, endDate: value.date } : value
  if (kind !== 'range' || !value.time) return { ...ended, kind }
  const valid =
    ended.endDate > value.date || (ended.endDate === value.date && ended.endTime > value.time)
  return { ...ended, kind, ...(valid ? {} : oneHourLater(value.date, value.time)) }
}

export function ScheduleFields({
  value,
  onChange,
  disabled,
}: {
  value: ScheduleDraft
  onChange: (draft: ScheduleDraft) => void
  disabled: boolean
}) {
  const id = useId()
  const dateField = (key: 'date' | 'endDate', label: string) => (
    <div className="field-label">
      {label}
      <DateField
        id={`${id}-${key}`}
        label={label}
        value={value[key]}
        disabled={disabled}
        clearable={false}
        onChange={(date) => {
          if (!date) return
          onChange(
            key === 'date'
              ? {
                  ...value,
                  date,
                  endDate: value.endDate < date ? date : value.endDate,
                  offset: '',
                  endOffset: '',
                }
              : { ...value, endDate: date, endOffset: '' },
          )
        }}
      />
    </div>
  )
  const field = (key: 'time' | 'endTime' | 'zone', label: string, type: string) => (
    <label className="field-label" htmlFor={`${id}-${key}`}>
      {label}
      <input
        id={`${id}-${key}`}
        className="field"
        type={type}
        value={value[key]}
        disabled={disabled}
        onChange={(event) =>
          onChange({
            ...value,
            [key]: event.target.value,
            ...(['time', 'zone'].includes(key) ? { offset: '' } : {}),
            ...(['endTime', 'zone'].includes(key) ? { endOffset: '' } : {}),
          })
        }
        required
      />
    </label>
  )
  const offsetField = (key: 'offset' | 'endOffset', date: string, time: string, label: string) => {
    const offsets = repeatedOffsets(date, time, value.zone)
    if (!offsets) return null
    return (
      <label className="field-label" htmlFor={`${id}-${key}`}>
        {label}
        <select
          id={`${id}-${key}`}
          className="field"
          value={value[key]}
          disabled={disabled}
          required
          onChange={(event) =>
            onChange({ ...value, [key]: event.target.value as ScheduleDraft['offset'] })
          }
        >
          <option value="">Choose an offset</option>
          <option value="earlier">Earlier (UTC{offsets.earlier})</option>
          <option value="later">Later (UTC{offsets.later})</option>
        </select>
      </label>
    )
  }
  return (
    <div className="schedule-fields">
      <label className="field-label" htmlFor={`${id}-kind`}>
        Schedule
        <select
          id={`${id}-kind`}
          className="field"
          disabled={disabled}
          value={value.kind}
          onChange={(event) =>
            onChange(withKind(value, event.target.value as ScheduleDraft['kind']))
          }
        >
          <option value="none">No scheduled time</option>
          <option value="allDay">All day</option>
          <option value="point">At a time</option>
          <option value="range">Start and end</option>
        </select>
      </label>
      {value.kind !== 'none' && (
        <>
          {dateField('date', 'Day')}
          {value.kind !== 'allDay' && field('time', 'Start time', 'time')}
          {value.kind !== 'point' && (
            <>
              {dateField('endDate', value.kind === 'allDay' ? 'Last day' : 'End day')}
              {value.kind === 'range' && field('endTime', 'End time', 'time')}
            </>
          )}
          {value.kind !== 'allDay' && (
            <>
              {field('zone', 'Time zone', 'text')}
              {offsetField('offset', value.date, value.time, 'Repeated start time')}
              {value.kind === 'range' &&
                offsetField('endOffset', value.endDate, value.endTime, 'Repeated end time')}
            </>
          )}
        </>
      )}
    </div>
  )
}

const saveDelay = 500
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Edits save themselves once they're valid. A half-typed field waits until focus leaves. */
export default function ScheduleEditor({
  schedule,
  disabled,
  onSave,
}: {
  schedule?: TaskSchedule | null
  disabled: boolean
  onSave: (schedule: TaskSchedule | null) => Promise<void>
}) {
  const [draft, setDraft] = useState(() => scheduleDraft(schedule))
  const [error, setError] = useState('')
  const latest = useRef({ draft, onSave, saved: schedule ?? null })
  latest.current = { draft, onSave, saved: schedule ?? null }
  const pending = useRef(false)
  const saving = useRef(0)
  const queue = useRef(Promise.resolve())
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const flush = (leaving: boolean) => {
    clearTimeout(timer.current)
    if (!pending.current) return
    const { draft, onSave, saved } = latest.current
    let next: TaskSchedule | null
    try {
      next = scheduleFromDraft(draft)
    } catch (error) {
      const incomplete =
        !draft.time || !draft.zone.trim() || (draft.kind === 'range' && !draft.endTime)
      if (leaving || !incomplete) setError(errorText(error))
      return
    }
    pending.current = false
    setError('')
    if (JSON.stringify(next) === JSON.stringify(saved)) return
    saving.current += 1
    queue.current = queue.current
      .then(() => onSave(next))
      .catch((error) => setError(errorText(error)))
      .finally(() => {
        saving.current -= 1
      })
  }
  useEffect(() => {
    if (!pending.current && !saving.current) {
      setDraft(scheduleDraft(schedule))
      setError('')
    }
  }, [schedule])
  useEffect(() => () => flush(true), [])
  return (
    <form
      className="schedule-editor"
      aria-label="Work schedule"
      onSubmit={(event) => {
        event.preventDefault()
        flush(true)
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) flush(true)
      }}
    >
      <ScheduleFields
        value={draft}
        disabled={disabled}
        onChange={(next) => {
          pending.current = true
          setDraft(next)
          clearTimeout(timer.current)
          timer.current = setTimeout(() => flush(false), saveDelay)
        }}
      />
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
      {draft.kind !== 'none' && (
        <p className="field-help">
          {draft.kind === 'allDay'
            ? 'All-day dates stay fixed.'
            : 'Shown in the calendar’s time zone.'}
        </p>
      )}
    </form>
  )
}
