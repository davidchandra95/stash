import { useEffect } from 'react'
import {
  openReminderSettings,
  requestReminderPermission,
  syncReminders,
  useReminderState,
} from './reminderService'

const statusLabel = {
  granted: 'Allowed',
  notDetermined: 'Not turned on',
  denied: 'Blocked',
  unavailable: 'Not available',
}
const statusHelp = {
  granted: 'Task reminders appear at their set times, even when Stash is closed.',
  notDetermined: 'Task reminders stay silent until you allow notifications.',
  denied: 'Task reminders stay silent until you allow Stash in your device’s settings.',
  unavailable: 'This version of Stash can’t send notifications, so reminders won’t appear.',
}

/** Settings' permission status. The system owns the switch, so this only reports and links. */
export default function ReminderSettings() {
  const { status, error } = useReminderState()
  useEffect(() => void syncReminders(), [])
  return (
    <div className="settings-row">
      <span className="settings-label">
        Task reminders
        <small>{statusHelp[status]}</small>
        {error && (
          <small role="alert" className="field-error">
            {error}
          </small>
        )}
      </span>
      <span className="settings-control reminder-status">
        <span data-status={status}>{statusLabel[status]}</span>
        {status === 'notDetermined' && (
          <button type="button" className="btn btn-sm" onClick={() => void requestReminderPermission()}>
            Turn on
          </button>
        )}
        {status === 'denied' && (
          <button type="button" className="btn btn-sm" onClick={() => void openReminderSettings()}>
            Open Settings
          </button>
        )}
      </span>
    </div>
  )
}
