// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import App from './App'
import { library } from './storage/useLibrary'
import * as readers from './storage/libraryReaders'
import * as ordering from './noteOrder'
import { clearSessions, getEditor, resetSession } from './editor/session'
import type { Note } from './model'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
Element.prototype.scrollIntoView = vi.fn()
Range.prototype.getClientRects = () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () => new DOMRect()
window.scrollBy = vi.fn()
let root: ReturnType<typeof createRoot>
let host: HTMLDivElement
const original = library.getSnapshot()
const publish = (patch: object) =>
  (library as unknown as { publish: (patch: object) => void }).publish(patch)
const makeNote = (id: string, updated: number, text = 'Plain body'): Note => ({
  id,
  updated,
  title: id,
  notebookIds: [],
  tags: [],
  pinned: false,
  quickAccess: false,
  trashed: false,
  text,
  content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
})
async function mount() {
  const now = Date.now()
  publish({
    ...original,
    notes: [makeNote('active', now), makeNote('other', now - 1000)],
    loaded: new Set(['active', 'other']),
    ready: true,
    preview: false,
    status: 'saved',
    error: '',
    syncError: '',
    quitFailed: false,
    notebooks: [],
    appearance: { ...original.appearance, animationsEnabled: false },
    workspace: {
      tabs: [{ id: 'tab', noteId: 'active' }],
      activeTabId: 'tab',
      noteListMode: 'preview',
    },
  })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(<App />))
  return getEditor('active', library.getSnapshot().notes[0].content)
}
afterEach(async () => {
  if (root) await act(async () => root.unmount())
  host?.remove()
  clearSessions()
  vi.restoreAllMocks()
  Object.assign(library as unknown as { state: typeof original }, { state: original })
})
it('keeps the shell quiet for save feedback, caret moves, and ordinary body edits while live readers update', async () => {
  const editor = await mount()
  const shell = vi.spyOn(readers, 'useLibraryShell')
  const sorts = vi.spyOn(ordering, 'sortNotes')
  await act(async () => publish({ status: 'saving' }))
  expect(host.querySelector('.save-status')?.textContent).toContain('Saving')
  await act(async () => publish({ status: 'saved' }))
  expect(host.querySelector('.save-status')?.textContent).toContain('Saved on this Mac')
  await act(async () => editor.commands.setTextSelection(3))
  expect(shell).not.toHaveBeenCalled()
  expect(sorts).not.toHaveBeenCalled()
  // Prime Undo before measuring plain typing so capability changes are excluded.
  await act(async () => editor.commands.insertContent('x'))
  shell.mockClear()
  sorts.mockClear()
  const view = editor.view
  const before = library.getSnapshot().notes[0].text.length
  await act(async () => editor.commands.insertContent(' fresh'))
  expect(shell).not.toHaveBeenCalled()
  expect(sorts).not.toHaveBeenCalled()
  expect(editor.view).toBe(view)
  expect(host.querySelector('[data-note-id="active"] .note-list-preview')?.textContent).toContain(
    'fresh',
  )
  expect(host.querySelector('.editor-status')?.textContent).toContain(`${before + 6} characters`)
  await act(async () => editor.commands.undo())
  expect(library.getSnapshot().notes[0].text).not.toContain('fresh')
})
it('updates formatting and context controls, and displays a genuine external replacement', async () => {
  const editor = await mount()
  await act(async () => editor.commands.setTextSelection({ from: 1, to: 6 }))
  await act(async () => editor.commands.toggleBold())
  expect(host.querySelector('[aria-label="Bold"]')?.getAttribute('aria-pressed')).toBe('true')
  await act(async () => editor.commands.setTextSelection(10))
  expect(host.querySelector('[aria-label="Bold"]')?.getAttribute('aria-pressed')).toBe('false')
  await act(async () => editor.commands.toggleCodeBlock({ language: 'typescript' }))
  expect(host.querySelector<HTMLSelectElement>('[aria-label="Code language"]')?.value).toBe(
    'typescript',
  )
  const replacement = makeNote('active', Date.now(), 'External replacement')
  resetSession('active')
  await act(async () => publish({ notes: [replacement, library.getSnapshot().notes[1]] }))
  expect(host.querySelector('.tiptap')?.textContent).toBe('External replacement')
  expect(getEditor('active', replacement.content)).not.toBe(editor)
})
it('keeps failed-save recovery and quit actions visible without rendering the shell', async () => {
  await mount()
  const shell = vi.spyOn(readers, 'useLibraryShell')
  await act(async () => publish({ error: 'Disk full', status: 'error', quitFailed: true }))
  expect(host.querySelector('.save-error')?.textContent).toContain('Disk full')
  expect(host.querySelector('.save-error')?.textContent).toContain('Retry and quit')
  expect(host.querySelector('.save-error')?.textContent).toContain('Keep editing')
  expect(shell).not.toHaveBeenCalled()
  await act(async () => publish({ error: '', quitFailed: false, syncError: 'Sync failed' }))
  expect(host.querySelector('.save-error')?.textContent).toContain('Couldn’t sync')
})
