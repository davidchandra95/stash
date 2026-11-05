import { useLayoutEffect } from 'react'

const attribute = 'data-drag-cursor'
let holds = 0

/** Shows the grabbing cursor across the window until every holder has released it. */
export function holdDragCursor() {
  if (holds++ === 0) document.documentElement.setAttribute(attribute, '')
  let released = false
  return () => {
    if (released) return
    released = true
    if (--holds === 0) document.documentElement.removeAttribute(attribute)
  }
}

export function useDragCursor(active: boolean) {
  useLayoutEffect(() => (active ? holdDragCursor() : undefined), [active])
}
