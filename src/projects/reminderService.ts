import { addPluginListener, invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { platform } from '../platform'
import {
  isCurrentSnooze,
  maxPending,
  parseSnooze,
  reminderEntries,
  staleOverdue,
  type Snooze,
} from './reminders'
import { projectStore } from './store'

/**
 * Keeps the operating system's pending notifications matched to the tasks. Reminders only
 * schedule once notifications are allowed, so that permission is also their on/off switch.
 */
export type ReminderStatus = 'granted' | 'denied' | 'notDetermined' | 'unavailable'
interface ReminderState {
  status: ReminderStatus
  snoozes: Snooze[]
  error: string
}
const native = isTauri()
let state: ReminderState = { status: 'unavailable', snoozes: [], error: '' }
const listeners = new Set<() => void>()
const publish = (patch: Partial<ReminderState>) => {
  state = { ...state, ...patch }
  listeners.forEach((listener) => listener())
}

let running = false
let again = false
/** Applies the current tasks. A change during a run schedules one more run. */
export async function syncReminders() {
  if (!native) return
  if (running) {
    again = true
    return
  }
  running = true
  try {
    do {
      again = false
      const status = await invoke<ReminderStatus>('reminder_status')
      if (status !== 'granted') {
        publish({ status, snoozes: [], error: '' })
        continue
      }
      const { tasks, ready } = projectStore.getSnapshot()
      if (!ready) {
        publish({ status })
        continue
      }
      const pending = await invoke<string[]>('reminder_pending')
      const snoozes = pending.map(parseSnooze).filter((snooze) => !!snooze)
      const current = snoozes.filter((snooze) => isCurrentSnooze(snooze, tasks))
      await invoke('reminder_sync', {
        entries: reminderEntries(tasks, Date.now(), maxPending - current.length),
        drop: [
          ...snoozes.filter((snooze) => !current.includes(snooze)).map((snooze) => snooze.id),
          ...staleOverdue(pending, tasks),
        ],
      })
      publish({ status, snoozes: current, error: '' })
    } while (again)
  } catch (error) {
    publish({ error: String(error) })
  } finally {
    running = false
  }
}
export async function requestReminderPermission() {
  try {
    if (native) await invoke('reminder_request_permission')
  } catch (error) {
    publish({ error: String(error) })
  }
  await syncReminders()
}
export async function openReminderSettings() {
  try {
    await invoke('reminder_open_settings')
  } catch (error) {
    publish({ error: String(error) })
  }
}
export async function cancelSnooze(id: string) {
  try {
    await invoke('reminder_cancel', { ids: [id] })
  } catch (error) {
    publish({ error: String(error) })
  }
  await syncReminders()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export const reminderState = () => state
export const useReminderState = () => useSyncExternalStore(subscribe, reminderState)

/** What people see about permission, or null when reminders simply work. */
export function reminderStatusText(status: ReminderStatus) {
  const place = platform.mobile ? 'Android settings' : 'System Settings'
  switch (status) {
    case 'granted':
      return null
    case 'notDetermined':
      return 'Notifications are off, so reminders won’t appear yet.'
    case 'denied':
      return `Notifications are blocked in ${place}, so reminders won’t appear.`
    case 'unavailable':
      return 'This version of Stash can’t send notifications, so reminders won’t appear.'
  }
}
const syncDelay = 500
const refreshInterval = 3_600_000

/** Runs while the app is open: follows task edits, refocus, and taps on a reminder. */
export function useTaskReminders(enabled: boolean, openTask: (id: string) => void) {
  const open = useRef(openTask)
  open.current = openTask
  useEffect(() => {
    if (!enabled || !native) return
    const takeOpen = () =>
      invoke<string | null>('reminder_take_open').then(
        (id) => {
          if (id) open.current(id)
        },
        (error) => publish({ error: String(error) }),
      )
    let timer: ReturnType<typeof setTimeout> | undefined
    const stopTasks = projectStore.subscribe(() => {
      clearTimeout(timer)
      timer = setTimeout(() => void syncReminders(), syncDelay)
    })
    const refresh = () => {
      void syncReminders()
      void takeOpen()
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', onVisible)
    // The soonest reminders are all that's scheduled, so later ones need moving up over time.
    const interval = setInterval(refresh, refreshInterval)
    const registrations = platform.mobile
      ? [addPluginListener('stash-platform', 'reminderOpen', refresh)]
      : [listen('task-reminder-open', refresh), listen('task-reminders-changed', refresh)]
    refresh()
    return () => {
      clearTimeout(timer)
      clearInterval(interval)
      stopTasks()
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', onVisible)
      for (const registration of registrations)
        void registration.then((stop) =>
          typeof stop === 'function' ? stop() : void stop.unregister(),
        )
    }
  }, [enabled])
}
