// @vitest-environment jsdom
import { act, createRef } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import AppTooltip, { AppTooltipProvider, attachDomTooltip } from './AppTooltip'
import { hoverTooltip } from './tooltipTestUtils'

const mounted: { root: ReturnType<typeof createRoot>; host: HTMLElement }[] = []
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
afterEach(async () => {
  for (const { root, host } of mounted.splice(0)) {
    await act(() => root.unmount())
    host.remove()
  }
})
async function mount(element: React.ReactNode) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ root, host })
  await act(() => root.render(element))
  return { root, host }
}
const label = () => document.querySelector('.app-tooltip > .app-tooltip-label')?.textContent
const shortcut = () => document.querySelector('.app-tooltip > .app-tooltip-shortcut')?.textContent
it('keeps text hints delayed after an instant icon or another text hint', async () => {
  const { host } = await mount(
    <AppTooltipProvider>
      <AppTooltip instant label="Search">
        <button data-icon="" aria-label="Search">
          <svg />
        </button>
      </AppTooltip>
      <AppTooltip label="Full note title">
        <span data-title="">Note title</span>
      </AppTooltip>
      <AppTooltip label="New note">
        <button data-text="">
          <svg />
          <span>New note</span>
        </button>
      </AppTooltip>
    </AppTooltipProvider>,
  )
  vi.useFakeTimers()
  try {
    await hoverTooltip(host.querySelector('[data-icon]')!)
    expect(label()).toBe('Search')
    await act(() =>
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    )
    await hoverTooltip(host.querySelector('[data-title]')!)
    expect(label()).toBeUndefined()
    await act(() => vi.advanceTimersByTime(699))
    expect(label()).toBeUndefined()
    await act(() => vi.advanceTimersByTime(1))
    expect(label()).toBe('Full note title')
    await act(() =>
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    )
    await hoverTooltip(host.querySelector('[data-text]')!)
    expect(label()).toBeUndefined()
    await act(() => vi.advanceTimersByTime(700))
    expect(label()).toBe('New note')
  } finally {
    vi.useRealTimers()
  }
})
it('opens on the first pointer move with zero delay and renders a separate shortcut', async () => {
  const { host } = await mount(
    <AppTooltip instant label="Hide sidebar" shortcut="⌘⇧D">
      <button>Sidebar</button>
    </AppTooltip>,
  )
  vi.useFakeTimers()
  try {
    await hoverTooltip(host.querySelector('button')!)
    expect(label()).toBe('Hide sidebar')
    expect(shortcut()).toBe('⌘⇧D')
    expect(host.querySelector('[title]')).toBeNull()
    expect(host.querySelector('button')?.getAttribute('aria-describedby')).toBeTruthy()
  } finally {
    vi.useRealTimers()
  }
})
it('opens for keyboard focus, closes on Escape and activation, and preserves refs and handlers', async () => {
  const ref = createRef<HTMLButtonElement>(),
    activate = vi.fn()
  await mount(
    <AppTooltip label="Search">
      <button ref={ref} onClick={activate}>
        Search
      </button>
    </AppTooltip>,
  )
  await act(() => ref.current!.focus())
  expect(label()).toBe('Search')
  await act(() =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
  )
  expect(label()).toBeUndefined()
  expect(document.activeElement).toBe(ref.current)
  await hoverTooltip(ref.current!)
  await act(() => ref.current!.click())
  expect(activate).toHaveBeenCalledOnce()
  expect(label()).toBeUndefined()
})
it('shows disabled-control hints without making them clickable or focusable', async () => {
  const activate = vi.fn()
  const { host } = await mount(
    <AppTooltip instant label="Back" disabled>
      <button disabled onClick={activate}>
        Back
      </button>
    </AppTooltip>,
  )
  await hoverTooltip(host.querySelector('.app-tooltip-disabled')!)
  expect(label()).toBe('Back')
  expect(host.querySelector('.app-tooltip-disabled')?.hasAttribute('tabindex')).toBe(false)
  await act(() => host.querySelector('button')!.click())
  expect(activate).not.toHaveBeenCalled()
})
it('updates labels and shortcuts and omits unassigned bindings', async () => {
  const { host, root } = await mount(
    <AppTooltip instant label="Show sidebar" shortcut="Ctrl+D">
      <button>Sidebar</button>
    </AppTooltip>,
  )
  await hoverTooltip(host.querySelector('button')!)
  await act(() =>
    root.render(
      <AppTooltip instant label="Hide sidebar" shortcut="Ctrl+Alt+D">
        <button>Sidebar</button>
      </AppTooltip>,
    ),
  )
  expect(label()).toBe('Hide sidebar')
  expect(shortcut()).toBe('Ctrl+Alt+D')
  await act(() =>
    root.render(
      <AppTooltip instant label="Hide sidebar" shortcut="Unassigned">
        <button>Sidebar</button>
      </AppTooltip>,
    ),
  )
  expect(shortcut()).toBeUndefined()
})
it('does not open on touch hover or the focus caused by a touch tap', async () => {
  const { host } = await mount(
    <AppTooltip label="Search">
      <button>Search</button>
    </AppTooltip>,
  )
  const button = host.querySelector('button')!
  await hoverTooltip(button, 'touch')
  expect(label()).toBeUndefined()
  await act(() => {
    const event = new MouseEvent('pointerdown', { bubbles: true })
    Object.defineProperty(event, 'pointerType', { value: 'touch' })
    button.dispatchEvent(event)
    button.focus()
    button.click()
  })
  expect(label()).toBeUndefined()
})
it('keeps nested action hints ahead of row hints', async () => {
  const { host } = await mount(
    <AppTooltip label="Notebook path">
      <div>
        <AppTooltip instant label="New note">
          <button>New note</button>
        </AppTooltip>
      </div>
    </AppTooltip>,
  )
  await hoverTooltip(host.querySelector('button')!)
  expect(label()).toBe('New note')
  expect(document.querySelectorAll('.app-tooltip')).toHaveLength(1)
})
it('opens a group hint when its ordinary input receives keyboard focus', async () => {
  const { host } = await mount(
    <AppTooltip label="Notebook path">
      <label>
        Notebook
        <input type="radio" />
      </label>
    </AppTooltip>,
  )
  await act(() => host.querySelector('input')!.focus())
  expect(label()).toBe('Notebook path')
})
it('keeps popover hints inside their themed content rather than the outer positioning wrapper', async () => {
  const { host } = await mount(
    <div data-radix-popper-content-wrapper="">
      <div data-theme="dark" data-palette="catppuccin">
        <AppTooltip label="Settings">
          <button>Settings</button>
        </AppTooltip>
      </div>
    </div>,
  )
  await hoverTooltip(host.querySelector('button')!, 'mouse', 700)
  expect(document.querySelector('.app-tooltip')?.closest('[data-theme]')).toBe(
    host.querySelector('[data-theme]'),
  )
})
it('portals into the themed dialog and disappears when its trigger unmounts', async () => {
  const { host, root } = await mount(
    <div role="dialog" data-theme="dark">
      <AppTooltip instant label="New notebook">
        <button>New notebook</button>
      </AppTooltip>
    </div>,
  )
  await hoverTooltip(host.querySelector('button')!)
  expect(document.querySelector('.app-tooltip')?.closest('[role="dialog"]')).toBe(
    host.querySelector('[role="dialog"]'),
  )
  await act(() => root.render(null))
  expect(label()).toBeUndefined()
})
it('attaches DOM-created hints without changing their content and cleans up descriptions and listeners', async () => {
  const { host } = await mount(null)
  const target = document.createElement('span')
  target.textContent = 'Linked note'
  target.tabIndex = 0
  host.append(target)
  const adapter = attachDomTooltip(target)
  try {
    await act(() => adapter.update('Open note: Linked note'))
    await hoverTooltip(target, 'mouse', 700)
    expect(label()).toBe('Open note: Linked note')
    expect(target.textContent).toBe('Linked note')
    expect(target.getAttribute('aria-describedby')).toBeTruthy()
    await act(() => adapter.update('Open note: Renamed'))
    expect(label()).toBe('Open note: Renamed')
  } finally {
    await act(async () => adapter.destroy())
  }
  expect(label()).toBeUndefined()
  expect(target.hasAttribute('aria-describedby')).toBe(false)
  await hoverTooltip(target)
  expect(label()).toBeUndefined()
})
