// @vitest-environment jsdom
import { act, createRef } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import VirtualNoteRows, { type VirtualNoteRowsApi } from './VirtualNoteRows'
import NoteContextMenu from './NoteContextMenu'

const nativeMenu = vi.hoisted(() => vi.fn())
vi.mock('../nativeContextMenu', () => ({
  usesNativeContextMenu: () => true,
  showNativeContextMenu: nativeMenu,
}))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const items = Array.from({ length: 10_000 }, (_, index) => ({ id: `note-${index}` }))
let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let api: ReturnType<typeof createRef<VirtualNoteRowsApi>>
let scroll: HTMLDivElement
let closeMenu: (() => void) | undefined

async function mount(
  options: { mobile?: boolean; nativeMenu?: boolean; margin?: number; initialOffset?: number } = {},
) {
  host = document.createElement('div')
  document.body.append(host)
  scroll = document.createElement('div')
  host.append(scroll)
  for (const property of ['clientWidth', 'offsetWidth'])
    Object.defineProperty(scroll, property, { value: 300 })
  for (const property of ['clientHeight', 'offsetHeight'])
    Object.defineProperty(scroll, property, { value: 200 })
  Object.defineProperty(scroll, 'scrollHeight', { value: 540000 + (options.margin ?? 0) })
  const rect = (top: number, height: number) => ({
    top,
    bottom: top + height,
    left: 0,
    right: 300,
    width: 300,
    height,
    x: 0,
    y: top,
    toJSON() {},
  })
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return rect(
      this === scroll ? 100 : 100 + (options.margin ?? 0) - scroll.scrollTop,
      this === scroll ? 200 : 0,
    )
  })
  api = createRef<VirtualNoteRowsApi>()
  root = createRoot(scroll)
  await act(async () => {
    root.render(
      <VirtualNoteRows
        items={items}
        scrollRef={{ current: scroll }}
        apiRef={api}
        geometryKey="compact"
        estimatedSize={54}
        initialOffset={options.initialOffset}
        renderRow={(item, _index, { onMenuTrackingChange }) =>
          options.nativeMenu ? (
            <NoteContextMenu actions={[]} disabled={false} onTrackingChange={onMenuTrackingChange}>
              <button aria-label={item.id}>{item.id}</button>
            </NoteContextMenu>
          ) : (
            <>
              <button
                aria-label={item.id}
                onContextMenu={() => {
                  onMenuTrackingChange(true)
                  closeMenu = () => onMenuTrackingChange(false)
                }}
              >
                {item.id}
              </button>
              {options.mobile && <button aria-label={`Actions for ${item.id}`}>Actions</button>}
            </>
          )
        }
      />,
    )
  })
}
async function moveScroll(offset: number) {
  await act(async () => {
    scroll.scrollTop = offset
    scroll.dispatchEvent(new Event('scroll'))
  })
}
const rows = () => [...scroll.querySelectorAll<HTMLElement>('[role="listitem"]')]
const button = (id: string) =>
  scroll.querySelector<HTMLButtonElement>(`button[aria-label="${id}"]`)!
const tab = async (target: HTMLElement, shiftKey = false) => {
  await act(async () => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true }),
    )
  })
}
afterEach(async () => {
  if (root) await act(async () => root.unmount())
  host?.remove()
  closeMenu = undefined
  nativeMenu.mockReset()
  vi.restoreAllMocks()
})

it('bounds 10,000 rows and exposes full logical positions while scrolling to the final note', async () => {
  await mount()
  expect(rows().length).toBeLessThan(25)
  expect(rows()[0].getAttribute('aria-setsize')).toBe('10000')
  expect(scroll.querySelector<HTMLElement>('.virtual-note-rows')?.style.height).toBe('540000px')
  await moveScroll(539800)
  expect(button('note-9999')).toBeTruthy()
  expect(rows().at(-1)?.getAttribute('aria-posinset')).toBe('10000')
  expect(rows().length).toBeLessThan(25)
})

it('hit-tests logical content offsets, including a preceding mobile section', async () => {
  await mount({ margin: 80 })
  expect(api.current?.hitTest(120)).toBeUndefined()
  expect(api.current?.hitTest(190)).toBe('note-0')
  await moveScroll(54 * 500 + 80)
  expect(api.current?.hitTest(120)).toBe('note-500')
  expect(api.current?.hitTest(174)).toBe('note-501')
})

it('keeps a menu launcher mounted outside the window, then releases it on close', async () => {
  await mount()
  await act(async () =>
    button('note-0').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })),
  )
  await moveScroll(54 * 500)
  expect(button('note-0').isConnected).toBe(true)
  expect(button('note-500')).toBeTruthy()
  expect(rows().length).toBeLessThan(25)
  await act(async () => closeMenu?.())
  expect(button('note-0')).toBeNull()
})

it('retains a native menu launcher through asynchronous tracking and releases it after dismissal', async () => {
  let dismiss!: () => void
  nativeMenu.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        dismiss = resolve
      }),
  )
  await mount({ nativeMenu: true })
  const launcher = button('note-0')
  await act(async () =>
    launcher.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })),
  )
  expect(nativeMenu).toHaveBeenCalledOnce()
  await moveScroll(54 * 500)
  expect(launcher.isConnected).toBe(true)
  expect(launcher.dataset.state).toBe('open')
  await act(async () => dismiss())
  expect(launcher.isConnected).toBe(false)
  expect(button('note-500')).toBeTruthy()
})

it('tabs through the complete sequence beyond the initial virtual window in both directions', async () => {
  await mount()
  await act(async () => button('note-0').focus())
  for (let index = 0; index < 30; index++) await tab(button(`note-${index}`))
  expect(document.activeElement).toBe(button('note-30'))
  expect(scroll.scrollTop).toBeGreaterThan(0)
  await tab(button('note-30'), true)
  expect(document.activeElement).toBe(button('note-29'))
  expect(rows().length).toBeLessThan(25)
})

it('keeps both mobile controls in the row before advancing to the next logical note', async () => {
  await mount({ mobile: true })
  const first = button('note-0')
  const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
  first.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(false)
  const actions = button('Actions for note-0')
  await act(async () => actions.focus())
  await tab(actions)
  expect(document.activeElement).toBe(button('note-1'))
  await tab(button('note-1'), true)
  expect(document.activeElement).toBe(actions)
})

it('restores an offscreen mobile history offset before finding its notes', async () => {
  await mount({ initialOffset: 54 * 500 })
  expect(button('note-500')).toBeTruthy()
  expect(scroll.scrollTop).toBe(54 * 500)
  expect(rows().length).toBeLessThan(25)
})
