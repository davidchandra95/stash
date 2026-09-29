// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { useShortcutActions } from './useShortcuts'
import type { ShortcutOverrides } from './shortcuts'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
it('dispatches once, applies changes immediately, and suspends in dialogs and during composition or repeats', async () => {
  const create = vi.fn()
  function Harness({ overrides = {} }: { overrides?: ShortcutOverrides }) {
    useShortcutActions({ 'new-note': create }, false, overrides)
    return <input aria-label="Text" />
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const press = (extra: KeyboardEventInit = {}) =>
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'n',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
        ...extra,
      }),
    )
  try {
    await act(() => root.render(<Harness />))
    press()
    expect(create).toHaveBeenCalledTimes(1)
    press({ repeat: true })
    press({ isComposing: true })
    press({ shiftKey: true })
    expect(create).toHaveBeenCalledTimes(1)
    await act(() => root.render(<Harness overrides={{ 'new-note': 'Mod+Alt+n' }} />))
    press()
    expect(create).toHaveBeenCalledTimes(1)
    press({ altKey: true })
    expect(create).toHaveBeenCalledTimes(2)
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    host.append(dialog)
    press({ altKey: true })
    expect(create).toHaveBeenCalledTimes(2)
    dialog.remove()
    await act(() => root.render(<Harness overrides={{ 'new-note': null }} />))
    press()
    press({ altKey: true })
    expect(create).toHaveBeenCalledTimes(2)
  } finally {
    await act(() => root.unmount())
    host.remove()
  }
})
