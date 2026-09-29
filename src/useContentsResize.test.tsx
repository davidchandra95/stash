// @vitest-environment jsdom
import { act, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { useContentsResize } from './useContentsResize'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let host: HTMLDivElement | undefined
let root: ReturnType<typeof createRoot> | undefined
let commit = vi.fn()
const originalRect = HTMLElement.prototype.getBoundingClientRect

function pointer(target: HTMLElement, type: string, x: number) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    button: { value: 0 },
    clientX: { value: x },
    pointerId: { value: 1 },
  })
  target.dispatchEvent(event)
}

function Fixture({ savedWidth = 300 }: { savedWidth?: number }) {
  const workspaceRef = useRef<HTMLDivElement>(null)
  const resize = useContentsResize({
    workspaceRef,
    savedWidth,
    disabled: false,
    onCommit: commit,
  })
  return (
    <div ref={workspaceRef} className="editor-workspace" style={resize.cssVariables}>
      <div {...resize.dividerProps} />
    </div>
  )
}

async function mount() {
  HTMLElement.prototype.getBoundingClientRect = function () {
    const width = this.classList.contains('editor-workspace') ? 800 : 0
    return { width, height: 500 } as DOMRect
  }
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(<Fixture />))
  return host.querySelector<HTMLElement>('.contents-resizer')!
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  host?.remove()
  root = undefined
  host = undefined
  commit = vi.fn()
  HTMLElement.prototype.getBoundingClientRect = originalRect
})

it('resizes by dragging left and saves the width on release', async () => {
  const handle = await mount()
  await act(async () => {
    pointer(handle, 'pointerdown', 500)
    pointer(handle, 'pointermove', 440)
    expect(commit).not.toHaveBeenCalled()
    pointer(handle, 'pointerup', 440)
  })
  expect(commit).toHaveBeenCalledWith(360)
  expect(handle.parentElement?.style.getPropertyValue('--contents-width')).toBe('360px')
})

it('supports keyboard resizing and cancels a drag with Escape', async () => {
  const handle = await mount()
  await act(async () => {
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
  })
  expect(commit).toHaveBeenCalledWith(308)
  await act(async () => {
    pointer(handle, 'pointerdown', 500)
    pointer(handle, 'pointermove', 400)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })
  expect(handle.parentElement?.style.getPropertyValue('--contents-width')).toBe('308px')
  expect(commit).toHaveBeenCalledTimes(1)
})
