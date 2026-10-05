import type { Editor } from '@tiptap/core'

export interface DatePickerRequest {
  range: { from: number; to: number }
  opening: 'automatic' | 'manual'
}

export function requestDatePicker(
  editor: Editor,
  range: DatePickerRequest['range'],
  opening: DatePickerRequest['opening'],
) {
  if (!editor.isEditable || editor.isDestroyed) return false
  editor.view.dom.dispatchEvent(
    new CustomEvent<DatePickerRequest>('writing-date-picker', {
      detail: { range: { from: range.from, to: range.to }, opening },
    }),
  )
  return true
}

export function datePickerKey(editor: Editor, key: KeyboardEvent) {
  return !editor.view.dom.dispatchEvent(
    new CustomEvent<KeyboardEvent>('writing-date-picker-key', { detail: key, cancelable: true }),
  )
}

// Calendar dates are local values, never ISO strings parsed as UTC.
export function calendarDate(year: number, month: number, day: number) {
  const date = new Date(0)
  date.setFullYear(year, month, day)
  date.setHours(12, 0, 0, 0)
  return date
}

export function moveCalendarDate(date: Date, days: number) {
  return calendarDate(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

export function moveCalendarMonth(date: Date, months: number) {
  const first = calendarDate(date.getFullYear(), date.getMonth() + months, 1)
  const last = calendarDate(first.getFullYear(), first.getMonth() + 1, 0).getDate()
  return calendarDate(first.getFullYear(), first.getMonth(), Math.min(date.getDate(), last))
}

export const dateOnlyFormatIndexes = [1, 3, 5, 6, 7, 8] as const
