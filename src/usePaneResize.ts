import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from 'react'
import {
  clamp,
  effectivePaneWidths,
  normalizePaneWidths,
  paneBounds,
  type PaneKind,
  type PaneLayoutContext,
  type PaneWidths,
} from './paneLayout'

type Measurements = PaneWidths & { app: number }

type ResizeSession = {
  pane: PaneKind
  pointerId: number
  startX: number
  startWidth: number
  original: PaneWidths | undefined
  draft: PaneWidths
  element: HTMLElement
}

const emptyMeasurements: Measurements = { app: 0, sidebar: 0, noteList: 0 }

function sameMeasurements(a: Measurements, b: Measurements) {
  return a.app === b.app && a.sidebar === b.sidebar && a.noteList === b.noteList
}

function width(element: HTMLElement | null) {
  return Math.round(element?.getBoundingClientRect().width ?? 0)
}

export function usePaneResize({
  appRef,
  savedWidths,
  sidebarVisible,
  noteListVisible,
  disabled,
  onCommit,
}: {
  appRef: RefObject<HTMLElement | null>
  savedWidths: PaneWidths | undefined
  sidebarVisible: boolean
  noteListVisible: boolean
  disabled: boolean
  onCommit: (widths: PaneWidths) => void
}) {
  const [preferred, setPreferred] = useState<PaneWidths | undefined>(() =>
    normalizePaneWidths(savedWidths),
  )
  const preferredRef = useRef(preferred)
  const [measurements, setMeasurements] = useState<Measurements>(emptyMeasurements)
  const [resizing, setResizing] = useState(false)
  const session = useRef<ResizeSession | null>(null)
  const latest = useRef({
    sidebarVisible,
    noteListVisible,
    disabled,
    onCommit,
  })
  latest.current = {
    sidebarVisible,
    noteListVisible,
    disabled,
    onCommit,
  }
  const savedKey = savedWidths ? `${savedWidths.sidebar}:${savedWidths.noteList}` : ''

  const updatePreferred = (next: PaneWidths | undefined) => {
    preferredRef.current = next
    setPreferred(next)
  }

  useLayoutEffect(() => {
    if (!session.current) updatePreferred(normalizePaneWidths(savedWidths))
  }, [savedKey])

  const measure = () => {
    const app = appRef.current
    const next = {
      app: width(app),
      sidebar: width(app?.querySelector<HTMLElement>(':scope > .sidebar') ?? null),
      noteList: width(app?.querySelector<HTMLElement>(':scope > .note-list') ?? null),
    }
    setMeasurements((current) => {
      // Hidden tracks measure zero, but their last width remains the restore target.
      const measured = {
        ...next,
        sidebar: next.sidebar || current.sidebar,
        noteList: next.noteList || current.noteList,
      }
      return sameMeasurements(current, measured) ? current : measured
    })
  }

  useLayoutEffect(() => {
    measure()
    const app = appRef.current
    const observer =
      app && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => measure()) : undefined
    if (observer && app) observer.observe(app)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [appRef])

  const contextFor = (widths: PaneWidths): PaneLayoutContext => ({
    appWidth: measurements.app || width(appRef.current),
    sidebarVisible: latest.current.sidebarVisible,
    noteListVisible: latest.current.noteListVisible,
    sidebarWidth: widths.sidebar,
    noteListWidth: widths.noteList,
  })

  const visibleWidths = () => {
    const app = appRef.current
    const defaults = app ? getComputedStyle(app) : undefined
    // Grid targets include card margins and survive a collapsed zero-width track.
    const measured: PaneWidths = {
      sidebar:
        Number.parseFloat(defaults?.getPropertyValue('--sidebar-width') ?? '') ||
        measurements.sidebar ||
        width(app?.querySelector<HTMLElement>(':scope > .sidebar') ?? null) ||
        208,
      noteList:
        Number.parseFloat(defaults?.getPropertyValue('--list-width') ?? '') ||
        measurements.noteList ||
        width(app?.querySelector<HTMLElement>(':scope > .note-list') ?? null) ||
        272,
    }
    if (!preferredRef.current) return measured
    return effectivePaneWidths(preferredRef.current, contextFor(preferredRef.current))
  }

  const boundsFor = (widths: PaneWidths) => paneBounds(contextFor(widths))

  const move = (clientX: number) => {
    const active = session.current
    if (!active) return
    const visible = effectivePaneWidths(active.draft, contextFor(active.draft))
    const bounds = boundsFor(visible)[active.pane]
    const next = {
      ...active.draft,
      [active.pane]: clamp(Math.round(active.startWidth + clientX - active.startX), bounds),
    }
    active.draft = next
    updatePreferred(next)
  }

  const finish = (cancelled: boolean) => {
    const active = session.current
    if (!active) return
    session.current = null
    if (active.element.hasPointerCapture?.(active.pointerId))
      active.element.releasePointerCapture(active.pointerId)
    setResizing(false)
    if (cancelled) {
      updatePreferred(active.original)
      return
    }
    updatePreferred(active.draft)
    latest.current.onCommit(active.draft)
  }

  useEffect(() => {
    const cancel = () => finish(true)
    const keydown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && session.current) {
        event.preventDefault()
        cancel()
      }
    }
    window.addEventListener('blur', cancel)
    window.addEventListener('keydown', keydown)
    return () => {
      window.removeEventListener('blur', cancel)
      window.removeEventListener('keydown', keydown)
      cancel()
    }
  }, [])

  const resizeWithKeyboard = (pane: PaneKind, event: KeyboardEvent<HTMLElement>) => {
    if (latest.current.disabled || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return
    event.preventDefault()
    const visible = visibleWidths()
    const step = event.shiftKey ? 32 : 8
    const direction = event.key === 'ArrowLeft' ? -1 : 1
    const next = {
      ...(preferredRef.current ?? visible),
      [pane]: clamp(visible[pane] + direction * step, boundsFor(visible)[pane]),
    }
    updatePreferred(next)
    latest.current.onCommit(next)
  }

  const dividerProps = (pane: PaneKind) => {
    const visible = visibleWidths()
    const bounds = boundsFor(visible)[pane]
    const label = pane === 'sidebar' ? 'Resize notebooks sidebar' : 'Resize notes list'
    return {
      className: `pane-resizer pane-resizer--${pane}`,
      role: 'separator' as const,
      'aria-orientation': 'vertical' as const,
      'aria-label': label,
      'aria-valuemin': bounds.min,
      'aria-valuemax': bounds.max,
      'aria-valuenow': visible[pane],
      'aria-valuetext': `${visible[pane]} pixels`,
      'aria-disabled': latest.current.disabled || undefined,
      tabIndex: latest.current.disabled ? -1 : 0,
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => resizeWithKeyboard(pane, event),
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        if (latest.current.disabled || event.button !== 0) return
        event.preventDefault()
        const element = event.currentTarget
        const initial = preferredRef.current ?? visible
        session.current = {
          pane,
          pointerId: event.pointerId,
          startX: event.clientX,
          startWidth: visible[pane],
          original: preferredRef.current,
          draft: initial,
          element,
        }
        element.setPointerCapture?.(event.pointerId)
        setResizing(true)
      },
      onPointerMove: (event: PointerEvent<HTMLElement>) => {
        if (session.current?.pointerId === event.pointerId) move(event.clientX)
      },
      onPointerUp: (event: PointerEvent<HTMLElement>) => {
        if (session.current?.pointerId === event.pointerId) finish(false)
      },
      onPointerCancel: (event: PointerEvent<HTMLElement>) => {
        if (session.current?.pointerId === event.pointerId) finish(true)
      },
      onLostPointerCapture: () => finish(true),
    }
  }

  const effective = preferred ? effectivePaneWidths(preferred, contextFor(preferred)) : undefined
  const cssVariables = effective
    ? ({
        '--sidebar-override': `${effective.sidebar}px`,
        '--list-override': `${effective.noteList}px`,
      } as CSSProperties)
    : ({} as CSSProperties)

  return { cssVariables, dividerProps, resizing }
}
