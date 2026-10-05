// @vitest-environment jsdom
import { act, type ComponentProps } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import NoteTabs from './NoteTabs'
import { hoverTooltip, tooltipLabel } from './tooltipTestUtils'
import type { Note } from '../model'

const notes: Note[] = [
  {
    id: 'a',
    title: 'ALPHA',
    text: 'first body #garden',
    tags: ['garden'],
    notebookIds: ['one', 'extra'],
    quickAccess: false,
    updated: 1,
    trashed: false,
    pinned: true,
  },
  {
    id: 'b',
    title: 'Beta',
    text: 'alpha in unloaded body',
    tags: [],
    notebookIds: ['two'],
    quickAccess: false,
    updated: 3,
    trashed: false,
    pinned: false,
  },
  {
    id: 'c',
    title: 'Alpha deleted',
    text: '',
    tags: [],
    notebookIds: ['one'],
    quickAccess: false,
    updated: 9,
    trashed: true,
    pinned: false,
  },
].map((note) => ({
  ...note,
  content: {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: note.text || 'Empty' }] }],
  },
}))
const containers: { host: HTMLDivElement; root: ReturnType<typeof createRoot> }[] = []
afterEach(async () => {
  for (const { host, root } of containers.splice(0)) {
    await act(() => root.unmount())
    host.remove()
  }
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
async function mount(props: Partial<ComponentProps<typeof NoteTabs>> = {}) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  Element.prototype.scrollIntoView = vi.fn()
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  containers.push({ host, root })
  const defaults: ComponentProps<typeof NoteTabs> = {
    notes,
    tabs: [{ id: 'first', noteId: 'a' }],
    activeTabId: 'first',
    disabled: false,
    onSelectTab: vi.fn(),
    onCloseTab: vi.fn(),
    onKeepOpenTab: vi.fn(),
    ...props,
  }
  const render = (next: Partial<ComponentProps<typeof NoteTabs>> = {}) =>
    act(() => root.render(<NoteTabs {...defaults} {...next} />))
  await render()
  return { host, render, ...defaults }
}
const press = async (key: string, extra: KeyboardEventInit = {}, target: EventTarget = document) =>
  act(async () => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', {
        key,
        ctrlKey: key.length === 1,
        bubbles: true,
        cancelable: true,
        ...extra,
      }),
    )
  })
it('scrolls overflowing tabs with vertical wheel input, normalizes units, and clamps at both ends', async () => {
  const { host } = await mount({
    tabs: [{ id: 'first', noteId: 'a' }],
    activeTabId: 'first',
  })
  const strip = host.querySelector<HTMLElement>('.note-tabs')!
  Object.defineProperties(strip, {
    clientWidth: { value: 200 },
    scrollWidth: { value: 1000 },
  })
  strip.style.lineHeight = '18px'
  const wheel = (deltaY: number, extra: WheelEventInit = {}) => {
    const event = new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true, ...extra })
    // Exercise bubbling from a tab control, where the pointer usually rests.
    strip.querySelector('[role="tab"]')!.dispatchEvent(event)
    return event
  }
  expect(wheel(80).defaultPrevented).toBe(true)
  expect(strip.scrollLeft).toBe(80)
  wheel(-30)
  expect(strip.scrollLeft).toBe(50)
  wheel(2, { deltaMode: 1 })
  expect(strip.scrollLeft).toBe(86)
  wheel(1, { deltaMode: 2 })
  expect(strip.scrollLeft).toBe(286)
  wheel(10000)
  expect(strip.scrollLeft).toBe(800)
  wheel(-10000)
  expect(strip.scrollLeft).toBe(0)
  wheel(60, { deltaX: 2 })
  expect(strip.scrollLeft).toBe(60)
})

it('leaves horizontal input, zoom gestures, and non-overflowing tabs native', async () => {
  const { host } = await mount()
  const strip = host.querySelector<HTMLElement>('.note-tabs')!
  Object.defineProperties(strip, {
    clientWidth: { value: 200, configurable: true },
    scrollWidth: { value: 1000 },
  })
  for (const extra of [
    { deltaX: 80, deltaY: 2 },
    { deltaX: 80, deltaY: 0 },
    { ctrlKey: true },
    { metaKey: true },
    { altKey: true },
    { cancelable: false },
  ]) {
    const event = new WheelEvent('wheel', { deltaY: 40, cancelable: true, ...extra })
    strip.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(strip.scrollLeft).toBe(0)
  }
  Object.defineProperty(strip, 'clientWidth', { value: 1000 })
  const event = new WheelEvent('wheel', { deltaY: 40, cancelable: true })
  strip.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(false)
})

