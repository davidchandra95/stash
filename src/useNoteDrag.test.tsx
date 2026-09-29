// @vitest-environment jsdom
import { act, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { useNoteDrag } from './useNoteDrag'
import type { Note } from './model'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const notes = ['a', 'b', 'c'].map((id) => ({ id, pinned: false }) as Note)
let cleanup: () => void
function pointer(type: string, y: number, extra = {}) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: 50,
    clientY: y,
    button: 0,
    ...extra,
  })
  Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'mouse' } })
  return event
}
async function mount(notebookTarget = false) {
  vi.useFakeTimers()
  vi.stubGlobal('CSS', { escape: (value: string) => value })
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(() => fn(0), 16))
  vi.stubGlobal('cancelAnimationFrame', clearTimeout)
  let now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  const dropNotebook = vi.fn()
  const resolveTarget = vi.fn((_: string, id: string) => ({
    id,
    allowed: id !== 'linked',
    hint: id === 'linked' ? 'Unavailable' : 'Move to Work',
  }))
  const commit = vi.fn(),
    open = vi.fn()
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  function Harness({ identity = 'list', disabled = false }) {
    const rows = useRef<HTMLDivElement>(null)
    const drag = useNoteDrag({
      rows,
      notes,
      identity,
      disabled,
      animate: () => {},
      commit,
      ...(notebookTarget ? { resolveTarget, dropNotebook } : {}),
    })
    return (
      <div
        ref={rows}
        data-list
        onClickCapture={(event) => {
          if (drag.consumeClick()) {
            event.preventDefault()
            event.stopPropagation()
          }
        }}
      >
        {(drag.preview ?? notes).map((n) => (
          <button
            key={n.id}
            data-note-id={n.id}
            onPointerDown={(e) => drag.onPointerDown(e, n.id)}
            onClick={() => open(n.id)}
          >
            {n.id}
          </button>
        ))}
      </div>
    )
  }
  await act(async () => root.render(<Harness />))
  const list = host.querySelector<HTMLElement>('[data-list]')!
  list.getBoundingClientRect = () =>
    ({ left: 0, right: 100, top: 0, bottom: 150, width: 100, height: 150 }) as DOMRect
  for (const card of host.querySelectorAll<HTMLElement>('[data-note-id]')) {
    Object.defineProperty(card, 'offsetTop', {
      get: () => [...list.querySelectorAll('[data-note-id]')].indexOf(card) * 50,
    })
    Object.defineProperty(card, 'offsetHeight', { value: 50 })
    card.getBoundingClientRect = () =>
      ({ left: 0, top: card.offsetTop, width: 100, height: 50 }) as DOMRect
  }
  cleanup = () => {
    act(() => root.unmount())
    host.remove()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  }
  return {
    host,
    list,
    commit,
    dropNotebook,
    resolveTarget,
    open,
    down: async () =>
      act(() =>
        host.querySelector('[data-note-id="a"]')!.dispatchEvent(pointer('pointerdown', 25)),
      ),
    move: async (y: number, elapsed = 10) => {
      now = elapsed
      await act(() => window.dispatchEvent(pointer('pointermove', y)))
    },
    up: async (y: number) => act(() => window.dispatchEvent(pointer('pointerup', y))),
    cancel: async () =>
      act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))),
    render: async (identity: string, disabled = false) =>
      act(() => root.render(<Harness identity={identity} disabled={disabled} />)),
  }
}
afterEach(() => cleanup?.())
it('starts after the hold, previews a move, commits on drop and suppresses opening', async () => {
  const h = await mount()
  await h.down()
  await h.move(80)
  expect(h.host.querySelector('.note-drag-ghost')).not.toBeNull()
  expect([...h.host.querySelectorAll('[data-note-id]')].map((el) => el.textContent)).toEqual([
    'b',
    'a',
    'c',
  ])
  expect(h.commit).not.toHaveBeenCalled()
  await h.up(80)
  expect(h.commit.mock.calls[0][0].map((n: Note) => n.id)).toEqual(['b', 'a', 'c'])
  await act(() => h.host.querySelector<HTMLButtonElement>('[data-note-id="a"]')!.click())
  expect(h.open).not.toHaveBeenCalled()
  expect(h.host.querySelector('.note-drag-ghost')).toBeNull()
})
it('retains clicks and cancels early movement before the hold', async () => {
  const h = await mount()
  await h.down()
  await h.move(80, 9)
  await h.up(80)
  expect(h.commit).not.toHaveBeenCalled()
  await act(() => h.host.querySelector<HTMLButtonElement>('[data-note-id="a"]')!.click())
  expect(h.open).toHaveBeenCalledWith('a')
})
it.each(['escape', 'outside', 'same', 'list', 'disabled', 'pointercancel'])(
  'does not save a %s cancellation',
  async (kind) => {
    const h = await mount()
    await h.down()
    await h.move(80)
    if (kind === 'escape') await h.cancel()
    if (kind === 'outside') await h.up(250)
    if (kind === 'same') {
      await h.move(25)
      await h.up(25)
    }
    if (kind === 'list') await h.render('other')
    if (kind === 'disabled') await h.render('list', true)
    if (kind === 'pointercancel')
      await act(() => window.dispatchEvent(pointer('pointercancel', 80)))
    expect(h.commit).not.toHaveBeenCalled()
    expect(h.host.querySelector('.note-drag-ghost')).toBeNull()
  },
)
it('scrolls near the bottom edge while dragging', async () => {
  const h = await mount()
  await h.down()
  await h.move(145)
  expect(h.list.scrollTop).toBeGreaterThan(0)
  await h.cancel()
})

