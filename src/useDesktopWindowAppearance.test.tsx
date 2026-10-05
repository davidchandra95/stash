// @vitest-environment jsdom
import { act, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const native = vi.hoisted(() => ({ enabled: true, invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke, isTauri: () => native.enabled }))
import { platform } from './platform'
import { useDesktopWindowAppearance } from './useDesktopWindowAppearance'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
function Surface({ ready = true, dark = true, palette = 'zen' }) {
  const ref = useRef<HTMLDivElement>(null)
  useDesktopWindowAppearance(ref, ready, dark, palette)
  return (
    <div
      ref={ref}
      style={{ '--surface-app': dark ? '#191d17' : '#e6e8df' } as React.CSSProperties}
    />
  )
}
beforeEach(() => {
  native.enabled = true
  platform.mobile = false
  native.invoke.mockReset().mockResolvedValue(undefined)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
})
it('waits for library readiness and native appearance before revealing the window', async () => {
  let finish!: () => void
  native.invoke.mockImplementation((command) =>
    command === 'set_window_appearance'
      ? new Promise<void>((resolve) => {
          finish = resolve
        })
      : Promise.resolve(),
  )
  await act(() => root.render(<Surface ready={false} />))
  expect(native.invoke).not.toHaveBeenCalled()
  await act(() => root.render(<Surface />))
  expect(native.invoke.mock.calls).toEqual([
    ['set_window_appearance', { dark: true, background: '#191d17' }],
  ])
  expect(document.documentElement.style.getPropertyValue('--desktop-window-background')).toBe(
    '#191d17',
  )
  await act(async () => finish())
  expect(native.invoke).toHaveBeenLastCalledWith('show_startup_window')
})
it('applies the current light palette on startup and later changes', async () => {
  await act(() => root.render(<Surface dark={false} />))
  expect(native.invoke).toHaveBeenCalledWith('set_window_appearance', {
    dark: false,
    background: '#e6e8df',
  })
  await act(() => root.render(<Surface dark={true} palette="aster" />))
  expect(native.invoke).toHaveBeenCalledWith('set_window_appearance', {
    dark: true,
    background: '#191d17',
  })
})
it('reveals a startup error surface even when native appearance fails', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  native.invoke.mockRejectedValueOnce(new Error('appearance unavailable'))
  await act(() => root.render(<Surface palette="startup-error" />))
  expect(native.invoke).toHaveBeenLastCalledWith('show_startup_window')
})
it('does not reveal a stale surface while its appearance command is pending', async () => {
  let finish!: () => void
  native.invoke.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  await act(() => root.render(<Surface />))
  await act(() => root.unmount())
  await act(async () => finish())
  expect(native.invoke).not.toHaveBeenCalledWith('show_startup_window')
  root = createRoot(host)
})
it('keeps browser and mobile startup free of native window commands', async () => {
  native.enabled = false
  await act(() => root.render(<Surface />))
  expect(native.invoke).not.toHaveBeenCalled()
  native.enabled = true
  platform.mobile = true
  await act(() => root.render(<Surface palette="aster" />))
  expect(native.invoke).not.toHaveBeenCalled()
  platform.mobile = false
})
