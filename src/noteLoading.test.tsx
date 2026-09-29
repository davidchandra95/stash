// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import App from './App'
import { clearSessions } from './editor/session'
import type { Note } from './model'
import type { LibraryState } from './storage/library'
import { library } from './storage/useLibrary'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
Element.prototype.scrollIntoView = vi.fn()

const note: Note = {
  id: 'opening-note',
  title: 'Loaded title',
  notebookIds: [],
  quickAccess: false,
  tags: [],
  pinned: false,
  trashed: false,
  updated: 1,
  text: 'Loaded note body',
  content: {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Loaded note body' }] }],
  },
}

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

const publish = (patch: Partial<LibraryState>) =>
  (
    library as unknown as {
      publish: (next: Partial<LibraryState>) => void
    }
  ).publish(patch)

async function mountUnloadedNote() {
  library.setNotes([note])
  library.setWorkspace({
    tabs: [{ id: 'opening-tab', noteId: note.id }],
    activeTabId: 'opening-tab',
  })
  publish({ loaded: new Set(), noteErrors: {} })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(<App />))
}

afterEach(async () => {
  if (root) await act(async () => root.unmount())
  host?.remove()
  library.setNotes([])
  library.setWorkspace({ tabs: [], activeTabId: null })
  publish({ loaded: new Set(), noteErrors: {} })
  clearSessions()
})

it('shows the Feather opening state until a selected note loads, then preserves retry errors', async () => {
  await mountUnloadedNote()

  const opening = host.querySelector<HTMLElement>('.note-opening')
  expect(opening).toBeTruthy()
  expect(opening?.getAttribute('role')).toBe('status')
  expect(opening?.textContent).toContain('Opening note…')
  expect(opening?.querySelector('.empty-symbol svg')).toBeTruthy()
  expect(host.querySelector('.breadcrumb')?.textContent).toContain('Loaded title')
  expect(host.querySelector('.note-opening-pane .note-kicker')?.textContent).toContain('1970')
  expect(host.querySelector('.note-title')).toBeNull()
  expect(host.querySelector('.ProseMirror')).toBeNull()

  await act(async () => publish({ loaded: new Set([note.id]), noteErrors: {} }))
  expect(host.querySelector('.note-opening')).toBeNull()
  expect(host.querySelector<HTMLInputElement>('.note-title')?.value).toBe('Loaded title')
  expect(host.querySelector('.ProseMirror')?.textContent).toContain('Loaded note body')

  await act(async () =>
    publish({ loaded: new Set(), noteErrors: { [note.id]: 'The note file is unavailable.' } }),
  )
  expect(host.querySelector('.note-opening')).toBeNull()
  expect(host.querySelector('.empty-editor h2')?.textContent).toBe('Could not open this note')
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    'The note file is unavailable.',
  )
  expect(host.querySelector<HTMLButtonElement>('.empty-editor button')?.textContent).toBe('Retry')
})
