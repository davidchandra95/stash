import { useLayoutEffect, useRef } from 'react'
import { calendarDate, moveCalendarDate, moveCalendarMonth } from '../editor/datePicker'
import { ChevronLeft, ChevronRight } from '../icons'

const today = () => {
  const now = new Date()
  return calendarDate(now.getFullYear(), now.getMonth(), now.getDate())
}
const sameDay = (a: Date, b: Date) => a.getTime() === b.getTime()

/**
 * One month of days. `day` is the roving keyboard position and decides the month shown; the
 * grid always has six weeks so the popover keeps its size between months.
 */
export default function Calendar({
  day,
  selected,
  onMove,
  onSelect,
  onDayFocus,
}: {
  day: Date
  selected: Date | null
  onMove: (date: Date) => void
  onSelect: (date: Date) => void
  onDayFocus?: () => void
}) {
  const grid = useRef<HTMLDivElement>(null)
  const keyed = useRef(false)
  useLayoutEffect(() => {
    if (!keyed.current) return
    keyed.current = false
    grid.current?.querySelector<HTMLButtonElement>('[data-calendar-day][tabindex="0"]')?.focus()
  }, [day])
  const move = (date: Date) => {
    keyed.current = true
    onMove(date)
  }
  const first = calendarDate(day.getFullYear(), day.getMonth(), 1)
  const start = moveCalendarDate(first, -first.getDay())
  const week = Array.from({ length: 7 }, (_, i) =>
    calendarDate(2023, 0, 1 + i).toLocaleDateString(undefined, { weekday: 'short' }),
  )
  const current = today()
  return (
    <>
      <div className="date-picker-header">
        <span aria-live="polite">
          {day.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </span>
        <div className="date-picker-nav">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => onMove(moveCalendarMonth(day, -1))}
          >
            <ChevronLeft />
          </button>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => onMove(moveCalendarMonth(day, 1))}
          >
            <ChevronRight />
          </button>
        </div>
      </div>
      <div ref={grid} className="date-calendar" role="grid" aria-label="Calendar">
        <div className="date-calendar-row" role="row">
          {week.map((label, i) => (
            <span role="columnheader" key={i}>
              {label}
            </span>
          ))}
        </div>
        {Array.from({ length: 6 }, (_, row) => (
          <div className="date-calendar-row" role="row" key={row}>
            {Array.from({ length: 7 }, (_, col) => {
              const date = moveCalendarDate(start, row * 7 + col)
              return (
                <span
                  role="gridcell"
                  aria-selected={selected !== null && sameDay(date, selected)}
                  key={col}
                >
                  <button
                    type="button"
                    data-calendar-day
                    data-outside={date.getMonth() !== first.getMonth() || undefined}
                    tabIndex={sameDay(date, day) ? 0 : -1}
                    aria-label={date.toLocaleDateString(undefined, {
                      weekday: 'long',
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}
                    aria-current={sameDay(date, current) ? 'date' : undefined}
                    onFocus={onDayFocus}
                    onClick={() => onSelect(date)}
                    onKeyDown={(event) => {
                      const offset = {
                        ArrowLeft: -1,
                        ArrowRight: 1,
                        ArrowUp: -7,
                        ArrowDown: 7,
                      }[event.key]
                      if (offset !== undefined) {
                        event.preventDefault()
                        move(moveCalendarDate(date, offset))
                      } else if (event.key === 'Home' || event.key === 'End') {
                        event.preventDefault()
                        move(moveCalendarDate(date, (event.key === 'Home' ? 0 : 6) - date.getDay()))
                      } else if (event.key === 'PageUp' || event.key === 'PageDown') {
                        event.preventDefault()
                        const months = event.shiftKey ? 12 : 1
                        move(moveCalendarMonth(date, event.key === 'PageUp' ? -months : months))
                      }
                    }}
                  >
                    {date.getDate()}
                  </button>
                </span>
              )
            })}
          </div>
        ))}
      </div>
    </>
  )
}
