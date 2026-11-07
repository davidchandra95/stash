// @vitest-environment jsdom
import { act, createRef, useRef, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { createPortal } from 'react-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  MotionPresence,
  animate,
  motion,
  useAnimatedItems,
  useMotionPreference,
  useReducedMotion,
} from './motion'
import { defaultAppearance } from './storage/library'
import Settings from './app/Settings'

let root: ReturnType<typeof createRoot>
let host: HTMLDivElement
let media: {
  matches: boolean
  addEventListener: ReturnType<typeof vi.fn>
  removeEventListener: ReturnType<typeof vi.fn>
}
let notify: () => void
let animations: { finish: () => void; cancel: ReturnType<typeof vi.fn> }[]
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  // Every query shares this object, so keep every listener (reduce motion, color scheme).
  const listeners = new Set<() => void>()
  notify = () => listeners.forEach((listener) => listener())
  media = {
    matches: false,
    addEventListener: vi.fn((_event, callback) => {
      listeners.add(callback)
    }),
    removeEventListener: vi.fn(),
  }
  vi.stubGlobal('matchMedia', () => media)
  animations = []
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  Element.prototype.animate = vi.fn(() => {
    let resolve!: () => void
    const finished = new Promise<void>((done) => {
      resolve = done
    })
    const entry = { finish: () => resolve(), cancel: vi.fn(() => resolve()) }
    animations.push(entry)
    return { finished, cancel: entry.cancel } as unknown as Animation
  })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
function Policy({ enabled, children }: { enabled: boolean; children?: ReactNode }) {
  const active = useMotionPreference(enabled)
  const reduced = useReducedMotion()
  return (
    <>
      <output>{`${active}:${reduced}`}</output>
      {children}
    </>
  )
}
it('applies the switch and live system preference to the document and portals', async () => {
  await act(() =>
    root.render(
      <Policy enabled>{createPortal(<div data-testid="portal" />, document.body)}</Policy>,
    ),
  )
  expect(document.documentElement.dataset.motion).toBe('on')
  expect(host.textContent).toBe('true:false')
  expect(document.querySelector('[data-testid="portal"]')?.closest('[data-motion]')).toBe(
    document.documentElement,
  )
  await act(() => {
    media.matches = true
    notify()
  })
  expect(host.textContent).toBe('false:true')
  expect(document.documentElement.dataset.motion).toBe('off')
  await act(() => root.render(<Policy enabled={false} />))
  await act(() => {
    media.matches = false
    notify()
  })
  expect(host.textContent).toBe('false:false')
  await act(() => root.render(<Policy enabled />))
  expect(host.textContent).toBe('true:false')
})
it('keeps closing content inert, reverses repeated toggles and settles immediately when disabled', async () => {
  const render = (open: boolean, enabled = true) =>
    act(() =>
      root.render(
        <Policy enabled={enabled}>
          <MotionPresence open={open} collapse initial={false}>
            <aside>
              <button>Inside</button>
            </aside>
          </MotionPresence>
        </Policy>,
      ),
    )
  await render(true)
  const original = host.querySelector('aside')
  await render(false)
  expect(host.querySelector('aside')).toBe(original)
  expect(original?.hasAttribute('inert')).toBe(true)
  expect(original?.getAttribute('aria-hidden')).toBe('true')
  const closing = animations.at(-1)!
  await render(true)
  expect(closing.cancel).toHaveBeenCalled()
  expect(host.querySelector('aside')).toBe(original)
  expect(original?.hasAttribute('inert')).toBe(false)
  await act(() => closing.finish())
  expect(host.querySelector('aside')).toBe(original)
  await render(false)
  await render(false, false)
  expect(host.querySelector('aside')).toBeNull()
})

