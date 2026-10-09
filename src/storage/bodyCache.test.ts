// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import {
  LibraryStore,
  type LibraryData,
  type Receipt,
  type SavedNote,
  type Transport,
} from './library'
import { clearSessions, getEditor } from '../editor/session'
import { retainEditorView } from '../editor/lifecycle'

const saved = (id: string, text = `Body ${id}`): SavedNote => ({
  id,
  title: id,
  notebookIds: [],
  quickAccess: false,
  tags: [],
  pinned: false,
  trashed: false,
  text,
  updated: 1,
  revision: 1,
  documentVersion: 1,
  content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
})
function fixture(options = { maximumNotes: 2, maximumBytes: 1024 * 1024 }) {
  const disk = ['a', 'b', 'c', 'd', 'e'].map((id) => saved(id))
  const native = {
    open: vi.fn(async (): Promise<LibraryData> => ({
      notes: disk.map(({ content: _, ...summary }) => summary),
      notebooks: [],
      appearance: null,
      preferencesRevision: 0,
      path: 'synthetic-cache-library',
    })),
    load: vi.fn(async (id: string) => disk.find((note) => note.id === id)!),
    saveNote: vi.fn(async (_input: Record<string, unknown>): Promise<Receipt> => ({
      revision: 2,
      updated: 2,
    })),
    savePreferences: vi.fn(async () => ({ revision: 1, updated: 2 })),
    quit: vi.fn(async () => {}),
  } satisfies Transport
  const store = new LibraryStore(native, options)
  return { native, store, disk }
}
afterEach(clearSessions)

it('evicts least-recently-used saved bodies, keeps summaries, and reloads correct content', async () => {
  const { native, store } = fixture()
  await store.open()
  await store.load('a')
  await store.load('b')
  await store.load('a')
  await store.load('c')
  await vi.waitFor(() => expect([...store.getSnapshot().loaded].sort()).toEqual(['a', 'c']))
  expect(store.getSnapshot().notes.find((note) => note.id === 'b')?.text).toBe('Body b')
  expect(store.getSnapshot().notes.find((note) => note.id === 'b')?.content).toEqual({
    type: 'doc',
    content: [{ type: 'paragraph' }],
  })
  await store.load('b')
  expect(native.load.mock.calls.filter(([id]) => id === 'b')).toHaveLength(2)
  expect(store.getSnapshot().notes.find((note) => note.id === 'b')?.content).toEqual(
    saved('b').content,
  )
})

it('never drops a failed save or its newer edits while other notes fill the cache', async () => {
  const { native, store } = fixture()
  await store.open()
  await store.load('a')
  native.saveNote.mockRejectedValueOnce(Error('disk full'))
  const changed = saved('a', 'unsaved draft')
  store.setNotes((notes) => notes.map((note) => (note.id === 'a' ? { ...note, ...changed } : note)))
  await expect(store.flush()).rejects.toThrow('disk full')
  for (const id of ['b', 'c', 'd']) await store.load(id)
  await vi.waitFor(() => expect(store.getSnapshot().loaded.size).toBeLessThanOrEqual(2))
  expect(store.getSnapshot().loaded.has('a')).toBe(true)
  expect(store.getSnapshot().notes.find((note) => note.id === 'a')?.content).toEqual(
    changed.content,
  )
  await store.flush()
  expect(native.saveNote.mock.calls[1]?.[0]).toBe(native.saveNote.mock.calls[0]?.[0])
})

it('protects mounted editors and both undo and redo state', async () => {
  const { store } = fixture({ maximumNotes: 1, maximumBytes: 1024 * 1024 })
  await store.open()
  await store.load('a')
  const editor = getEditor('a', saved('a').content!)
  const release = retainEditorView(editor)
  const unsubscribe = store.subscribe(() => {})
  try {
    await store.load('b')
    await vi.waitFor(() => expect(store.getSnapshot().loaded.size).toBe(2))
    release()
    await vi.waitFor(() => expect(store.getSnapshot().loaded.has('a')).toBe(false))
    await store.load('a')
    const edited = getEditor('a', saved('a').content!)
    edited.commands.insertContent('edit ')
    await store.load('c')
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(store.getSnapshot().loaded.has('a')).toBe(true)
    edited.commands.undo()
    await store.load('d')
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(store.getSnapshot().loaded.has('a')).toBe(true)
  } finally {
    release()
    unsubscribe()
  }
})

