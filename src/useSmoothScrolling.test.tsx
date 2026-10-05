// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useMotionPreference } from './motion'
import { enableSmoothScrolling, useSmoothScrolling } from './useSmoothScrolling'

let cleanup: () => void
let now: number
let frames: Map<number, FrameRequestCallback>
let nextFrame: number
beforeEach(() => {
  now = 0
  frames = new Map()
  nextFrame = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback)
    return nextFrame
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  cleanup = enableSmoothScrolling(document)
})
afterEach(() => {
  cleanup()
  document.body.replaceChildren()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
function advance(ms: number) {
  now += ms
  const pending = [...frames.values()]
  frames.clear()
  pending.forEach((callback) => callback(now))
}
function pane(parent: HTMLElement = document.body) {
  const element = document.createElement('div')
  element.style.overflowY = 'auto'
  element.style.lineHeight = '20px'
  Object.defineProperties(element, {
    scrollHeight: { configurable: true, value: 1000 },
    clientHeight: { value: 200 },
  })
  parent.append(element)
  return element
}
function wheel(element: HTMLElement, deltaY: number, options: WheelEventInit = {}) {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY, ...options })
  element.dispatchEvent(event)
  return event
}

it('moves gradually, accumulates fast wheel input, and stops at the pane boundary', () => {
  const element = pane()
  expect(wheel(element, 100).defaultPrevented).toBe(true)
  expect(element.scrollTop).toBe(0)
  advance(40)
  expect(element.scrollTop).toBeGreaterThan(0)
  expect(element.scrollTop).toBeLessThan(100)
  wheel(element, 100)
  advance(160)
  expect(element.scrollTop).toBe(200)
  wheel(element, 2000)
  advance(160)
  expect(element.scrollTop).toBe(800)
  expect(wheel(element, 100).defaultPrevented).toBe(false)
  expect(frames.size).toBe(0)
})

it('reverses from the visible position immediately', () => {
  const element = pane()
  element.scrollTop = 200
  wheel(element, 400)
  advance(40)
  const visible = element.scrollTop
  wheel(element, -100)
  advance(40)
  expect(element.scrollTop).toBeLessThan(visible)
  advance(160)
  expect(element.scrollTop).toBe(visible - 100)
})

it('normalizes lines and pages while retaining small pixel movement', () => {
  const element = pane()
  wheel(element, 3, { deltaMode: WheelEvent.DOM_DELTA_LINE })
  advance(160)
  expect(element.scrollTop).toBe(60)
  wheel(element, 1, { deltaMode: WheelEvent.DOM_DELTA_PAGE })
  advance(160)
  expect(element.scrollTop).toBe(260)
  wheel(element, 2.5)
  advance(160)
  expect(element.scrollTop).toBe(262.5)
})

it('scrolls only the nearest pane, including a floating dialog', () => {
  const outer = pane()
  const inner = pane(outer)
  const child = document.createElement('span')
  inner.append(child)
  wheel(child, 100)
  advance(160)
  expect(inner.scrollTop).toBe(100)
  expect(outer.scrollTop).toBe(0)
  const portal = pane()
  wheel(portal, 80)
  advance(160)
  expect(portal.scrollTop).toBe(80)
  expect(inner.scrollTop).toBe(100)
})

it('chains at a boundary only when the inner pane allows it', () => {
  const outer = pane()
  const inner = pane(outer)
  inner.scrollTop = 800
  wheel(inner, 100)
  advance(160)
  expect(outer.scrollTop).toBe(100)
  inner.style.overscrollBehaviorY = 'contain'
  expect(wheel(inner, 100).defaultPrevented).toBe(false)
  expect(frames.size).toBe(0)
  expect(outer.scrollTop).toBe(100)
})

it('keeps horizontal scrolling, modifier gestures and non-cancelable input native', () => {
  const element = pane()
  for (const options of [
    { deltaX: 10 },
    { ctrlKey: true },
    { metaKey: true },
    { shiftKey: true },
    { altKey: true },
    { cancelable: false },
  ])
    expect(wheel(element, 100, options).defaultPrevented).toBe(false)
  expect(element.scrollTop).toBe(0)
  expect(frames.size).toBe(0)
})

it('respects another handler and native wheel controls', () => {
  const element = pane()
  const select = document.createElement('select')
  element.append(select)
  expect(wheel(select, 100).defaultPrevented).toBe(false)
  const input = document.createElement('input')
  input.type = 'number'
  element.append(input)
  expect(wheel(input, 100).defaultPrevented).toBe(false)
  element.addEventListener('wheel', (event) => event.preventDefault())
  wheel(element, 100)
  expect(frames.size).toBe(0)
})

it('stops when typing, clicking, touching or switching notes', () => {
  const element = pane()
  for (const type of ['keydown', 'pointerdown', 'touchstart', 'writing-deactivate']) {
    wheel(element, 100)
    advance(40)
    const visible = element.scrollTop
    element.dispatchEvent(new Event(type, { bubbles: true }))
    advance(160)
    expect(element.scrollTop).toBe(visible)
    expect(frames.size).toBe(0)
  }
})

it('does not overwrite restored positions or continue after a pane disappears', () => {
  const element = pane()
  wheel(element, 100)
  advance(40)
  element.scrollTop = 350
  advance(160)
  expect(element.scrollTop).toBe(350)
  wheel(element, 100)
  element.remove()
  advance(160)
  expect(element.scrollTop).toBe(350)
  expect(frames.size).toBe(0)
})

it('stops on cleanup and removes the wheel handler', () => {
  const element = pane()
  wheel(element, 100)
  advance(40)
  const visible = element.scrollTop
  cleanup()
  advance(160)
  expect(element.scrollTop).toBe(visible)
  expect(wheel(element, 100).defaultPrevented).toBe(false)
})

it('obeys the animation setting and live system Reduce Motion', async () => {
  cleanup()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  let notify!: () => void
  const media = {
    matches: false,
    addEventListener: vi.fn((_event, callback) => {
      notify = callback
    }),
    removeEventListener: vi.fn(),
  }
  vi.stubGlobal('matchMedia', () => media)
  function Policy({ enabled }: { enabled: boolean }) {
    useSmoothScrolling(useMotionPreference(enabled))
    return null
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const element = pane()
  try {
    await act(() => root.render(<Policy enabled={false} />))
    expect(wheel(element, 100).defaultPrevented).toBe(false)
    await act(() => root.render(<Policy enabled />))
    expect(wheel(element, 100).defaultPrevented).toBe(true)
    advance(40)
    const visible = element.scrollTop
    await act(() => {
      media.matches = true
      notify()
    })
    advance(160)
    expect(element.scrollTop).toBe(visible)
    expect(wheel(element, 100).defaultPrevented).toBe(false)
    await act(() => {
      media.matches = false
      notify()
    })
    expect(wheel(element, 100).defaultPrevented).toBe(true)
  } finally {
    await act(() => root.unmount())
  }
})
