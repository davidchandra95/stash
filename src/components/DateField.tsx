import * as Popover from '@radix-ui/react-popover'
import { useEffect, useRef, useState } from 'react'
import { calendarDate } from '../editor/datePicker'
import { Calendar as CalendarIcon } from '../icons'
import { today } from '../projects/model'
import Calendar from './Calendar'

/** Dates are stored as local YYYY-MM-DD strings. */
const parse = (value: string) => {
  const [year, month, day] = value.split('-').map(Number)
  return calendarDate(year, month - 1, day)
}

/** A calendar bound to a stored date. The month shown follows the value when it changes. */
export function DateCalendar({
  value,
  onChange,
}: {
  value: string | null
  onChange: (date: string) => void
}) {
  const [day, setDay] = useState(() => parse(value ?? today()))
  useEffect(() => {
    if (value) setDay(parse(value))
  }, [value])
  return (
    <Calendar
      day={day}
      selected={value ? parse(value) : null}
      onMove={setDay}
      onSelect={(date) => {
        const year = String(date.getFullYear()).padStart(4, '0')
        const month = String(date.getMonth() + 1).padStart(2, '0')
        const day = String(date.getDate()).padStart(2, '0')
        onChange(`${year}-${month}-${day}`)
      }}
    />
  )
}

/** A field that shows a date and opens a calendar popover to change or clear it. */
export default function DateField({
  id,
  label,
  value,
  onChange,
  disabled = false,
  clearable = true,
  className = '',
}: {
  id?: string
  label: string
  value: string | null
  onChange: (date: string | null) => void
  disabled?: boolean
  clearable?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const content = useRef<HTMLDivElement>(null)
  const text = value
    ? parse(value).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : 'No date'
  const choose = (date: string | null) => {
    onChange(date)
    setOpen(false)
  }
  return (
    <Popover.Root open={open && !disabled} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          id={id}
          type="button"
          className={`field date-field ${className}`}
          aria-label={`${label}: ${text}`}
          disabled={disabled}
        >
          <CalendarIcon aria-hidden="true" />
          <span className={value ? undefined : 'date-field-empty'}>{text}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          ref={content}
          className="popover date-picker"
          side="bottom"
          align="start"
          sideOffset={5}
          collisionPadding={8}
          aria-label={label}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            content.current
              ?.querySelector<HTMLButtonElement>('[data-calendar-day][tabindex="0"]')
              ?.focus()
          }}
        >
          <DateCalendar value={value} onChange={choose} />
          <div className="date-field-footer">
            <button type="button" className="date-today" onClick={() => choose(today())}>
              Today
            </button>
            {value && clearable && (
              <button type="button" className="date-clear" onClick={() => choose(null)}>
                Clear
              </button>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
