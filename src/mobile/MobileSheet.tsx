import { useRef, type PointerEvent, type ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from '../icons'
import { animate, motion } from '../motion'

/** Dragging the header this far (or flicking it) dismisses the sheet. */
const dismissFraction = 0.3
const flickSpeed = 0.5 // px per ms

/** A bottom sheet, or the navigation drawer. Theme comes from <html data-theme>. */
export default function MobileSheet({
  title,
  close,
  children,
  drawer,
}: {
  title: string
  close: () => void
  children: ReactNode
  drawer?: boolean
}) {
  const content = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: number; start: number; at: number; time: number; speed: number }>(
    undefined,
  )
  // Sheets pull down and the drawer pushes left; the header is the handle, so the
  // sheet's scrolling content keeps its own gestures.
  const offset = (event: PointerEvent) => {
    const position = drawer ? event.clientX : event.clientY
    const delta = position - drag.current!.start
    return drawer ? Math.min(0, delta) : Math.max(0, delta)
  }
  const place = (value: number) => {
    content.current!.style.transform = value
      ? drawer
        ? `translateX(${value}px)`
        : `translateY(${value}px)`
      : ''
  }
  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (!event.isPrimary || (event.target as Element).closest('button')) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const start = drawer ? event.clientX : event.clientY
    drag.current = { id: event.pointerId, start, at: 0, time: event.timeStamp, speed: 0 }
    content.current!.style.animation = 'none'
  }
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const current = drag.current
    if (!current || current.id !== event.pointerId) return
    const at = offset(event)
    const elapsed = event.timeStamp - current.time
    if (elapsed > 0) current.speed = Math.abs(at - current.at) / elapsed
    current.at = at
    current.time = event.timeStamp
    place(at)
  }
  const onPointerUp = (event: PointerEvent<HTMLElement>) => {
    const current = drag.current
    if (!current || current.id !== event.pointerId) return
    drag.current = undefined
    const element = content.current!
    const size = drawer ? element.offsetWidth : element.offsetHeight
    const distance = Math.abs(current.at)
    const axis = drawer ? 'translateX' : 'translateY'
    const from = { transform: `${axis}(${current.at}px)` }
    place(0)
    if (
      event.type === 'pointerup' &&
      (distance > size * dismissFraction || (distance > 24 && current.speed > flickSpeed))
    ) {
      element.style.transform = `${axis}(${drawer ? -size : size}px)`
      animate(
        element,
        [from, { transform: `${axis}(${drawer ? -size : size}px)` }],
        motion.sheet,
        close,
      )
    } else if (distance) {
      animate(element, [from, { transform: `${axis}(0)` }], motion.sheet)
    }
  }
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="mobile-scrim" />
        <Dialog.Content
          ref={content}
          className={drawer ? 'mobile-drawer' : 'mobile-sheet'}
          onOpenAutoFocus={(e) => {
            e.preventDefault()
          }}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <header
            className="mobile-sheet-handle"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close className="icon-btn" aria-label={`Close ${title}`}>
              <X aria-hidden="true" />
            </Dialog.Close>
          </header>
          <Dialog.Description className="sr-only">
            {drawer ? 'Choose a library view or notebook.' : `${title} options`}
          </Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
