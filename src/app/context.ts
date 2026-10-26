import {
  createContext,
  createElement,
  memo,
  useContext,
  useInsertionEffect,
  useRef,
  type ComponentType,
  type Context,
} from 'react'
import type { AppController } from './useAppController'

/** Always the latest controller: App replaces it at the start of every render. */
export class AppStore {
  constructor(public app: AppController) {}
}
export const AppContext = createContext<AppStore | null>(null)
/** Changes on every App render; only `trackApp` wrappers and untracked readers consume it. */
export const AppVersionContext = createContext<AppController | null>(null)

/** Hook results rebuilt on every controller render. Their fields are tracked individually. */
const namespaces = new Set([
  'library',
  'workspace',
  'drag',
  'notebookMove',
  'contentsResize',
  'paneResize',
])

type Path = readonly string[]
type Read = { path: Path; value: unknown; args?: unknown[] }
type Tracker = {
  reads: Map<string, Read[]>
  rendering: boolean
  cache: Map<string, unknown>
}
const TrackerContext = createContext<Tracker | null>(null)

function resolve(app: AppController, path: Path) {
  let value: unknown = app
  for (const key of path) value = (value as Record<string, unknown> | undefined)?.[key]
  return value
}
function call(app: AppController, path: Path, args: unknown[]) {
  const owner = resolve(app, path.slice(0, -1)) as Record<string, unknown>
  return (owner[path[path.length - 1]] as (...args: unknown[]) => unknown).apply(owner, args)
}
function same(a: unknown, b: unknown) {
  if (Object.is(a, b)) return true
  return (
    Array.isArray(a) &&
    Array.isArray(b) &&
    a.length === b.length &&
    a.every((value, i) => Object.is(value, b[i]))
  )
}
function changed(app: AppController, read: Read) {
  if (!read.args) return !Object.is(resolve(app, read.path), read.value)
  try {
    return !same(call(app, read.path, read.args), read.value)
  } catch {
    return true
  }
}
function record(tracker: Tracker, read: Read) {
  if (!tracker.rendering) return
  const key = read.path.join('.')
  const reads = tracker.reads.get(key)
  if (!read.args || !reads) {
    tracker.reads.set(key, [read])
    return
  }
  const index = reads.findIndex((old) => same(old.args, read.args))
  if (index >= 0) reads[index] = read
  else reads.push(read)
}

function view(store: AppStore, tracker: Tracker, path: Path): unknown {
  const key = path.join('.')
  let proxy = tracker.cache.get(key)
  if (!proxy)
    tracker.cache.set(
      key,
      (proxy = new Proxy(
        {},
        {
          get(_, property) {
            const owner = resolve(store.app, path) as Record<string | symbol, unknown> | undefined
            const value = owner?.[property]
            if (typeof property === 'symbol') return value
            const next = [...path, property]
            if (!path.length && namespaces.has(property) && value && typeof value === 'object')
              return view(store, tracker, next)
            if (typeof value === 'function') return forwarder(store, tracker, next)
            record(tracker, { path: next, value })
            return value
          },
        },
      )),
    )
  return proxy
}

/** Stable across renders and always calls the latest function. Render-time results are tracked. */
function forwarder(store: AppStore, tracker: Tracker, path: Path) {
  const key = `call:${path.join('.')}`
  let run = tracker.cache.get(key)
  if (!run)
    tracker.cache.set(
      key,
      (run = (...args: unknown[]) => {
        const value = call(store.app, path, args)
        // Calls during render are pure reads. Results of undefined are commands, never replayed.
        if (value !== undefined) record(tracker, { path, args, value })
        return value
      }),
    )
  return run
}

/**
 * Re-renders `Component` only when a controller value read while rendering it (or its
 * untracked descendants) changes. The wrapper re-renders with App, so tracked views still
 * commit together with the controller state and its layout effects.
 */
export function trackApp<P extends object>(Component: ComponentType<P>) {
  // The version only defeats memo; the wrapped component never sees it.
  const Tracked = memo(function Tracked({ appVersion: _, ...props }: P & { appVersion: number }) {
    return createElement(Component, props as P)
  })
  function TrackedApp(props: P) {
    const app = useContext(AppVersionContext)!
    const tracker = useRef<Tracker>(null!)
    if (!tracker.current) tracker.current = { reads: new Map(), rendering: false, cache: new Map() }
    const version = useRef(0)
    const reads = tracker.current.reads
    if ([...reads.values()].some((list) => list.some((read) => changed(app, read)))) {
      reads.clear()
      version.current++
    }
    return createElement(
      TrackerContext.Provider,
      { value: tracker.current },
      createElement(Tracked, { ...props, appVersion: version.current }),
    )
  }
  TrackedApp.displayName = `trackApp(${Component.displayName || Component.name})`
  return TrackedApp
}

export function useApp() {
  const store = useContext(AppContext)
  if (!store) throw Error('useApp must be used inside the desktop workspace.')
  const tracker = useContext(TrackerContext)
  // Outside a tracked view, re-render with every App render as before.
  useContext((tracker ? TrackerContext : AppVersionContext) as Context<unknown>)
  if (tracker) tracker.rendering = true
  // Runs at commit before any layout effect, so effects and handlers are not tracked.
  useInsertionEffect(() => {
    if (tracker) tracker.rendering = false
  })
  return (tracker ? view(store, tracker, []) : store.app) as AppController
}

/** Library operations that block workspace interaction while they run. */
export function useBlocked() {
  const { library } = useApp()
  return library.quitting || library.syncing || library.converting
}