it('keeps preview actions and keyboard navigation working in the scrolling tab strip', async () => {
  const onSelectTab = vi.fn()
  const onKeepOpenTab = vi.fn()
  const onCloseTab = vi.fn()
  const { host } = await mount({
    tabs: [
      { id: 'first', noteId: 'a', preview: true },
      { id: 'second', noteId: 'b' },
    ],
    activeTabId: 'first',
    onSelectTab,
    onKeepOpenTab,
    onCloseTab,
  })
  const tabs = host.querySelectorAll<HTMLButtonElement>('[role="tab"]')
  await hoverTooltip(tabs[0], 'mouse', 700)
  expect(tooltipLabel()).toContain('Preview')
  expect(tabs[0].getAttribute('aria-selected')).toBe('true')
  expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({
    block: 'nearest',
    inline: 'nearest',
  })
  await press('Enter', {}, tabs[0])
  expect(onKeepOpenTab).toHaveBeenCalledWith('first')
  await press('ArrowRight', {}, tabs[0])
  expect(onSelectTab).toHaveBeenLastCalledWith('second')
  expect(document.activeElement).toBe(tabs[1])
  await press('Home', {}, tabs[1])
  expect(onSelectTab).toHaveBeenLastCalledWith('first')
  await press('End', {}, tabs[0])
  expect(onSelectTab).toHaveBeenLastCalledWith('second')
  await act(() => host.querySelector<HTMLButtonElement>('[aria-label="Close Beta"]')!.click())
  expect(onCloseTab).toHaveBeenCalledWith('second')
})

it('hides empty tabs and attaches scrolling when notes are reopened', async () => {
  const { host, render } = await mount({ tabs: [], activeTabId: null })
  expect(host.querySelector('[role="tablist"]')).toBeNull()
  for (let i = 0; i < 2; i++) {
    await render({ tabs: [{ id: 'first', noteId: 'a' }], activeTabId: 'first' })
    const strip = host.querySelector<HTMLElement>('[role="tablist"]')!
    expect(strip.hasAttribute('data-tauri-drag-region')).toBe(false)
    Object.defineProperties(strip, {
      clientWidth: { value: 100 },
      scrollWidth: { value: 400 },
    })
    strip.dispatchEvent(new WheelEvent('wheel', { deltaY: 40, cancelable: true }))
    expect(strip.scrollLeft).toBe(40)
    await render({ tabs: [], activeTabId: null })
    expect(host.querySelector('[role="tablist"]')).toBeNull()
  }
})

it('blocks tab actions and keyboard navigation while disabled', async () => {
  const { host, onSelectTab, onKeepOpenTab, onCloseTab } = await mount({
    disabled: true,
    tabs: [{ id: 'first', noteId: 'a', preview: true }],
  })
  const tab = host.querySelector<HTMLButtonElement>('[role="tab"]')!
  const close = host.querySelector<HTMLButtonElement>('.tab-close')!
  expect(tab.disabled).toBe(true)
  expect(close.disabled).toBe(true)
  await act(() => {
    tab.click()
    close.click()
    tab.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  })
  await press('Enter', {}, tab)
  await press('ArrowRight', {}, tab)
  expect(onSelectTab).not.toHaveBeenCalled()
  expect(onKeepOpenTab).not.toHaveBeenCalled()
  expect(onCloseTab).not.toHaveBeenCalled()
})

it('promotes a preview on double-click and keeps the selected tab visible after switching', async () => {
  const { host, render, onKeepOpenTab } = await mount({
    tabs: [
      { id: 'first', noteId: 'a', preview: true },
      { id: 'second', noteId: 'b' },
    ],
  })
  const tabs = host.querySelectorAll<HTMLButtonElement>('[role="tab"]')
  await act(() => tabs[0].dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
  expect(onKeepOpenTab).toHaveBeenCalledWith('first')
  const scroll = vi.spyOn(tabs[1].parentElement!, 'scrollIntoView')
  await render({ activeTabId: 'second' })
  expect(scroll).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' })
  expect(tabs[0].tabIndex).toBe(-1)
  expect(tabs[1].tabIndex).toBe(0)
})

it('returns focus to the remaining active tab after closing', async () => {
  let restoreFocus: FrameRequestCallback | undefined
  vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
    restoreFocus = callback
    return 1
  })
  const { host, render, onCloseTab } = await mount({
    tabs: [
      { id: 'first', noteId: 'a' },
      { id: 'second', noteId: 'b' },
    ],
    activeTabId: 'second',
  })
  await act(() => host.querySelector<HTMLButtonElement>('[aria-label="Close Beta"]')!.click())
  expect(onCloseTab).toHaveBeenCalledWith('second')
  await render({ tabs: [{ id: 'first', noteId: 'a' }], activeTabId: 'first' })
  await act(() => restoreFocus!(0))
  expect(document.activeElement).toBe(host.querySelector('[role="tab"]'))
})

it('keeps the active tab visible when its pane is resized and stops observing empty tabs', async () => {
  let resize: () => void = () => {}
  const observe = vi.fn(),
    disconnect = vi.fn()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback
      }
      observe = observe
      disconnect = disconnect
    },
  )
  const { host, render } = await mount()
  const strip = host.querySelector('.note-tabs')!
  expect(observe).toHaveBeenCalledWith(strip)
  const scroll = vi.spyOn(strip.querySelector('.active')!, 'scrollIntoView')
  scroll.mockClear()
  resize()
  expect(scroll).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' })
  await render({ tabs: [], activeTabId: null })
  expect(disconnect).toHaveBeenCalledOnce()
})
