// @vitest-environment jsdom
import { act, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import type { PaneWidths } from './paneLayout'
import { usePaneResize } from './usePaneResize'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let host: HTMLDivElement | undefined
let root: ReturnType<typeof createRoot> | undefined
let commits = vi.fn()
const originalRect = HTMLElement.prototype.getBoundingClientRect

function widthFromStyle(app: HTMLElement | null, name: string, fallback: number) {
  return Number.parseInt(app?.style.getPropertyValue(name) || '', 10) || fallback
}

function rect(width: number): DOMRect {
  return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: 800, width, height: 800 } as DOMRect
}

function pointer(target: HTMLElement, type: string, clientX: number, pointerId = 1) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    button: { value: 0 },
    clientX: { value: clientX },
    pointerId: { value: pointerId },
  })
  target.dispatchEvent(event)
}

function Fixture({
  noteListVisible = true,
  savedWidths,
}: {
  noteListVisible?: boolean
  savedWidths?: PaneWidths
}) {
  const appRef = useRef<HTMLDivElement>(null)
  const panes = usePaneResize({
    appRef,
    savedWidths,
    sidebarVisible: true,
    noteListVisible,
    contentsOpen: false,
    disabled: false,
    onCommit: commits,
  })
  return (
    <div
      className={`app ${panes.resizing ? 'is-resizing' : ''}`}
      ref={appRef}
      style={panes.cssVariables}
    >
      <aside className="sidebar" />
      <section className="note-list" />
      <div {...panes.dividerProps('sidebar')} />
      {noteListVisible && <div {...panes.dividerProps('noteList')} />}
    </div>
  )
}

async function mount() {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(<Fixture />))
  return host
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  host?.remove()
  host = undefined
  root = undefined
  commits = vi.fn()
  HTMLElement.prototype.getBoundingClientRect = originalRect
})

it('resizes a pane with the pointer and saves only after release', async () => {
  HTMLElement.prototype.getBoundingClientRect = function () {
    const app = this.classList.contains('app') ? this : this.closest<HTMLElement>('.app')
    if (this.classList.contains('app')) return rect(1320)
    if (this.classList.contains('sidebar'))
      return rect(widthFromStyle(app, '--sidebar-override', 208))
    if (this.classList.contains('note-list'))
      return rect(widthFromStyle(app, '--list-override', 272))
    return rect(0)
  }
  const mounted = await mount()
  const sidebar = mounted.querySelector<HTMLElement>('.pane-resizer--sidebar')!

  await act(async () => {
    pointer(sidebar, 'pointerdown', 208)
    pointer(sidebar, 'pointermove', 258)
    expect(commits).not.toHaveBeenCalled()
    pointer(sidebar, 'pointerup', 258)
  })

  expect(commits).toHaveBeenCalledWith({ sidebar: 258, noteList: 272 })
  expect(
    mounted.querySelector<HTMLElement>('.app')!.style.getPropertyValue('--sidebar-override'),
  ).toBe('258px')
})

it('rounds device-scaled pointer positions before persisting them', async () => {
  HTMLElement.prototype.getBoundingClientRect = function () {
    const app = this.classList.contains('app') ? this : this.closest<HTMLElement>('.app')
    if (this.classList.contains('app')) return rect(1320)
    if (this.classList.contains('sidebar'))
      return rect(widthFromStyle(app, '--sidebar-override', 208))
    if (this.classList.contains('note-list'))
      return rect(widthFromStyle(app, '--list-override', 272))
    return rect(0)
  }
  const mounted = await mount()
  const sidebar = mounted.querySelector<HTMLElement>('.pane-resizer--sidebar')!

  await act(async () => {
    pointer(sidebar, 'pointerdown', 208)
    pointer(sidebar, 'pointermove', 253.8333)
    pointer(sidebar, 'pointerup', 253.8333)
  })

  expect(commits).toHaveBeenCalledWith({ sidebar: 254, noteList: 272 })
})

