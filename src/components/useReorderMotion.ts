import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react'
import { animate, motion, motionEnabled, useMotionEnabled } from '../motion'

type Position = { x: number; y: number }

/** Capture only an explicit reorder, then slide surviving items into their new slots. */
export function useReorderMotion(ref: RefObject<HTMLElement | null>, selector: string) {
  const pending = useRef<Map<HTMLElement, Position> | null>(null)
  const running = useRef<Animation[]>([])
  const enabled = useMotionEnabled()
  const cancel = useCallback(() => {
    running.current.forEach((animation) => animation.cancel())
    running.current = []
  }, [])
  const capture = useCallback(() => {
    const parent = ref.current
    if (!parent || !motionEnabled()) return
    const bounds = parent.getBoundingClientRect()
    // Capture the drawn positions before cancelling, including interrupted animations.
    pending.current = new Map(
      [...parent.querySelectorAll<HTMLElement>(selector)].map((element) => {
        const rect = element.getBoundingClientRect()
        return [
          element,
          {
            x: rect.left - bounds.left + parent.scrollLeft,
            y: rect.top - bounds.top + parent.scrollTop,
          },
        ]
      }),
    )
    cancel()
  }, [ref, selector, cancel])

  useLayoutEffect(() => {
    if (!enabled) {
      pending.current = null
      cancel()
      return
    }
    const before = pending.current
    pending.current = null
    const parent = ref.current
    if (!before || !parent) return
    cancel()
    const bounds = parent.getBoundingClientRect()
    // Read every final position before starting animations, avoiding per-item layouts.
    const moved = [...parent.querySelectorAll<HTMLElement>(selector)].flatMap((element) => {
      const position = before.get(element)
      if (!position) return []
      const rect = element.getBoundingClientRect()
      const x = position.x - (rect.left - bounds.left + parent.scrollLeft)
      const y = position.y - (rect.top - bounds.top + parent.scrollTop)
      return Math.abs(x) < 0.5 && Math.abs(y) < 0.5 ? [] : [{ element, x, y }]
    })
    for (const { element, x, y } of moved) {
      const animation = animate(
        element,
        [{ transform: `translate(${x}px, ${y}px)` }, { transform: 'translate(0, 0)' }],
        motion.reorder,
      )
      if (animation) running.current.push(animation)
    }
  })
  useLayoutEffect(() => cancel, [cancel])
  return { capture, cancel }
}
