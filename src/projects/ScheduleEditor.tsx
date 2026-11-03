import { useEffect, useId, useState } from 'react'
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
  const field = (
    key: 'date' | 'time' | 'endDate' | 'endTime' | 'zone',
    label: string,
    type: string,
  ) => (
    <label className="field-label" htmlFor={`${id}-${key}`}>
      {label}
      <input
        id={`${id}-${key}`}
        className="field"
        type={type}
        value={value[key]}
        disabled={disabled}
        min={type === 'date' ? '0001-01-01' : undefined}
        max={type === 'date' ? '9999-12-30' : undefined}
        onChange={(event) =>
          onChange({
            ...value,
            [key]: event.target.value,
            ...(['date', 'time', 'zone'].includes(key) ? { offset: '' } : {}),
            ...(['endDate', 'endTime', 'zone'].includes(key) ? { endOffset: '' } : {}),
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
            onChange({ ...value, kind: event.target.value as ScheduleDraft['kind'] })
          }
        >
          <option value="none">No scheduled time</option>
          <option value="allDay">All-day range</option>
          <option value="point">Time point</option>
          <option value="range">Time range</option>
        </select>
      </label>
      {value.kind !== 'none' && (
        <>
          {field('date', 'Scheduled day', 'date')}
          {value.kind !== 'allDay' && field('time', 'Start time', 'time')}
          {value.kind !== 'point' && (
            <>
              {field(
                'endDate',
                value.kind === 'allDay' ? 'Last day (included)' : 'End day',
                'date',
              )}
              {value.kind === 'range' && field('endTime', 'End time', 'time')}
            </>
          )}
          {value.kind !== 'allDay' && (
            <>
              {field('zone', 'Entry time zone', 'text')}
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
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (!saving) {
      setDraft(scheduleDraft(schedule))
      setError('')
    }
  }, [schedule])
  return (
    <form
      className="schedule-editor"
      onSubmit={async (event) => {
        event.preventDefault()
        setError('')
        try {
          const next = scheduleFromDraft(draft)
          setSaving(true)
          await onSave(next)
        } catch (error) {
          setError(String(error))
        } finally {
          setSaving(false)
        }
      }}
    >
      <ScheduleFields value={draft} onChange={setDraft} disabled={disabled || saving} />
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
      <button className="btn btn-sm" disabled={disabled || saving}>
        {saving ? 'Saving…' : 'Apply schedule'}
      </button>
      <p className="field-help">
        Timed tasks display in the calendar’s time zone. All-day dates stay fixed. Times do not
        create reminders.
      </p>
    </form>
  )
}
