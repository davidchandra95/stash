// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import App from './App'
import NotebookTree from './components/NotebookTree'
import { library } from './storage/useLibrary'
import { defaultAppearance } from './storage/library'
import { clearSessions } from './editor/session'
import type { Note, Notebook } from './model'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
Element.prototype.scrollIntoView = vi.fn()
Range.prototype.getClientRects = () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () =>
  ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }) as DOMRect
const books: Notebook[] = [
  { id: 'work', name: 'Work', color: '', icon: 'notebook' },
  { id: 'personal', name: 'Personal', color: '', icon: 'notebook' },
  { id: 'chain', name: 'chain-gate', color: '', icon: 'notebook', parentId: 'work' },
]
const note: Note = {
  id: 'chain-note',
  title: 'Chain-gate',
  notebookIds: ['personal', 'work'],
  content: { type: 'doc', content: [{ type: 'paragraph' }] },
  text: '',
  tags: [],
  pinned: false,
  trashed: false,
  quickAccess: false,
  updated: 1,
}
let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
afterEach(async () => {
  await act(async () => root?.unmount())
  host?.remove()
  clearSessions()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete (document as unknown as { elementFromPoint?: unknown }).elementFromPoint
})
async function mount() {
  library.setAppearance({ ...defaultAppearance, animationsEnabled: false })
  library.setNotebooks(books)
  library.setNotes([note])
  library.setWorkspace({
    tabs: [{ id: 'tab', noteId: note.id }],
    activeTabId: 'tab',
    sidebarView: 'all',
  })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(<App />))
}
function pointer(type: string, x: number, y: number) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
  })
  Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'mouse' } })
  return event
}
async function drop() {
  vi.stubGlobal('CSS', { escape: (v: string) => v })
  let now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  const target = host.querySelector<HTMLElement>('[data-notebook-drop-id="chain"]')!
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => target })
  const row = host.querySelector<HTMLElement>(`[data-note-id="${note.id}"]`)!
  await act(async () => row.dispatchEvent(pointer('pointerdown', 300, 250)))
  now = 20
  await act(async () => window.dispatchEvent(pointer('pointermove', 100, 350)))
  expect(target.classList.contains('notebook-drop-target')).toBe(true)
  expect(host.querySelector('.note-drag-hint')?.textContent).toBeTruthy()
  await act(async () => window.dispatchEvent(pointer('pointerup', 100, 350)))
  expect(host.querySelector('.note-drag-ghost')).toBeNull()
  // Browsers generate a click after releasing the drag. It must not navigate.
  await act(async () => target.querySelector<HTMLButtonElement>('.nav-item')!.click())
}

it('moves Work membership into its child, keeps the current view/editor and supports Undo', async () => {
  await mount()
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[data-notebook-drop-id="work"] .nav-item')!.click(),
  )
  const before = library.getSnapshot().workspace
  await drop()
  expect(library.getSnapshot().notes[0].notebookIds).toEqual(['personal', 'chain'])
  expect(library.getSnapshot().notes).toHaveLength(1)
  expect(host.querySelector('.note-row[data-note-id="chain-note"]')).toBeNull()
  expect(
    host.querySelector('[data-notebook-drop-id="work"] .nav-item')?.getAttribute('aria-current'),
  ).toBe('page')
  expect(library.getSnapshot().workspace?.activeTabId).toBe(before?.activeTabId)
  expect(library.getSnapshot().workspace?.noteLists).toEqual(before?.noteLists)
  const undo = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Undo')!
  await act(async () => undo.click())
  expect(library.getSnapshot().notes[0].notebookIds).toEqual(['personal', 'work'])
})
it('asks for a source from All notes, cancels without changes, and moves after confirmation', async () => {
  await mount()
  await drop()
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    'Move from which notebook?',
  )
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Work / chain-gate')
  expect(document.querySelector('.move-notebooks-popover')).toBeTruthy()
  expect(document.querySelector('.dialog-overlay')).toBeNull()
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Move from Personal')
  expect(library.getSnapshot().notes[0].notebookIds).toEqual(['personal', 'work'])
  await act(async () =>
    [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
      .find((b) => b.textContent === 'Cancel')!
      .click(),
  )
  expect(library.getSnapshot().notes[0].notebookIds).toEqual(['personal', 'work'])
  await drop()
  await act(async () =>
    document.querySelector<HTMLInputElement>('[aria-label="Move from Work"]')!.click(),
  )
  await act(async () =>
    [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
      .find((b) => b.textContent === 'Move')!
      .click(),
  )
  expect(library.getSnapshot().notes[0].notebookIds).toEqual(['personal', 'chain'])
})
it('expands collapsed destinations after 600ms and cancels expansion when hover ends', async () => {
  vi.useFakeTimers()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const noop = () => {}
  const render = (hover = false) =>
    root.render(
      <NotebookTree
        books={books}
        active="all"
        dark={false}
        palette="classic"
        renderBook={(b) => <span>{b.name}</span>}
        createNote={noop}
        edit={noop}
        deleteNotebook={noop}
        createChild={noop}
        refresh={noop}
        reselect={noop}
        dropTarget={hover ? { id: 'work', allowed: true, hint: 'Move' } : null}
      />,
    )
  await act(async () => render())
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="Collapse Work"]')!.click(),
  )
  await act(async () => render(true))
  await act(async () => vi.advanceTimersByTime(599))
  expect(host.querySelector('[data-notebook-drop-id="chain"]')).toBeNull()
  await act(async () => render(false))
  await act(async () => vi.advanceTimersByTime(1000))
  expect(host.querySelector('[data-notebook-drop-id="chain"]')).toBeNull()
  await act(async () => render(true))
  await act(async () => vi.advanceTimersByTime(600))
  expect(host.querySelector('[data-notebook-drop-id="chain"]')).not.toBeNull()
})
