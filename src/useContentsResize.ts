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
  const [workspaceWidth, setWorkspaceWidth] = useState(0)
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

  useLayoutEffect(() => {
    const workspace = workspaceRef.current
    if (!workspace) return
    const measure = () => setWorkspaceWidth(Math.round(workspace.getBoundingClientRect().width))
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
    Math.round(workspaceRef.current?.getBoundingClientRect().width ?? 0) || workspaceWidth
  const documentSpace = (width: number) => width - (reserveWidth?.(width) ?? 0)
  const maximum = () =>
    Math.max(
      minimumContentsWidth,
      Math.min(maximumContentsWidth, documentSpace(availableWidth()) - minimumDocumentWidth),
    )
  const overlay =
    adaptive &&
    workspaceWidth > 0 &&
    documentSpace(workspaceWidth) < preferred + minimumDocumentWidth
  const shown = overlay
    ? Math.min(preferred, documentSpace(workspaceWidth))
    : visibleContentsWidth(preferred, documentSpace(workspaceWidth))
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

  const dividerProps = {
    className: 'contents-resizer',
    role: 'separator' as const,
    'aria-orientation': 'vertical' as const,
    'aria-label': 'Resize table of contents',
    'aria-valuemin': minimumContentsWidth,
    'aria-valuemax': maximum(),
    'aria-valuenow': shown,
    'aria-valuetext': `${shown} pixels`,
    'aria-disabled': disabled || undefined,
    tabIndex: disabled ? -1 : 0,
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

  return {
    cssVariables: { '--contents-width': `${shown}px` } as CSSProperties,
    dividerProps,
    resizing,
    visibleWidth: shown,
    overlay,
  }
}