it('uses a byte budget as well as a count budget, with an oversized current note protected', async () => {
  const { store, disk } = fixture({ maximumNotes: 10, maximumBytes: 1000 })
  disk[0] = saved('a', 'x'.repeat(2000))
  await store.open()
  await store.load('a')
  await new Promise((resolve) => setTimeout(resolve, 25))
  expect(store.getSnapshot().loaded.has('a')).toBe(true)
  await store.load('b')
  await vi.waitFor(() => expect(store.getSnapshot().loaded.has('a')).toBe(false))
  expect(store.getSnapshot().loaded.has('b')).toBe(true)
})

it('keeps browser-preview bodies because they are the only copy', async () => {
  const store = new LibraryStore(null, { maximumNotes: 1, maximumBytes: 1 })
  const before = store.getSnapshot().notes.map((note) => note.content)
  for (const note of store.getSnapshot().notes) await store.load(note.id)
  await new Promise((resolve) => setTimeout(resolve, 25))
  expect(store.getSnapshot().notes.map((note) => note.content)).toEqual(before)
})

it('releases linked Markdown bodies and keeps metadata-only saves independent of unloaded content', async () => {
  const { native, store, disk } = fixture({ maximumNotes: 1, maximumBytes: 1024 * 1024 })
  disk[0] = {
    ...disk[0],
    source: {
      rootId: 'root',
      relativePath: 'a.md',
      fingerprint: 'one',
      markdown: '# Linked\n\nBody',
    },
  }
  disk[0].notebookIds = ['folder']
  native.open.mockImplementationOnce(async () => ({
    notes: disk.map(({ content: _, ...summary }) => summary),
    notebooks: [
      {
        id: 'folder',
        name: 'Folder',
        rootId: 'root',
        parentId: null,
        icon: 'folder',
        color: 'blue',
      },
    ],
    appearance: null,
    preferencesRevision: 0,
    path: 'synthetic-cache-library',
  }))
  await store.open()
  await store.load('a')
  await store.load('b')
  await vi.waitFor(() => expect(store.getSnapshot().loaded.has('a')).toBe(false))
  expect(store.getSnapshot().notes[0]?.source?.markdown).toBeUndefined()
  native.saveNote.mockResolvedValueOnce({
    revision: 2,
    updated: 2,
    note: {
      ...disk[0],
      revision: 2,
      source: { ...disk[0].source!, fingerprint: 'two', relativePath: 'Renamed.md' },
    },
  })
  store.setNotes((notes) =>
    notes.map((note) => (note.id === 'a' ? { ...note, title: 'Renamed' } : note)),
  )
  await store.flush()
  const input = native.saveNote.mock.calls[0]![0]
  expect(input.content).toBeUndefined()
  expect(input.markdown).toBeUndefined()
  expect(input.expectedFingerprint).toBe('one')
  expect(store.getSnapshot().notes[0]?.source?.markdown).toBeUndefined()
  expect(store.getSnapshot().notes[0]?.source?.fingerprint).toBe('two')
  expect(store.getSnapshot().loaded.has('a')).toBe(false)
})

it('discards a late linked-file read after a refresh and reloads the current generation', async () => {
  const { native, store, disk } = fixture()
  disk[0] = {
    ...disk[0],
    source: { rootId: 'root', relativePath: 'a.md', fingerprint: 'one', markdown: 'Old file' },
  }
  await store.open()
  let complete!: (note: SavedNote) => void
  native.load.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve
      }),
  )
  const old = disk[0]
  const read = store.load('a')
  disk[0] = {
    ...disk[0],
    revision: 2,
    source: { ...disk[0].source!, fingerprint: 'two', markdown: 'New file' },
  }
  Object.assign(native, {
    command: vi.fn(async () => ({
      notes: disk.map(({ content: _, ...summary }) => summary),
      notebooks: [],
      appearance: null,
      preferencesRevision: 0,
      path: 'synthetic-cache-library',
    })),
  })
  await store.folderAction('refresh_folder', {})
  complete(old)
  await read
  expect(native.load.mock.calls.filter(([id]) => id === 'a')).toHaveLength(2)
  expect(store.getSnapshot().notes[0]?.source?.fingerprint).toBe('two')
  expect(JSON.stringify(store.getSnapshot().notes[0]?.content)).toContain('New file')
})