it('preserves the child ref while present and clears it after the exit animation', async () => {
  const ref = createRef<HTMLElement>()
  const render = (open: boolean, mode = 'docked') =>
    act(() =>
      root.render(
        <Policy enabled>
          <MotionPresence open={open} initial={false}>
            <aside ref={ref} data-mode={mode} />
          </MotionPresence>
        </Policy>,
      ),
    )
  await render(true)
  const element = host.querySelector('aside')
  expect(ref.current).toBe(element)
  await render(true, 'overlay')
  expect(ref.current).toBe(element)
  await render(false)
  expect(ref.current).toBe(element)
  await act(() => animations.at(-1)!.finish())
  expect(ref.current).toBeNull()
})
it('cancels imperative motion and cleans up exactly once when Reduce Motion changes', async () => {
  await act(() => root.render(<Policy enabled />))
  const finish = vi.fn()
  animate(host, [{ opacity: 0 }, { opacity: 1 }], motion.menu, finish)
  await act(() => {
    media.matches = true
    notify()
  })
  expect(animations.at(-1)?.cancel).toHaveBeenCalledOnce()
  expect(finish).toHaveBeenCalledOnce()
})
it('offers a switch without rewriting saved cursor choices and explains system override', async () => {
  const onChange = vi.fn()
  const settings = {
    ...defaultAppearance,
    cursorBlinking: 'expand' as const,
    cursorSmoothCaretAnimation: 'on' as const,
  }
  await act(() =>
    root.render(
      <Policy enabled>
        <Settings
          open
          onOpenChange={() => {}}
          value={settings}
          onChange={onChange}
          onSync={() => {}}
        />
      </Policy>,
    ),
  )
  const toggle = () => document.querySelector<HTMLButtonElement>('[aria-label="Animations"]')!
  expect(toggle().getAttribute('role')).toBe('switch')
  expect(toggle().getAttribute('aria-checked')).toBe('true')
  expect(document.body.textContent).toContain('Panels, menus, and the writing cursor')
  await act(() => toggle().click())
  expect(onChange).toHaveBeenCalledWith({ ...settings, animationsEnabled: false })
  await act(() => {
    media.matches = true
    notify()
  })
  expect(document.body.textContent).toContain('Off while Reduce Motion is on in macOS')
  // The saved preference is still shown; Reduce Motion only overrides it.
  expect(toggle().getAttribute('aria-checked')).toBe('true')
})
it('animates explicit list changes, suppresses autosave and search, and removes exit copies', async () => {
  let request!: () => void
  function List({ ids, scope }: { ids: string[]; scope: string }) {
    const ref = useRef<HTMLDivElement>(null)
    request = useAnimatedItems(ref, '[data-motion-key]', scope, motion.row)
    return (
      <div ref={ref}>
        {ids.map((id) => (
          <button key={id} data-motion-key={id}>
            {id}
          </button>
        ))}
      </div>
    )
  }
  const render = (ids: string[], scope = 'all') =>
    act(() =>
      root.render(
        <Policy enabled>
          <List ids={ids} scope={scope} />
        </Policy>,
      ),
    )
  await render(['a', 'b'])
  expect(animations).toHaveLength(0)
  await render(['b', 'a'])
  expect(animations).toHaveLength(0)
  request()
  await render(['a', 'b'])
  expect(animations).toHaveLength(2)
  request()
  await render(['b'])
  expect(host.querySelector('[aria-hidden="true"]')?.hasAttribute('inert')).toBe(true)
  await act(() => animations.forEach((animation) => animation.finish()))
  expect(host.querySelector('[aria-hidden="true"]')).toBeNull()
  const count = animations.length
  await render([], 'search:no-match')
  expect(animations).toHaveLength(count)
})
it('removes a suspended Radix exit immediately when motion is disabled', async () => {
  const original = window.getComputedStyle.bind(window)
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
    const style = original(element, pseudo)
    if (element.matches('.settings, .dialog-overlay')) {
      Object.defineProperty(style, 'animationName', {
        configurable: true,
        get: () =>
          document.documentElement.dataset.motion === 'on'
            ? `panel-${element.getAttribute('data-state')}`
            : 'none',
      })
    }
    return style
  })
  const render = (open: boolean, enabled: boolean) =>
    act(() =>
      root.render(
        <Policy enabled={enabled}>
          <Settings
            open={open}
            onOpenChange={() => {}}
            value={defaultAppearance}
            onChange={() => {}}
            onSync={() => {}}
          />
        </Policy>,
      ),
    )
  await render(true, true)
  await render(false, true)
  expect(document.querySelector('.settings[data-state="closed"]')).not.toBeNull()
  expect(document.querySelector('.settings')?.hasAttribute('inert')).toBe(true)
  await render(false, false)
  expect(document.querySelector('.settings')).toBeNull()
  expect(document.querySelector('.dialog-overlay')).toBeNull()
})

it.each([
  {
    name: 'nearby visible rows',
    before: ['a', 'b', 'c'],
    after: ['c', 'a', 'b'],
    id: 'c',
    height: 200,
    count: 3,
  },
  {
    name: 'offscreen source',
    before: ['a', 'b', 'c', 'd'],
    after: ['d', 'a', 'b', 'c'],
    id: 'd',
    height: 150,
    count: 0,
  },
  {
    name: 'offscreen destination',
    before: ['a', 'b', 'c', 'd'],
    after: ['b', 'c', 'd', 'a'],
    id: 'a',
    height: 150,
    count: 0,
  },
  {
    name: 'long visible move',
    before: ['a', 'b', 'c', 'd', 'e', 'f'],
    after: ['f', 'a', 'b', 'c', 'd', 'e'],
    id: 'f',
    height: 400,
    count: 0,
  },
  {
    name: 'removal from Pinned notes',
    before: ['a', 'b'],
    after: ['b'],
    id: 'a',
    height: 200,
    count: 0,
  },
  {
    name: 'unchanged target position',
    before: ['a', 'b', 'c'],
    after: ['a', 'c', 'b'],
    id: 'a',
    height: 200,
    count: 0,
  },
])('limits pin motion to $name', async ({ before, after, id, height, count }) => {
  let request!: (id: string) => void
  function List({ ids }: { ids: string[] }) {
    const ref = useRef<HTMLDivElement>(null)
    request = useAnimatedItems(ref, '[data-motion-key]', 'all', motion.row, false, true)
    return (
      <div ref={ref} data-list>
        {ids.map((key) => (
          <button key={key} data-motion-key={key}>
            {key}
          </button>
        ))}
      </div>
    )
  }
  const rect = (top: number, height: number) => new DOMRect(0, top, 300, height)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(height)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.hasAttribute('data-list')) return rect(100, height)
    const index = [...this.parentElement!.children].indexOf(this)
    return rect(100 + index * 50, 50)
  })
  const render = (ids: string[], enabled = true) =>
    act(() =>
      root.render(
        <Policy enabled={enabled}>
          <List ids={ids} />
        </Policy>,
      ),
    )
  await render(before)
  request(id)
  await render(after)
  expect(animations).toHaveLength(count)
  expect(host.querySelector('[aria-hidden="true"]')).toBeNull()
  await render(after)
  // An unrelated save or menu render must let pin feedback complete.
  for (const animation of animations) expect(animation.cancel).not.toHaveBeenCalled()
  // Settings and the live system preference also apply to explicit pin motion.
  await render(before, false)
  request(id)
  await render(after, false)
  expect(animations).toHaveLength(count)
})
