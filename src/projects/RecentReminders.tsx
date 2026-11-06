import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  nextReminderAt,
  recentReminderDays,
  recentReminders,
  reminderTime,
  type RecentReminder,
} from './reminders'
import { displayZone, subscribeDisplayZone } from './schedule'
import { projectStore } from './store'
import { ReminderPermission } from './TaskReminders'
import { useReminderState } from './reminderService'

const seenKey = 'stash-reminders-seen'
const seenListeners = new Set<() => void>()
/** Starts now on first use, so older reminders don't all arrive as new. */
function loadSeen() {
  const now = Date.now()
  try {
    const saved = Number(localStorage.getItem(seenKey))
    if (saved) return saved
    localStorage.setItem(seenKey, String(now))
  } catch {
    /* Without storage, new reminders are tracked for this session. */
  }
  return now
}
let seen = loadSeen()
function markSeen(at: number) {
  if (at <= seen) return
  seen = at
  try {
    localStorage.setItem(seenKey, String(at))
  } catch {
    /* Without storage, new reminders are tracked for this session. */
  }
  seenListeners.forEach((listener) => listener())
}
const subscribeSeen = (listener: () => void) => {
  seenListeners.add(listener)
  return () => {
    seenListeners.delete(listener)
  }
}
const longestTimer = 3_600_000

/** Recent reminders, updated as tasks change and as each reminder's time arrives. */
export function useRecentReminders() {
  const { tasks } = useSyncExternalStore(projectStore.subscribe, projectStore.getSnapshot)
  const zone = useSyncExternalStore(subscribeDisplayZone, displayZone)
  const lastSeen = useSyncExternalStore(subscribeSeen, () => seen)
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const current = Date.now()
    const next = nextReminderAt(tasks, current, zone)
    const wait = next === null ? longestTimer : Math.min(next - current + 1, longestTimer)
    const timer = setTimeout(() => setNow(Date.now()), wait)
    const refresh = () => setNow(Date.now())
    window.addEventListener('focus', refresh)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('focus', refresh)
    }
  }, [tasks, zone, now])
  const items = recentReminders(tasks, Math.max(now, Date.now()), zone)
  return { items, unread: items.filter((item) => item.at > lastSeen).length }
}

export default function RecentReminders({ onOpen }: { onOpen: (taskId: string) => void }) {
  const { items } = useRecentReminders()
  const { status } = useReminderState()
  const newest = items[0]?.at ?? 0
  useEffect(() => markSeen(Math.max(newest, 1)), [newest])
  const now = Date.now()
  return (
    <div className="recent-reminders">
      {items.length ? (
        <ul>
          {items.map((item: RecentReminder) => (
            <li key={item.id}>
              <button type="button" onClick={() => onOpen(item.taskId)}>
                <span className="recent-reminder-title truncate">{item.title}</span>
                <span className="recent-reminder-meta">
                  {reminderTime(item.at, now)} · {item.label}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="recent-reminders-empty">
          <p>No recent reminders</p>
          <small>Reminders from the last {recentReminderDays} days appear here.</small>
        </div>
      )}
      <ReminderPermission status={status} />
    </div>
  )
}