it.each([true, false])(
  'notebook drop (allowed=%s) never commits the temporary reorder',
  async (allowed) => {
    const h = await mount(true)
    const target = document.createElement('div')
    target.dataset.notebookDropId = allowed ? 'work' : 'linked'
    let hit: HTMLElement | null = null
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => hit),
    })
    await h.down()
    await h.move(80)
    expect(
      [...h.list.querySelectorAll('[data-note-id]')].map((el) => el.getAttribute('data-note-id')),
    ).toEqual(['b', 'a', 'c'])
    hit = target
    await h.move(250, 30)
    expect(h.host.querySelector('.note-drag-hint')?.textContent).toContain(
      allowed ? 'Move to Work' : 'Unavailable',
    )
    await h.up(250)
    expect(h.commit).not.toHaveBeenCalled()
    if (allowed) expect(h.dropNotebook).toHaveBeenCalledWith('a', 'work')
    else expect(h.dropNotebook).not.toHaveBeenCalled()
    expect(h.host.querySelector('.note-drag-ghost')).toBeNull()
    delete (document as unknown as { elementFromPoint?: unknown }).elementFromPoint
  },
)
it('cancels a notebook drop with Escape and never opens the dragged note', async () => {
  const h = await mount(true)
  const target = document.createElement('div')
  target.dataset.notebookDropId = 'work'
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => target })
  await h.down()
  await h.move(80)
  await h.cancel()
  await h.up(80)
  await act(async () => h.host.querySelector<HTMLButtonElement>('[data-note-id="a"]')!.click())
  expect(h.dropNotebook).not.toHaveBeenCalled()
  expect(h.open).not.toHaveBeenCalled()
  expect(h.commit).not.toHaveBeenCalled()
  delete (document as unknown as { elementFromPoint?: unknown }).elementFromPoint
})

it('waits for the hold threshold when the first movement arrives early', async () => {
  const h = await mount()
  await h.down()
  await h.move(80, 8)
  expect(h.host.querySelector('.note-drag-ghost')).toBeNull()
  await h.move(80, 20)
  expect(h.host.querySelector('.note-drag-ghost')).not.toBeNull()
  await h.up(80)
  expect(h.commit).toHaveBeenCalledTimes(1)
})

it('handles mouse release without pointerup and suppresses the resulting sidebar click', async () => {
  const h = await mount(true)
  const target = document.createElement('button')
  target.dataset.notebookDropId = 'work'
  document.body.append(target)
  const navigate = vi.fn()
  target.addEventListener('click', navigate)
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => target })
  await h.down()
  await h.move(80)
  await act(async () =>
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: 50, clientY: 250, button: 0 })),
  )
  expect(h.dropNotebook).toHaveBeenCalledWith('a', 'work')
  expect(h.host.querySelector('.note-drag-ghost')).toBeNull()
  await act(async () => target.click())
  expect(navigate).not.toHaveBeenCalled()
  await act(async () => {
    target.dispatchEvent(pointer('pointerdown', 250))
    target.click()
  })
  expect(navigate).toHaveBeenCalledTimes(1)
  target.remove()
  delete (document as unknown as { elementFromPoint?: unknown }).elementFromPoint
})

it('scrolls the sidebar near its edge while a notebook is targeted', async () => {
  const h = await mount(true)
  const sidebar = document.createElement('aside')
  sidebar.className = 'sidebar'
  sidebar.getBoundingClientRect = () => ({ top: 0, bottom: 150 }) as DOMRect
  const target = document.createElement('div')
  target.dataset.notebookDropId = 'work'
  sidebar.append(target)
  document.body.append(sidebar)
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => target })
  await h.down()
  await h.move(145)
  expect(sidebar.scrollTop).toBeGreaterThan(0)
  expect(h.list.scrollTop).toBe(0)
  await h.cancel()
  sidebar.remove()
  delete (document as unknown as { elementFromPoint?: unknown }).elementFromPoint
})
