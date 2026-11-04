import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { deviceZone, setDisplayZone } from './schedule'

export type CalendarViewOptions = {
  firstDay: number
  completed: boolean
  zoom: number
  firstHour: number
  lastHour: number
  allDayHeight: number
}
const defaults: CalendarViewOptions = {
  firstDay: 1,
  completed: true,
  zoom: 56,
  firstHour: 0,
  lastHour: 24,
  allDayHeight: 120,
}
export function readCalendarOptions(): CalendarViewOptions {
  try {
    const saved = JSON.parse(localStorage.getItem('stash-calendar-options') || '{}')
    return {
      firstDay: saved.firstDay === 0 ? 0 : 1,
      completed: saved.completed !== false,
      zoom: [40, 56, 80].includes(saved.zoom) ? saved.zoom : 56,
      firstHour:
        Number.isInteger(saved.firstHour) && saved.firstHour >= 0 && saved.firstHour <= 12
          ? saved.firstHour
          : 0,
      lastHour:
        Number.isInteger(saved.lastHour) && saved.lastHour >= 13 && saved.lastHour <= 24
          ? saved.lastHour
          : 24,
      allDayHeight:
        saved.allDayHeight >= 60 && saved.allDayHeight <= 300 ? saved.allDayHeight : 120,
    }
  } catch {
    return defaults
  }
}
export default function CalendarOptions({
  options,
  setOptions,
  zone,
  onClose,
  restoreFocus,
}: {
  options: CalendarViewOptions
  setOptions: (options: CalendarViewOptions) => void
  zone: string
  onClose: () => void
  restoreFocus: () => void
}) {
  const [zoneText, setZoneText] = useState(zone === deviceZone() ? '' : zone)
  const [zoneError, setZoneError] = useState('')
  const applyZone = () => {
    try {
      setDisplayZone(zoneText.trim())
      setZoneError('')
      return true
    } catch {
      setZoneError('Enter a named time zone, such as Asia/Jakarta.')
      return false
    }
  }
  // A mistyped zone keeps the dialog open, so it isn't silently dropped.
  const close = () => {
    if (applyZone()) onClose()
  }
  return (
    <Dialog.Root open onOpenChange={close}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className="dialog calendar-options-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            restoreFocus()
          }}
        >
          <div className="dialog-header">
            <Dialog.Title className="dialog-title">View options</Dialog.Title>
            <Dialog.Description className="dialog-description">
              Cancelled tasks are hidden. Changing the display zone never rewrites a task.
            </Dialog.Description>
          </div>
          <div className="dialog-body calendar-options">
            <label>
              <input
                type="checkbox"
                checked={options.completed}
                onChange={(event) => setOptions({ ...options, completed: event.target.checked })}
              />
              Show completed
            </label>
            <label>
              Week starts
              <select
                className="field"
                value={options.firstDay}
                onChange={(event) => setOptions({ ...options, firstDay: Number(event.target.value) })}
              >
                <option value={1}>Monday</option>
                <option value={0}>Sunday</option>
              </select>
            </label>
            <label>
              Zoom
              <select
                className="field"
                value={options.zoom}
                onChange={(event) => setOptions({ ...options, zoom: Number(event.target.value) })}
              >
                <option value={40}>Compact</option>
                <option value={56}>Normal</option>
                <option value={80}>Large</option>
              </select>
            </label>
            <label>
              First hour
              <select
                className="field"
                value={options.firstHour}
                onChange={(event) => setOptions({ ...options, firstHour: Number(event.target.value) })}
              >
                {Array.from({ length: 13 }, (_, i) => (
                  <option key={i} value={i}>
                    {String(i).padStart(2, '0')}:00
                  </option>
                ))}
              </select>
            </label>
            <label>
              Last hour
              <select
                className="field"
                value={options.lastHour}
                onChange={(event) => setOptions({ ...options, lastHour: Number(event.target.value) })}
              >
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i} value={i + 13}>
                    {i + 13}:00
                  </option>
                ))}
              </select>
            </label>
            <label>
              All-day height
              <input
                type="range"
                min={60}
                max={300}
                step={20}
                value={options.allDayHeight}
                onChange={(event) => setOptions({ ...options, allDayHeight: Number(event.target.value) })}
              />
            </label>
            <label>
              Display time zone
              <input
                className="field"
                aria-label="Display time zone"
                placeholder={deviceZone()}
                value={zoneText}
                aria-invalid={zoneError !== ''}
                onChange={(event) => setZoneText(event.target.value)}
                onBlur={applyZone}
              />
            </label>
            {zoneError && (
              <p className="field-error" role="alert">
                {zoneError}
              </p>
            )}
          </div>
          <div className="dialog-footer">
            <button className="btn btn-primary" onClick={close}>
              Done
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
