import * as Popover from '@radix-ui/react-popover'
import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { Editor } from '@tiptap/core'
import type { Node } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'
import { closeHistory } from '@tiptap/pm/history'
import {
  calendarDate,
  dateOnlyFormatIndexes,
  moveCalendarDate,
  moveCalendarMonth,
  type DatePickerRequest,
} from '../editor/datePicker'
import { dateFormats } from '../editor/slashOptions'
import { ArrowLeft, ChevronRight } from '../icons'
import type { Appearance } from '../model'
import { fontFamily } from '../fonts'

interface Target {
  range: DatePickerRequest['range']
  text: string
  doc: Node
}
const today = () => {
  const now = new Date()
  return calendarDate(now.getFullYear(), now.getMonth(), now.getDate())
}
const sameDay = (a: Date, b: Date) => a.getTime() === b.getTime()

export default function DatePicker({
  editor,
  readOnly = false,
  appearance,
}: {
  editor: Editor
  readOnly?: boolean
  appearance?: Appearance
}) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<'calendar' | 'formats'>('calendar')
  const [selected, setSelected] = useState(today)
  const [day, setDay] = useState(today)
  const content = useRef<HTMLDivElement>(null)
  const target = useRef<Target | null>(null)
  const blocked = useRef(readOnly)
  blocked.current = readOnly
  const opening = useRef<DatePickerRequest['opening']>('automatic')
  const focusDay = useRef(false)
  const chooseToday = useRef<() => void>(() => {})
  chooseToday.current = () => {
    setSelected(day)
    setStep('formats')
  }

  const close = (restore = false) => {
    target.current = null
    focusDay.current = false
    setOpen(false)
    if (restore && !editor.isDestroyed && !blocked.current) editor.view.focus()
  }
  const valid = (current: Target) =>
    !editor.isDestroyed &&
    !blocked.current &&
    editor.isEditable &&
    current.range.from >= 0 &&
    current.range.from <= current.range.to &&
    current.range.to <= editor.state.doc.content.size &&
    editor.state.doc.textBetween(current.range.from, current.range.to, '\n', '\ufffc') ===
      current.text

  useLayoutEffect(() => {
    const dom = editor.view.dom
    const show = (event: Event) => {
      if (blocked.current || !editor.isEditable) return
      const { range, opening: method } = (event as CustomEvent<DatePickerRequest>).detail
      target.current = {
        range,
        text: editor.state.doc.textBetween(range.from, range.to, '\n', '\ufffc'),
        doc: editor.state.doc,
      }
      opening.current = method
      focusDay.current = method === 'manual'
      const date = today()
      setDay(date)
      setSelected(date)
      setStep('calendar')
      setOpen(true)
    }
    const key = (event: Event) => {
      if (!target.current || blocked.current) return
      const input = (event as CustomEvent<KeyboardEvent>).detail
      if (input.key === 'Escape') close(true)
      else if (input.key === 'Enter') chooseToday.current()
      else if ((input.key === 'ArrowDown' || input.key === 'Tab') && !input.shiftKey) {
        content.current
          ?.querySelector<HTMLButtonElement>('[data-calendar-day][tabindex="0"], .date-format')
          ?.focus()
      } else return
      event.preventDefault()
    }
    const map = ({ transaction }: { transaction: Transaction }) => {
      const current = target.current
      if (!current) return
      // An automatic request is sent during the plugin's view update, after
      // this transaction has already been applied. Do not map it twice.
      if (current.doc !== transaction.doc) {
        if (current.doc !== transaction.before) {
          close()
          return
        }
        current.range = {
          from: transaction.mapping.map(current.range.from, 1),
          to: transaction.mapping.map(current.range.to, 1),
        }
        current.doc = transaction.doc
      }
      if (!valid(current)) close()
    }
    const dismiss = () => close()
    dom.addEventListener('writing-date-picker', show)
    dom.addEventListener('writing-date-picker-key', key)
    dom.addEventListener('writing-deactivate', dismiss)
    dom.addEventListener('writing-dismiss', dismiss)
    editor.on('transaction', map)
    editor.on('destroy', dismiss)
    return () => {
      target.current = null
      dom.removeEventListener('writing-date-picker', show)
      dom.removeEventListener('writing-date-picker-key', key)
      dom.removeEventListener('writing-deactivate', dismiss)
      dom.removeEventListener('writing-dismiss', dismiss)
      editor.off('transaction', map)
      editor.off('destroy', dismiss)
    }
  }, [editor])
  useLayoutEffect(() => {
    close()
  }, [editor, readOnly])
  useLayoutEffect(() => {
    if (!open) return
    if (step === 'formats')
      content.current?.querySelector<HTMLButtonElement>('.date-format')?.focus()
    else if (focusDay.current) {
      content.current
        ?.querySelector<HTMLButtonElement>('[data-calendar-day][tabindex="0"]')
        ?.focus()
    }
  }, [day, open, step])

  const virtualAnchor = useMemo(
    () => ({
      current: {
        contextElement: editor.view.dom,
        getBoundingClientRect: () => {
          const current = target.current
          if (!current || editor.isDestroyed) return new DOMRect()
          const rect = editor.view.coordsAtPos(current.range.from)
          return new DOMRect(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top)
        },
      },
    }),
    [editor],
  )
  const select = (date: Date) => {
    setSelected(date)
    setDay(date)
    setStep('formats')
  }
  const move = (date: Date) => {
    focusDay.current = true
    setDay(date)
  }
  const insert = (format: number) => {
    const current = target.current
    if (!current || !valid(current)) {
      close()
      return
    }
    const text = dateFormats(selected)[format]
    close()
    editor
      .chain()
      .command(({ tr }) => {
        closeHistory(tr)
        return true
      })
      .insertContentAt(current.range, text, { updateSelection: true })
      .run()
    editor.view.focus()
  }
  const first = calendarDate(day.getFullYear(), day.getMonth(), 1)
  const days = calendarDate(day.getFullYear(), day.getMonth() + 1, 0).getDate()
  const week = Array.from({ length: 7 }, (_, i) =>
    calendarDate(2023, 0, 1 + i).toLocaleDateString(undefined, { weekday: 'short' }),
  )
  const dom = editor.isDestroyed ? null : editor.view.dom
  const theme = appearance?.dark
    ? 'dark'
    : appearance
      ? 'light'
      : (dom?.closest('[data-theme]')?.getAttribute('data-theme') ?? 'light')
  const palette =
    appearance?.theme ?? dom?.closest('[data-palette]')?.getAttribute('data-palette') ?? 'classic'

  return (
    <Popover.Root
      open={open && !readOnly}
      modal={false}
      onOpenChange={(value) => {
        if (!value) close()
      }}
    >
      <Popover.Anchor virtualRef={virtualAnchor} />
      <Popover.Portal>
        <Popover.Content
          ref={content}
          className="date-picker"
          data-step={step}
          data-theme={theme}
          data-palette={palette}
          style={
            appearance
              ? ({ '--ui-font': fontFamily(appearance.uiFont) } as CSSProperties)
              : undefined
          }
          side="bottom"
          align="start"
          sideOffset={5}
          collisionPadding={8}
          aria-label="Choose a date"
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            if (opening.current === 'manual')
              content.current
                ?.querySelector<HTMLButtonElement>('[data-calendar-day][tabindex="0"]')
                ?.focus()
          }}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onFocusOutside={(event) => {
            if (!editor.isDestroyed && editor.view.dom.contains(event.target as globalThis.Node))
              event.preventDefault()
          }}
          onEscapeKeyDown={() => close(true)}
        >
          {step === 'calendar' ? (
            <>
              <div className="date-picker-header">
                <button
                  type="button"
                  aria-label="Previous month"
                  onClick={() => move(moveCalendarMonth(day, -1))}
                >
                  <ArrowLeft />
                </button>
                <span aria-live="polite">
                  {day.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
                </span>
                <button
                  type="button"
                  aria-label="Next month"
                  onClick={() => move(moveCalendarMonth(day, 1))}
                >
                  <ChevronRight />
                </button>
              </div>
              <div className="date-calendar" role="grid" aria-label="Calendar">
                <div className="date-calendar-row" role="row">
                  {week.map((label, i) => (
                    <span role="columnheader" key={i}>
                      {label}
                    </span>
                  ))}
                </div>
                {Array.from({ length: Math.ceil((first.getDay() + days) / 7) }, (_, row) => (
                  <div className="date-calendar-row" role="row" key={row}>
                    {Array.from({ length: 7 }, (_, col) => {
                      const number = row * 7 + col - first.getDay() + 1
                      if (number < 1 || number > days) return <span role="gridcell" key={col} />
                      const date = calendarDate(day.getFullYear(), day.getMonth(), number)
                      return (
                        <span role="gridcell" aria-selected={sameDay(date, selected)} key={col}>
                          <button
                            type="button"
                            data-calendar-day
                            tabIndex={sameDay(date, day) ? 0 : -1}
                            aria-label={date.toLocaleDateString(undefined, {
                              weekday: 'long',
                              year: 'numeric',
                              month: 'long',
                              day: 'numeric',
                            })}
                            aria-current={sameDay(date, today()) ? 'date' : undefined}
                            onFocus={() => {
                              focusDay.current = true
                            }}
                            onClick={() => select(date)}
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
                                move(
                                  moveCalendarDate(
                                    date,
                                    (event.key === 'Home' ? 0 : 6) - date.getDay(),
                                  ),
                                )
                              } else if (event.key === 'PageUp' || event.key === 'PageDown') {
                                event.preventDefault()
                                move(moveCalendarMonth(date, event.key === 'PageUp' ? -1 : 1))
                              }
                            }}
                          >
                            {number}
                          </button>
                        </span>
                      )
                    })}
                  </div>
                ))}
              </div>
              <button className="date-today" type="button" onClick={() => select(today())}>
                Today
              </button>
            </>
          ) : (
            <>
              <button
                className="date-back"
                type="button"
                onClick={() => {
                  focusDay.current = true
                  setStep('calendar')
                }}
              >
                <ArrowLeft />
                Back to calendar
              </button>
              <div
                className="date-formats"
                aria-label="Date formats"
                onKeyDown={(event) => {
                  if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
                  const buttons = [
                    ...event.currentTarget.querySelectorAll<HTMLButtonElement>('button'),
                  ]
                  const index = buttons.indexOf(event.target as HTMLButtonElement)
                  if (index < 0) return
                  event.preventDefault()
                  buttons[
                    event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? buttons.length - 1
                        : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) %
                          buttons.length
                  ].focus()
                }}
              >
                {dateOnlyFormatIndexes.map((index) => (
                  <button
                    className="date-format"
                    type="button"
                    key={index}
                    onClick={() => insert(index)}
                  >
                    {dateFormats(selected)[index]}
                  </button>
                ))}
              </div>
            </>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
