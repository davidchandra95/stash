import { useLayoutEffect } from 'react'

const duration = 160

/** Desktop wheel input only. Touch, caret movement and saved positions stay native. */
export function enableSmoothScrolling(doc: Document) {
  const win = doc.defaultView!
  let frame = 0
  let active:
    | {
        element: HTMLElement
        from: number
        to: number
        started: number
        written: number
      }
    | undefined

  const cancel = () => {
    win.cancelAnimationFrame(frame)
    frame = 0
    active = undefined
  }
  const tick = (now: number) => {
    frame = 0
    const state = active
    if (!state) return
    const element = state.element
    // A note switch, typing, drag or navigation may have moved the pane meanwhile.
    if (!element.isConnected || Math.abs(element.scrollTop - state.written) > 1) {
      cancel()
      return
    }
    const progress = Math.min(1, Math.max(0, (now - state.started) / duration))
    const target = Math.min(state.to, Math.max(0, element.scrollHeight - element.clientHeight))
    element.scrollTop = state.from + (target - state.from) * (1 - (1 - progress) ** 3)
    state.written = element.scrollTop
    if (progress < 1 && Math.abs(target - state.written) > 0.5)
      frame = win.requestAnimationFrame(tick)
    else {
      element.scrollTop = target
      active = undefined
    }
  }
  const wheel = (event: WheelEvent) => {
    // Access deltaMode before the delta values: some browsers adapt their units.
    const mode = event.deltaMode
    if (
      event.defaultPrevented ||
      !event.cancelable ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.shiftKey ||
      event.deltaX !== 0 ||
      !event.deltaY
    ) {
      cancel()
      return
    }
    for (const node of event.composedPath()) {
      if (!(node instanceof HTMLElement)) continue
      if (node.matches('select, input[type="number"], input[type="range"]')) {
        cancel()
        return
      }
      const style = win.getComputedStyle(node)
      if (!/^(auto|scroll)$/.test(style.overflowY) || node.scrollHeight <= node.clientHeight)
        continue
      const unit =
        mode === 1 ? parseFloat(style.lineHeight) || 16 : mode === 2 ? node.clientHeight : 1
      const delta = event.deltaY * unit
      const limit = node.scrollHeight - node.clientHeight
      const current = node.scrollTop
      const previous =
        active?.element === node && Math.abs(current - active.written) <= 1 ? active : undefined
      // Reversing direction responds immediately instead of draining queued movement.
      const origin =
        previous && Math.sign(previous.to - current) === Math.sign(delta) ? previous.to : current
      const target = Math.max(0, Math.min(limit, origin + delta))
      if (target === current) {
        if (/^(contain|none)$/.test(style.overscrollBehaviorY)) {
          cancel()
          return
        }
        continue
      }
      event.preventDefault()
      cancel()
      active = {
        element: node,
        from: current,
        to: target,
        started: win.performance.now(),
        written: current,
      }
      frame = win.requestAnimationFrame(tick)
      return
    }
    cancel()
  }

  doc.addEventListener('wheel', wheel, { passive: false })
  doc.addEventListener('pointerdown', cancel, true)
  doc.addEventListener('keydown', cancel, true)
  doc.addEventListener('touchstart', cancel, { passive: true, capture: true })
  doc.addEventListener('writing-deactivate', cancel, true)
  win.addEventListener('blur', cancel)
  return () => {
    cancel()
    doc.removeEventListener('wheel', wheel)
    doc.removeEventListener('pointerdown', cancel, true)
    doc.removeEventListener('keydown', cancel, true)
    doc.removeEventListener('touchstart', cancel, true)
    doc.removeEventListener('writing-deactivate', cancel, true)
    win.removeEventListener('blur', cancel)
  }
}

export function useSmoothScrolling(enabled: boolean) {
  useLayoutEffect(() => {
    if (enabled) return enableSmoothScrolling(document)
  }, [enabled])
}
