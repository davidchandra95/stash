import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from 'react'
import {
  defaultContentsWidth,
  maximumContentsWidth,
  minimumContentsWidth,
  minimumDocumentWidth,
  normalizeContentsWidth,
  visibleContentsWidth,
} from './contentsWidth'

type Session = {
  pointerId: number
  startX: number
  startWidth: number
  original: number
  element: HTMLElement
}

export function useContentsResize({
  workspaceRef,
  savedWidth,
  disabled,
  onCommit,
  side = 'right',
  reserveWidth,
  adaptive = false,
}: {
  workspaceRef: RefObject<HTMLElement | null>
  savedWidth: number | undefined
  disabled: boolean
  onCommit: (width: number) => void
  side?: 'left' | 'right'
  reserveWidth?: (workspaceWidth: number) => number
  /** Notes can overlay instead of reducing the surrounding workspace panes. */
  adaptive?: boolean
}) {
  const [preferred, setPreferred] = useState(
    () => normalizeContentsWidth(savedWidth) ?? defaultContentsWidth,
  )
  const preferredRef = useRef(preferred)
  // The live width is kept in a ref. State changes only when it changes the layout below,
  // so resizing neighbouring panes does not re-render the workspace on every pixel.
  const workspaceWidth = useRef(0)
  const [, setLayoutWidth] = useState(0)
  const [resizing, setResizing] = useState(false)
  const session = useRef<Session | null>(null)
  const latest = useRef({ disabled, onCommit })
  latest.current = { disabled, onCommit }

  const setWidth = (width: number) => {
    preferredRef.current = width
    setPreferred(width)
  }

  useLayoutEffect(() => {
    if (!session.current) setWidth(normalizeContentsWidth(savedWidth) ?? defaultContentsWidth)
  }, [savedWidth])

  const documentSpace = (width: number) => width - (reserveWidth?.(width) ?? 0)
  const layoutFor = (width: number, preferredWidth: number) => {
    const overlay =
      adaptive && width > 0 && documentSpace(width) < preferredWidth + minimumDocumentWidth
    const shown = overlay
      ? Math.min(preferredWidth, documentSpace(width))
      : visibleContentsWidth(preferredWidth, documentSpace(width))
    return { overlay, shown }
  }
  const latestLayout = useRef(layoutFor)
  latestLayout.current = layoutFor

  useLayoutEffect(() => {
    const workspace = workspaceRef.current
    if (!workspace) return
    const measure = () => {
      const width = Math.round(workspace.getBoundingClientRect().width)
      const layoutFor = latestLayout.current
      const previous = layoutFor(workspaceWidth.current, preferredRef.current)
      workspaceWidth.current = width
      const next = layoutFor(width, preferredRef.current)
      if (previous.overlay !== next.overlay || previous.shown !== next.shown) setLayoutWidth(width)
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(workspace)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [workspaceRef])

  const availableWidth = () =>
    Math.round(workspaceRef.current?.getBoundingClientRect().width ?? 0) || workspaceWidth.current
  const maximum = () =>
    Math.max(
      minimumContentsWidth,
      Math.min(maximumContentsWidth, documentSpace(availableWidth()) - minimumDocumentWidth),
    )
  const { overlay, shown } = layoutFor(workspaceWidth.current, preferred)
  const direction = side === 'left' ? 1 : -1

  const finish = (cancelled: boolean) => {
    const active = session.current
    if (!active) return
    session.current = null
    if (active.element.hasPointerCapture?.(active.pointerId))
      active.element.releasePointerCapture(active.pointerId)
    setResizing(false)
    if (cancelled) setWidth(active.original)
    else latest.current.onCommit(preferredRef.current)
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

  useEffect(() => {
    if (disabled || overlay) finish(true)
  }, [disabled, overlay])

  const handlers = {
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.key === 'Escape' && session.current) {
        event.preventDefault()
        event.stopPropagation()
        finish(true)
        return
      }
      if (latest.current.disabled || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return
      event.preventDefault()
      const step = (event.key === 'ArrowRight' ? direction : -direction) * (event.shiftKey ? 32 : 8)
      const width = Math.max(minimumContentsWidth, Math.min(maximum(), shown + step))
      setWidth(width)
      latest.current.onCommit(width)
    },
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (latest.current.disabled || event.button !== 0) return
      event.preventDefault()
      session.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: shown,
        original: preferredRef.current,
        element: event.currentTarget,
      }
      event.currentTarget.setPointerCapture?.(event.pointerId)
      event.currentTarget.focus({ preventScroll: true })
      setResizing(true)
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const active = session.current
      if (!active || active.pointerId !== event.pointerId) return
      setWidth(
        Math.max(
          minimumContentsWidth,
          Math.min(
            maximum(),
            Math.round(active.startWidth + direction * (event.clientX - active.startX)),
          ),
        ),
      )
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      if (session.current?.pointerId === event.pointerId) finish(false)
    },
    onPointerCancel: (event: PointerEvent<HTMLElement>) => {
      if (session.current?.pointerId === event.pointerId) finish(true)
    },
    onLostPointerCapture: () => finish(true),
  }
  // Stable props, so views holding them re-render only when the divider's values change.
  const latestHandlers = useRef(handlers)
  latestHandlers.current = handlers
  const stableHandlers = useMemo(
    () => ({
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => latestHandlers.current.onKeyDown(event),
      onPointerDown: (event: PointerEvent<HTMLElement>) =>
        latestHandlers.current.onPointerDown(event),
      onPointerMove: (event: PointerEvent<HTMLElement>) =>
        latestHandlers.current.onPointerMove(event),
      onPointerUp: (event: PointerEvent<HTMLElement>) => latestHandlers.current.onPointerUp(event),
      onPointerCancel: (event: PointerEvent<HTMLElement>) =>
        latestHandlers.current.onPointerCancel(event),
      onLostPointerCapture: () => latestHandlers.current.onLostPointerCapture(),
    }),
    [],
  )
  const maximumWidth = maximum()
  const dividerProps = useMemo(
    () => ({
      className: 'contents-resizer',
      role: 'separator' as const,
      'aria-orientation': 'vertical' as const,
      'aria-label': 'Resize table of contents',
      'aria-valuemin': minimumContentsWidth,
      'aria-valuemax': maximumWidth,
      'aria-valuenow': shown,
      'aria-valuetext': `${shown} pixels`,
      'aria-disabled': disabled || undefined,
      tabIndex: disabled ? -1 : 0,
      ...stableHandlers,
    }),
    [maximumWidth, shown, disabled, stableHandlers],
  )

  return {
    cssVariables: { '--contents-width': `${shown}px` } as CSSProperties,
    dividerProps,
    resizing,
    visibleWidth: shown,
    overlay,
  }
}
