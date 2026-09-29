// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { Pin } from '../icons'
import NativeNoteMenuButton from './NativeNoteMenuButton'
import { ShortcutContext } from '../useShortcuts'
const popup = vi.hoisted(() => vi.fn())
vi.mock('../nativeContextMenu', () => ({ showNativeContextMenu: popup }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
const onError = vi.fn()
const actions = [{ label: 'Pin', icon: Pin, shortcutId: 'pin', run: vi.fn() }]
async function mount(disabled = false) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () =>
    root.render(
      <ShortcutContext.Provider value={{ pin: 'Mod+Shift+p' }}>
        <NativeNoteMenuButton actions={actions} disabled={disabled} onError={onError} />
      </ShortcutContext.Provider>,
    ),
  )
  return host.querySelector('button')!
}
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.clearAllMocks()
})
it.each(['click', 'keyboard'])(
  'opens the native menu by %s and clears its open state on dismissal',
  async (input) => {
    let dismiss!: () => void
    popup.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          dismiss = resolve
        }),
    )
    const button = await mount()
    await act(async () => {
      if (input === 'click') button.click()
      else button.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    })
    expect(popup).toHaveBeenCalledTimes(1)
    const [items, launcher, point, binding] = popup.mock.calls[0]
    expect(items).toBe(actions)
    expect(launcher).toBe(button)
    expect(point).toEqual({ x: 0, y: 7 })
    expect(binding('pin')).toBe('Mod+Shift+p')
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(document.querySelector('[role="menu"]')).toBeNull()
    await act(async () => {
      button.click()
    })
    expect(popup).toHaveBeenCalledTimes(1)
    await act(async () => dismiss())
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(button)
  },
)
it('does not open when disabled', async () => {
  const button = await mount(true)
  await act(async () => button.click())
  expect(popup).not.toHaveBeenCalled()
})
it('reports native failures and clears the open state', async () => {
  popup.mockRejectedValueOnce(new Error('unavailable'))
  const button = await mount()
  await act(async () => button.click())
  expect(onError).toHaveBeenCalledWith({
    message: 'Could not open note actions: Error: unavailable',
    retry: expect.any(Function),
  })
  expect(button.getAttribute('aria-expanded')).toBe('false')
})
