import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'

type Session = {
  id: string
  pointerId: number
  button: HTMLElement
  startX: number
  startY: number
  x: number
  y: number
  startScroll: number
  index: number
  target: number
  active: boolean
  items: { id: string; left: number; width: number }[]
}

export function useTabDrag(
  stripRef: RefObject<HTMLDivElement | null>,
  signature: string,
  disabled: boolean,
  onMove: (id: string, index: number) => void,
  constrain: (id: string, index: number) => number = (_, index) => index,
) {
  const session = useRef<Session | null>(null)
  const suppressClick = useRef(false)
  const [visual, setVisual] = useState<{ id: string; offsets: Record<string, number> } | null>(null)
  const callback = useRef(onMove)
  callback.current = onMove
  const constrainRef = useRef(constrain)
  constrainRef.current = constrain
  useEffect(() => {
    let frame = 0
    let lastTime = 0
    const finish = (commit = false) => {
      const drag = session.current
      if (!drag) return
      session.current = null
      cancelAnimationFrame(frame)
      if (drag.button.hasPointerCapture?.(drag.pointerId))
        drag.button.releasePointerCapture(drag.pointerId)
      setVisual(null)
      if (commit && drag.active && drag.target !== drag.index)
        callback.current(drag.id, drag.target)
    }
    const paint = () => {
      const drag = session.current,
        strip = stripRef.current
      if (!drag || !strip || !drag.active) return
      const source = drag.items[drag.index]
      const delta = drag.x - drag.startX + strip.scrollLeft - drag.startScroll
      const totalWidth = drag.items.reduce((sum, item) => sum + item.width, 0)
      const lastLeft = totalWidth - source.width
      const minIndex = constrainRef.current(drag.id, 0)
      const maxIndex = constrainRef.current(drag.id, drag.items.length - 1)
      const minLeft = drag.items[minIndex].left
      const maxItem = drag.items[maxIndex]
      const maxLeft = Math.min(lastLeft, maxItem.left + maxItem.width - source.width)
      const left = Math.max(minLeft, Math.min(maxLeft, source.left + delta))
      const center = left + source.width / 2
      const others = drag.items.filter((item) => item.id !== drag.id)
      drag.target =
        left <= 0
          ? 0
          : left >= lastLeft
            ? others.length
            : others.filter((item) => center >= item.left + item.width / 2).length
      drag.target = constrainRef.current(drag.id, drag.target)
      const order = [...others]
      order.splice(drag.target, 0, source)
      let nextLeft = 0
      const offsets: Record<string, number> = {}
      for (const item of order) {
        offsets[item.id] = item.id === drag.id ? left - source.left : nextLeft - item.left
        nextLeft += item.width
      }
      setVisual({ id: drag.id, offsets })
    }
    const tick = (time: number) => {
      const drag = session.current,
        strip = stripRef.current
      if (!drag?.active || !strip) return
      const bounds = strip.getBoundingClientRect()
      const elapsed = lastTime ? Math.min(time - lastTime, 32) : 16
      lastTime = time
      if (
        drag.y >= bounds.top &&
        drag.y <= bounds.bottom &&
        drag.x >= bounds.left &&
        drag.x <= bounds.right
      ) {
        const edge = Math.min(40, bounds.width / 4)
        const speed =
          drag.x < bounds.left + edge
            ? -(bounds.left + edge - drag.x) / edge
            : drag.x > bounds.right - edge
              ? (drag.x - bounds.right + edge) / edge
              : 0
        strip.scrollLeft = Math.max(
          0,
          Math.min(
            strip.scrollWidth - strip.clientWidth,
            strip.scrollLeft + speed * elapsed * 0.65,
          ),
        )
      }
      paint()
      frame = requestAnimationFrame(tick)
    }
    const move = (event: PointerEvent) => {
      const drag = session.current
      if (!drag || drag.pointerId !== event.pointerId) return
      drag.x = event.clientX
      drag.y = event.clientY
      if (!drag.active && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) >= 6) {
        drag.active = true
        suppressClick.current = true
        drag.button.setPointerCapture?.(drag.pointerId)
        frame = requestAnimationFrame(tick)
      }
      if (drag.active) {
        event.preventDefault()
        paint()
      }
    }
    const up = (event: PointerEvent) => {
      if (event.pointerId !== session.current?.pointerId) return
      const bounds = stripRef.current?.getBoundingClientRect()
      finish(
        !!bounds &&
          event.clientX >= bounds.left &&
          event.clientX <= bounds.right &&
          event.clientY >= bounds.top &&
          event.clientY <= bounds.bottom,
      )
    }
    const cancel = () => finish()
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && session.current) {
        event.preventDefault()
        event.stopPropagation()
        finish()
      }
    }
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('blur', cancel)
    window.addEventListener('keydown', key, true)
    window.addEventListener('lostpointercapture', cancel)
    return () => {
      finish()
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('blur', cancel)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('lostpointercapture', cancel)
    }
  }, [signature, disabled, stripRef])
  return {
    visual,
    session,
    suppressClick,
    start(event: ReactPointerEvent<HTMLElement>, id: string) {
      suppressClick.current = false
      const strip = stripRef.current
      if (disabled || event.button !== 0 || event.isPrimary === false || !strip) return
      const bounds = strip.getBoundingClientRect()
      const items = Array.from(strip.querySelectorAll<HTMLElement>('[data-tab-id]')).map((el) => {
        const rect = el.getBoundingClientRect()
        return {
          id: el.dataset.tabId!,
          left: rect.left - bounds.left + strip.scrollLeft,
          width: rect.width,
        }
      })
      if (items.length < 2) return
      const index = items.findIndex((item) => item.id === id)
      session.current = {
        id,
        pointerId: event.pointerId,
        button: event.currentTarget,
        startX: event.clientX,
        startY: event.clientY,
        x: event.clientX,
        y: event.clientY,
        startScroll: strip.scrollLeft,
        index,
        target: index,
        active: false,
        items,
      }
    },
  }
}
