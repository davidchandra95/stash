// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import App from './App'
import { library } from './storage/useLibrary'
import * as readers from './storage/libraryReaders'
import { settleDelayMs, useSettledNote } from './storage/settled'
import { useBacklinks } from './storage/backlinks'
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
  expect(host.querySelector('.note-save-status')).toBeNull()
  await act(async () => publish({ status: 'saved' }))
  expect(host.querySelector('.note-save-status')).toBeNull()
  await act(async () => editor.commands.setTextSelection(3))
  expect(shell).not.toHaveBeenCalled()
  expect(sorts).not.toHaveBeenCalled()
  // Prime Undo before measuring plain typing so capability changes are excluded.
  await act(async () => editor.commands.insertContent('x'))
  shell.mockClear()
  sorts.mockClear()
  const view = editor.view
  const words = (text: string) => text.trim().split(/\s+/).length
  const before = words(library.getSnapshot().notes[0].text)
  expect(host.querySelector('.note-meta')?.textContent).toContain(`${before} words`)
  await act(async () => editor.commands.insertContent(' fresh'))
  expect(shell).not.toHaveBeenCalled()
  expect(sorts).not.toHaveBeenCalled()
  expect(editor.view).toBe(view)
  // The note row and word count follow once typing pauses.
  const rowPreview = () =>
    host.querySelector('[data-note-id="active"] .note-row-preview')?.textContent
  expect(rowPreview()).not.toContain('fresh')
  expect(host.querySelector('.note-meta')?.textContent).toContain(`${before} words`)
  await act(
    () =>
      new Promise((resolve) =>
        setTimeout(resolve, Math.max(readers.statisticsDelayMs, settleDelayMs) + 50),
      ),
  )
  expect(rowPreview()).toContain('fresh')
  expect(host.querySelector('.note-meta')?.textContent).toContain(`${before + 1} words`)
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
  const notice = () => host.querySelector('.notices .notice[role="alert"]')?.textContent
  expect(notice()).toContain('Disk full')
  expect(notice()).toContain('Retry and quit')
  expect(notice()).toContain('Keep editing')
  expect(shell).not.toHaveBeenCalled()
  await act(async () => publish({ error: '', quitFailed: false, syncError: 'Sync failed' }))
  expect(notice()).toContain('Couldn’t sync')
})
it('re-renders editor surfaces for outside changes but not for the editor’s own typing', async () => {
  const editor = await mount()
  const before = library.getSnapshot().notes[0]
  await act(async () => editor.commands.insertContent(' typed'))
  const typed = library.getSnapshot().notes[0]
  expect(typed.content).not.toBe(before.content)
  expect(readers.sameEditorNote(before, typed)).toBe(true)
  expect(readers.sameEditorNote(typed, { ...typed, title: 'Renamed' })).toBe(false)
  expect(readers.sameEditorNote(typed, { ...typed, trashed: true })).toBe(false)
  // Loaded, synced, or replaced content is not the editor's own and must be shown.
  const external = makeNote('active', Date.now(), 'From disk')
  expect(readers.sameEditorNote(typed, { ...typed, content: external.content })).toBe(false)
})
it('lets panels follow typing after a pause, and other changes at once', async () => {
  const editor = await mount()
  const backlinks = vi.spyOn(library, 'backlinks').mockResolvedValue({ ids: [], unreadable: 0 })
  let renders = 0
  function Panel() {
    renders++
    const note = useSettledNote('active')
    useBacklinks('active')
    return <output className="panel">{`${note?.title}|${note?.text}`}</output>
  }
  const panelHost = document.createElement('div')
  const panelRoot = createRoot(panelHost)
  try {
    await act(async () => panelRoot.render(<Panel />))
    const searches = backlinks.mock.calls.length
    renders = 0
    for (const key of ['a', 'b', 'c']) await act(async () => editor.commands.insertContent(key))
    expect(renders).toBe(0)
    expect(panelHost.textContent).not.toContain('abc')
    await act(() => new Promise((resolve) => setTimeout(resolve, settleDelayMs + 50)))
    expect(panelHost.textContent).toContain('abc')
    // One render for the settled values, and one when the new backlinks search answers.
    expect(renders).toBe(2)
    // One search for the settled notes, not one per keystroke.
    expect(backlinks.mock.calls.length).toBe(searches + 1)
    const note = library.getSnapshot().notes[0]
    await act(async () =>
      publish({ notes: [{ ...note, title: 'Renamed' }, ...library.getSnapshot().notes.slice(1)] }),
    )
    expect(panelHost.textContent).toContain('Renamed|')
  } finally {
    await act(async () => panelRoot.unmount())
  }
})
