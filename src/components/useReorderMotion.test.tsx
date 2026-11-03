// @vitest-environment jsdom
import { act, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { motion, useMotionPreference } from '../motion'
import { useReorderMotion } from './useReorderMotion'

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let capture: () => void
let enabled = true
let positions: Record<string, number>
let scroll = 0
let mediaChanged: () => void
let reduced = false
let animations: { cancel: ReturnType<typeof vi.fn>; finish: () => void }[]

function Harness({ ids }: { ids: string[] }) {
  useMotionPreference(enabled)
  const ref = useRef<HTMLDivElement>(null)
  capture = useReorderMotion(ref, '[data-item]').capture
  return (
    <div ref={ref}>
      {ids.map((id) => (
        <button key={id} data-item={id}>
          {id}
        </button>
      ))}
    </div>
  )
}
const render = (ids = ['a', 'b', 'c']) => act(() => root.render(<Harness ids={ids} />))

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  enabled = true
  reduced = false
  scroll = 0
  positions = { a: 2, b: 124, c: 246 }
  animations = []
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return reduced
    },
    addEventListener: (_event: string, listener: () => void) => {
      mediaChanged = listener
    },
    removeEventListener: vi.fn(),
  }))
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    return { left: (positions[this.dataset.item!] ?? 0) - scroll, top: 0 } as DOMRect
  })
  Element.prototype.animate = vi.fn(() => {
    let finish!: () => void
    const finished = new Promise<void>((resolve) => {
      finish = resolve
    })
    const cancel = vi.fn(finish)
    animations.push({ cancel, finish })
    return { cancel, finished } as unknown as Animation
  })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await render()
})

afterEach(async () => {
  await act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('slides only moved items on an explicit reorder and preserves the focused button', async () => {
  const focused = host.querySelector<HTMLButtonElement>('[data-item="a"]')!
  focused.focus()
  capture()
  positions = { a: 124, b: 2, c: 246 }
  await render(['b', 'a', 'c'])
  expect(Element.prototype.animate).toHaveBeenCalledTimes(2)
  expect(Element.prototype.animate).toHaveBeenCalledWith(
    [{ transform: 'translate(122px, 0px)' }, { transform: 'translate(0, 0)' }],
    { duration: motion.reorder, easing: expect.any(String) },
  )
  expect(document.activeElement).toBe(focused)
  await render(['a', 'b', 'c'])
  expect(Element.prototype.animate).toHaveBeenCalledTimes(2)
})

it('settles cancelled drags even when item order stays the same', async () => {
  positions = { a: 82, b: 2, c: 246 }
  capture()
  positions = { a: 2, b: 124, c: 246 }
  await render()
  expect(Element.prototype.animate).toHaveBeenCalledTimes(2)
  expect(Element.prototype.animate).toHaveBeenCalledWith(
    [{ transform: 'translate(80px, 0px)' }, { transform: 'translate(0, 0)' }],
    expect.anything(),
  )
})

it('keeps content coordinates stable across scrolling and skips unchanged positions', async () => {
  const parent = host.firstElementChild as HTMLElement
  parent.getBoundingClientRect = () => ({ left: 0, top: 0 }) as DOMRect
  capture()
  parent.scrollLeft = scroll = 90
  await render()
  expect(Element.prototype.animate).not.toHaveBeenCalled()
})

it('continues from interrupted positions and cancels old animations and unmounted items', async () => {
  capture()
  positions = { a: 124, b: 2, c: 246 }
  await render(['b', 'a', 'c'])
  const first = [...animations]
  positions = { a: 70, b: 56, c: 246 }
  capture()
  positions = { a: 2, b: 124, c: 246 }
  await render()
  first.forEach(({ cancel }) => expect(cancel).toHaveBeenCalledOnce())
  expect(Element.prototype.animate).toHaveBeenCalledWith(
    [{ transform: 'translate(68px, 0px)' }, { transform: 'translate(0, 0)' }],
    expect.anything(),
  )
  const last = animations.slice(first.length)
  await act(() => root.unmount())
  last.forEach(({ cancel }) => expect(cancel).toHaveBeenCalledOnce())
  root = createRoot(host)
})

it('skips movement when animations are off and cancels immediately for reduced motion', async () => {
  capture()
  positions = { a: 124, b: 2, c: 246 }
  await render(['b', 'a', 'c'])
  expect(animations).toHaveLength(2)
  await act(() => {
    reduced = true
    mediaChanged()
  })
  animations.forEach(({ cancel }) => expect(cancel).toHaveBeenCalled())
  vi.mocked(Element.prototype.animate).mockClear()
  capture()
  await render()
  expect(Element.prototype.animate).not.toHaveBeenCalled()
  enabled = false
  reduced = false
  await render()
  capture()
  await render(['b', 'a', 'c'])
  expect(Element.prototype.animate).not.toHaveBeenCalled()
})
