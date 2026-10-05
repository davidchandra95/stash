// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import { focusDocument, useShortcutActions } from '../useShortcuts'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

it('blocks keyboard and native history commands to a stale editor while the PDF owns focus', async () => {
  function Harness() {
    useShortcutActions({})
    return (
      <div contentEditable suppressContentEditableWarning>
        Draft
      </div>
    )
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(() => root.render(<Harness />))
    const staleEditor = host.firstElementChild!
    focusDocument('pdf')
    for (const inputType of ['historyUndo', 'historyRedo']) {
      const event = new InputEvent('beforeinput', { inputType, bubbles: true, cancelable: true })
      staleEditor.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
    }
    for (const [key, shiftKey] of [
      ['z', false],
      ['z', true],
      ['y', false],
      ['b', false],
    ] as const) {
      const event = new KeyboardEvent('keydown', {
        key,
        shiftKey,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      })
      staleEditor.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
    }
    focusDocument('note')
    const normalUndo = new InputEvent('beforeinput', {
      inputType: 'historyUndo',
      bubbles: true,
      cancelable: true,
    })
    staleEditor.dispatchEvent(normalUndo)
    expect(normalUndo.defaultPrevented).toBe(false)
    focusDocument('pdf')
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    host.append(dialog)
    const dialogUndo = new InputEvent('beforeinput', {
      inputType: 'historyUndo',
      bubbles: true,
      cancelable: true,
    })
    dialog.dispatchEvent(dialogUndo)
    expect(dialogUndo.defaultPrevented).toBe(false)
    dialog.remove()
  } finally {
    focusDocument('note')
    await act(() => root.unmount())
    host.remove()
  }
})

it('unregisters inactive readers so they cannot consume another document shortcut', async () => {
  const calls: string[] = []
  function Reader({ name, active }: { name: string; active: boolean }) {
    useShortcutActions({ find: () => calls.push(name) }, false, undefined, active)
    return null
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const find = () =>
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'f',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    )
  try {
    await act(() =>
      root.render(
        <>
          <Reader name="first" active={false} />
          <Reader name="second" active />
        </>,
      ),
    )
    find()
    expect(calls).toEqual(['second'])
    await act(() =>
      root.render(
        <>
          <Reader name="first" active />
          <Reader name="second" active={false} />
        </>,
      ),
    )
    find()
    expect(calls).toEqual(['second', 'first'])
  } finally {
    await act(() => root.unmount())
    host.remove()
  }
})
