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
let workspaceWidth = 800

function pointer(target: HTMLElement, type: string, x: number) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    button: { value: 0 },
    clientX: { value: x },
    pointerId: { value: 1 },
  })
  target.dispatchEvent(event)
}

function Fixture({
  savedWidth = 300,
  side = 'right',
  reserveWidth,
  onEscape,
  adaptive = false,
}: {
  savedWidth?: number
  side?: 'left' | 'right'
  reserveWidth?: (width: number) => number
  onEscape?: () => void
  adaptive?: boolean
}) {
  const workspaceRef = useRef<HTMLDivElement>(null)
  const resize = useContentsResize({
    workspaceRef,
    savedWidth,
    disabled: false,
    onCommit: commit,
    side,
    reserveWidth,
    adaptive,
  })
  return (
    <div
      ref={workspaceRef}
      className="editor-workspace"
      data-overlay={resize.overlay}
      style={resize.cssVariables}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onEscape?.()
      }}
    >
      <div {...resize.dividerProps} />
    </div>
  )
}

async function mount(props: Parameters<typeof Fixture>[0] = {}) {
  HTMLElement.prototype.getBoundingClientRect = function () {
    const width = this.classList.contains('editor-workspace') ? workspaceWidth : 0
    return { width, height: 500 } as DOMRect
  }
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(<Fixture {...props} />))
  return host.querySelector<HTMLElement>('.contents-resizer')!
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  host?.remove()
  root = undefined
  host = undefined
  commit = vi.fn()
  workspaceWidth = 800
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

it('widens left contents when dragging or pressing Right and cancels before bubbling Escape', async () => {
  const escaped = vi.fn()
  const handle = await mount({ side: 'left', onEscape: escaped })
  await act(async () => {
    pointer(handle, 'pointerdown', 300)
    pointer(handle, 'pointermove', 360)
    pointer(handle, 'pointerup', 360)
  })
  expect(commit).toHaveBeenCalledWith(360)
  expect(document.activeElement).toBe(handle)
  await act(async () => {
    handle.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }),
    )
  })
  expect(commit).toHaveBeenLastCalledWith(392)
  await act(async () => {
    pointer(handle, 'pointerdown', 392)
    pointer(handle, 'pointermove', 480)
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })
  expect(handle.getAttribute('aria-valuenow')).toBe('392')
  expect(escaped).not.toHaveBeenCalled()
  expect(commit).toHaveBeenCalledTimes(2)
})

it('leaves room for other docked panels without saving a temporary clamp', async () => {
  const handle = await mount({ side: 'left', savedWidth: 400, reserveWidth: () => 320 })
  expect(handle.getAttribute('aria-valuenow')).toBe('200')
  expect(handle.getAttribute('aria-valuemax')).toBe('200')
  expect(commit).not.toHaveBeenCalled()
  await act(async () => root!.render(<Fixture side="left" savedWidth={400} />))
  expect(handle.getAttribute('aria-valuenow')).toBe('400')
})

it('overlays only below the preferred width plus document minimum and restores the saved width', async () => {
  const handle = await mount({ savedWidth: 400, adaptive: true })
  const workspace = handle.parentElement!
  const resize = async (width: number) =>
    act(async () => {
      workspaceWidth = width
      window.dispatchEvent(new Event('resize'))
    })
  await resize(680)
  expect(workspace.dataset.overlay).toBe('false')
  expect(workspace.style.getPropertyValue('--contents-width')).toBe('400px')
  await resize(679)
  expect(workspace.dataset.overlay).toBe('true')
  expect(workspace.style.getPropertyValue('--contents-width')).toBe('400px')
  await resize(240)
  expect(workspace.style.getPropertyValue('--contents-width')).toBe('240px')
  await resize(800)
  expect(workspace.dataset.overlay).toBe('false')
  expect(workspace.style.getPropertyValue('--contents-width')).toBe('400px')
  expect(commit).not.toHaveBeenCalled()
})

it('cancels an active resize when the writing pane becomes too narrow to dock', async () => {
  const handle = await mount({ adaptive: true })
  await act(async () => {
    pointer(handle, 'pointerdown', 500)
    pointer(handle, 'pointermove', 450)
  })
  expect(handle.getAttribute('aria-valuenow')).toBe('350')
  await act(async () => {
    workspaceWidth = 500
    window.dispatchEvent(new Event('resize'))
  })
  expect(handle.parentElement!.dataset.overlay).toBe('true')
  expect(handle.getAttribute('aria-valuenow')).toBe('300')
  expect(commit).not.toHaveBeenCalled()
})
