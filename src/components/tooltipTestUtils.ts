import { act } from 'react'
import { vi } from 'vitest'

export async function hoverTooltip(target: Element, pointerType = 'mouse', delay = 0) {
  await act(async () => {
    const event = new MouseEvent('pointermove', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'pointerType', { value: pointerType })
    target.dispatchEvent(event)
  })
  // Radix schedules its first hover at setTimeout(0), even with zero delay; text hints wait for their normal hover delay.
  await act(async () => {
    if (vi.isFakeTimers()) vi.advanceTimersByTime(delay)
    else await new Promise((resolve) => setTimeout(resolve, delay))
  })
}
export function tooltipLabel() {
  return document.querySelector('.app-tooltip > .app-tooltip-label')?.textContent
}
export function tooltipShortcut() {
  return document.querySelector('.app-tooltip > .app-tooltip-shortcut')?.textContent
}
