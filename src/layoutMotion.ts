import { useLayoutEffect, type RefObject } from 'react'
import { motionEase } from './motion'

/**
 * Pane show/hide motion for the desktop window. The grid snaps to its final columns in one
 * layout, then panes slide into place with transforms, so the editor never re-wraps its text
 * on every frame of the animation.
 */
const panes = [':scope > .sidebar', ':scope > .note-list', ':scope > .editor-pane']
type Snapshot = { element: HTMLElement; rect: DOMRect }
type Pending = { duration: number; origin: DOMRect; panes: Snapshot[] }
const pending = new WeakMap<HTMLElement, Pending>()
const running = new WeakMap<HTMLElement, () => void>()

/** A zero-width track can still hold a pane's 1px border. */
const collapsed = (rect: DOMRect) => rect.width <= 1

function visiblePanes(app: HTMLElement) {
  return panes
    .map((selector) => app.querySelector<HTMLElement>(selector))
    .filter((element): element is HTMLElement => !!element)
}

/** Call before the state change that shows or hides panes. */
export function captureLayout(app: HTMLElement | null, duration: number) {
  if (!app) return
  pending.set(app, {
    duration,
    origin: app.getBoundingClientRect(),
    // Mid-animation rects include transforms, so an interrupted motion continues smoothly.
    panes: visiblePanes(app).map((element) => ({ element, rect: element.getBoundingClientRect() })),
  })
}

function play(app: HTMLElement, { duration, origin, panes: first }: Pending) {
  const { left, top } = origin
  running.get(app)?.()
  const animations: Animation[] = []
  const pinned: HTMLElement[] = []
  // Final rects, in window order: sidebar, notes list, editor.
  const final = visiblePanes(app).map((element) => ({
    element,
    last: element.getBoundingClientRect(),
  }))
  // Panes enter from behind what was to their left before the change, and leave behind what
  // will be to their left after it, or the window edge.
  const order = new Map(final.map(({ element }, index) => [element, index]))
  const edge = (layout: { element: HTMLElement; rect: DOMRect }[], element: HTMLElement) => {
    let right = left
    for (const pane of layout)
      if ((order.get(pane.element) ?? Infinity) < order.get(element)! && !collapsed(pane.rect))
        right = Math.max(right, pane.rect.right)
    return right
  }
  const after = final.map(({ element, last }) => ({ element, rect: last }))
  type Motion = { element: HTMLElement; from: number; to: number; x: number; width: number }
  const motions: Motion[] = []
  for (const { element, last } of final) {
    const rect = first.find((pane) => pane.element === element)?.rect
    // Panes mounted by this change (the sidebar unmounts while hidden) count as entering.
    const hiding = !!rect && !collapsed(rect) && collapsed(last)
    const showing = (!rect || collapsed(rect)) && !collapsed(last)
    if (hiding) {
      // Keep the hidden pane at its old size, off the grid, while it slides out. Without a
      // grid area, its containing block is the window itself.
      Object.assign(element.style, {
        gridArea: 'auto',
        margin: '0',
        position: 'absolute',
        top: `${rect.top - top}px`,
        height: `${rect.height}px`,
        left: `${rect.left - left}px`,
        width: `${rect.width}px`,
      })
      pinned.push(element)
      const to = edge(after, element) - rect.right
      motions.push({ element, from: 0, to, x: rect.left, width: rect.width })
    } else if (showing) {
      const from = edge(first, element) - last.right
      motions.push({ element, from, to: 0, x: last.left, width: last.width })
    } else if (rect && !collapsed(last)) {
      let width = last.width
      if (last.width < rect.width) {
        // Shrinking panes keep their old width until the end, so no gap opens at the edge.
        element.style.width = `${rect.width}px`
        pinned.push(element)
        width = rect.width
      }
      motions.push({ element, from: rect.left - last.left, to: 0, x: last.left, width })
    } else if (!collapsed(last))
      motions.push({ element, from: 0, to: 0, x: last.left, width: last.width })
  }
  // A sliding pane is clipped at the right edge of the panes to its left, so it never shows
  // through them. Every pane shares the easing, so the clip moves linearly with the slide.
  for (const motion of motions) {
    const index = order.get(motion.element)!
    // The window edge needs no clip; the window clips overflow while panes move.
    const clip = (key: 'from' | 'to') => {
      let edge = -Infinity
      for (const other of motions)
        if (order.get(other.element)! < index)
          edge = Math.max(edge, other.x + other[key] + other.width)
      return Math.max(0, edge - (motion.x + motion[key]))
    }
    const clipFrom = clip('from')
    const clipTo = clip('to')
    if (motion.from === motion.to && !clipFrom && !clipTo) continue
    // Clip only where needed: clip-path animates on the main thread, transforms do not.
    const keyframes: Keyframe[] = [
      { transform: `translateX(${motion.from}px)` },
      { transform: `translateX(${motion.to}px)` },
    ]
    if (clipFrom || clipTo) {
      keyframes[0].clipPath = `inset(0 0 0 ${clipFrom}px)`
      keyframes[1].clipPath = `inset(0 0 0 ${clipTo}px)`
    }
    animations.push(motion.element.animate(keyframes, { duration, easing: motionEase }))
  }
  if (!animations.length && !pinned.length) return
  app.classList.add('is-layout-moving')
  const finish = () => {
    if (running.get(app) !== finish) return
    running.delete(app)
    for (const animation of animations) animation.cancel()
    for (const element of pinned)
      for (const property of ['grid-area', 'margin', 'position', 'top', 'height', 'left', 'width'])
        element.style.removeProperty(property)
    app.classList.remove('is-layout-moving')
  }
  running.set(app, finish)
  if (animations.length) void Promise.all(animations.map((a) => a.finished)).then(finish, finish)
  else finish()
}

/** Plays a captured pane change after React commits it, before the browser paints. */
export function useLayoutMotion(appRef: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const app = appRef.current
    const capture = app && pending.get(app)
    if (!app || !capture) return
    pending.delete(app)
    play(app, capture)
  })
}
