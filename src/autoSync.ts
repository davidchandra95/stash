const activityEvents = ['keydown', 'pointerdown', 'input'] as const

/**
 * Calls `sync` every `interval` ms, but only once the user has paused for `idle` ms: a sync
 * reloads open notes, so it should never land in the middle of typing. Returns a stop function.
 */
export function startAutoSync(interval: number, sync: () => void, idle = 30_000) {
  let due = Date.now() + interval
  let lastActivity = 0
  const touch = () => {
    lastActivity = Date.now()
  }
  activityEvents.forEach((name) => window.addEventListener(name, touch, true))
  const timer = setInterval(
    () => {
      const now = Date.now()
      if (now < due || now - lastActivity < idle) return
      due = now + interval
      sync()
    },
    Math.min(interval, 15_000),
  )
  return () => {
    clearInterval(timer)
    activityEvents.forEach((name) => window.removeEventListener(name, touch, true))
  }
}