it('resizes the Notes pane with the pointer and saves on release', async () => {
  HTMLElement.prototype.getBoundingClientRect = function () {
    const app = this.classList.contains('app') ? this : this.closest<HTMLElement>('.app')
    if (this.classList.contains('app')) return rect(1320)
    if (this.classList.contains('sidebar'))
      return rect(widthFromStyle(app, '--sidebar-override', 208))
    if (this.classList.contains('note-list'))
      return rect(widthFromStyle(app, '--list-override', 272))
    return rect(0)
  }
  const mounted = await mount()
  const notes = mounted.querySelector<HTMLElement>('.pane-resizer--noteList')!

  await act(async () => {
    pointer(notes, 'pointerdown', 480)
    pointer(notes, 'pointermove', 520)
    expect(commits).not.toHaveBeenCalled()
    pointer(notes, 'pointerup', 520)
  })

  expect(commits).toHaveBeenCalledWith({ sidebar: 208, noteList: 312 })
})

it('cancels pointer resizing with Escape and supports keyboard resizing', async () => {
  HTMLElement.prototype.getBoundingClientRect = function () {
    const app = this.classList.contains('app') ? this : this.closest<HTMLElement>('.app')
    if (this.classList.contains('app')) return rect(1320)
    if (this.classList.contains('sidebar'))
      return rect(widthFromStyle(app, '--sidebar-override', 208))
    if (this.classList.contains('note-list'))
      return rect(widthFromStyle(app, '--list-override', 272))
    return rect(0)
  }
  const mounted = await mount()
  const sidebar = mounted.querySelector<HTMLElement>('.pane-resizer--sidebar')!
  const notes = mounted.querySelector<HTMLElement>('.pane-resizer--noteList')!

  await act(async () => {
    pointer(sidebar, 'pointerdown', 208)
    pointer(sidebar, 'pointermove', 258)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  })

  expect(commits).not.toHaveBeenCalled()
  expect(
    mounted.querySelector<HTMLElement>('.app')!.style.getPropertyValue('--sidebar-override'),
  ).toBe('')

  await act(async () =>
    notes.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })),
  )

  expect(commits).toHaveBeenCalledWith({ sidebar: 208, noteList: 280 })
  expect(notes.getAttribute('aria-valuenow')).toBe('280')

  await act(async () =>
    sidebar.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })),
  )

  expect(commits).toHaveBeenLastCalledWith({ sidebar: 216, noteList: 280 })
})

it('does not persist a cancelled Notes pane drag', async () => {
  HTMLElement.prototype.getBoundingClientRect = function () {
    const app = this.classList.contains('app') ? this : this.closest<HTMLElement>('.app')
    if (this.classList.contains('app')) return rect(1320)
    if (this.classList.contains('sidebar'))
      return rect(widthFromStyle(app, '--sidebar-override', 208))
    if (this.classList.contains('note-list'))
      return rect(widthFromStyle(app, '--list-override', 272))
    return rect(0)
  }
  const mounted = await mount()
  const notes = mounted.querySelector<HTMLElement>('.pane-resizer--noteList')!

  await act(async () => {
    pointer(notes, 'pointerdown', 480)
    pointer(notes, 'pointermove', 520)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  })

  expect(commits).not.toHaveBeenCalled()
  expect(
    mounted.querySelector<HTMLElement>('.app')!.style.getPropertyValue('--list-override'),
  ).toBe('')
})

it.each(['pointer', 'keyboard'])(
  'resizes navigation with Notes hidden by %s without replacing its saved width',
  async (method) => {
    HTMLElement.prototype.getBoundingClientRect = function () {
      if (this.classList.contains('app')) return rect(900)
      if (this.classList.contains('sidebar')) return rect(208)
      return rect(0)
    }
    await mount()
    await act(() =>
      root!.render(
        <Fixture noteListVisible={false} savedWidths={{ sidebar: 208, noteList: 600 }} />,
      ),
    )
    const sidebar = host!.querySelector<HTMLElement>('.pane-resizer--sidebar')!
    expect(sidebar.getAttribute('aria-valuemax')).toBe('540')
    expect(host!.querySelector('.pane-resizer--noteList')).toBeNull()
    await act(() => {
      if (method === 'pointer') {
        pointer(sidebar, 'pointerdown', 208)
        pointer(sidebar, 'pointermove', 216)
        pointer(sidebar, 'pointerup', 216)
      } else
        sidebar.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    expect(commits).toHaveBeenLastCalledWith({ sidebar: 216, noteList: 600 })
    await act(() =>
      root!.render(<Fixture noteListVisible savedWidths={commits.mock.calls.at(-1)![0]} />),
    )
    expect(host!.querySelector('.pane-resizer--noteList')).not.toBeNull()
    expect(
      host!.querySelector<HTMLElement>('.app')!.style.getPropertyValue('--list-override'),
    ).toBe('396px')
  },
)
