// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { LibraryStore, type LibraryData, type SavedNote, type Transport } from './library'
import type { Note } from '../model'

const original: Note = {
  id: 'synthetic-search-note',
  title: 'Fictional file',
  text: 'old text',
  updated: 1,
  tags: [],
  notebookIds: [],
  quickAccess: false,
  pinned: false,
  trashed: false,
  content: {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'old text' }] }],
  },
  source: { rootId: 'synthetic-root', relativePath: 'fictional.md', fingerprint: 'old' },
}
function fixture(load: Transport['load']) {
  const transport: Transport = {
    open: async (): Promise<LibraryData> => ({
      notes: [{ ...original, content: undefined, revision: 1, documentVersion: 1 }],
      notebooks: [],
      appearance: {},
      preferencesRevision: 1,
      path: 'synthetic-only',
    }),
    load,
    saveNote: vi.fn(async () => ({ revision: 2, updated: 2 })),
    savePreferences: vi.fn(async () => ({ revision: 2, updated: 2 })),
    quit: vi.fn(async () => {}),
  }
  return { store: new LibraryStore(transport), transport }
}
function deferred() {
  let resolve!: (note: SavedNote) => void, reject!: (error: Error) => void
  const promise = new Promise<SavedNote>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
afterEach(() => vi.useRealTimers())

it('reports a newly missing linked file instead of searching its cached Markdown', async () => {
  const { store, transport } = fixture(async () => ({
    ...original,
    revision: 1,
    documentVersion: 1,
    source: {
      ...original.source!,
      markdown: 'cached body',
      unavailable: 'Synthetic file is missing.',
    },
  }))
  await store.open()
  const before = store.getSnapshot()
  await expect(store.readSearchNote(original.id)).rejects.toThrow('Synthetic file is missing.')
  expect(store.getSnapshot()).toBe(before)
  expect(transport.saveNote).not.toHaveBeenCalled()
  expect(transport.savePreferences).not.toHaveBeenCalled()
})

it('returns fresh linked fingerprints and displayed Markdown without activating the note', async () => {
  const { store } = fixture(async () => ({
    ...original,
    text: 'new text',
    revision: 2,
    documentVersion: 1,
    source: { ...original.source!, fingerprint: 'fresh', markdown: '**new text**' },
  }))
  await store.open()
  const before = store.getSnapshot()
  const result = await store.readSearchNote(original.id)
  expect(result.source?.fingerprint).toBe('fresh')
  expect(result.content.content?.[0].content?.[0].text).toBe('new text')
  expect(store.getSnapshot()).toBe(before)
  expect(before.loaded.size).toBe(0)
})

it('searches a pending draft even when its linked file is already unavailable', async () => {
  vi.useFakeTimers()
  const load = vi.fn(async () => ({ ...original, revision: 1, documentVersion: 1 }))
  const { store, transport } = fixture(load)
  await store.open()
  store.setNotes([
    {
      ...store.getSnapshot().notes[0],
      text: 'unsaved draft',
      content: original.content,
      source: { ...original.source!, unavailable: 'Synthetic missing file.' },
    },
  ])
  const before = store.getSnapshot()
  expect(await store.readSearchNote(original.id)).toBe(before.notes[0])
  expect(store.getSnapshot()).toBe(before)
  expect(load).not.toHaveBeenCalled()
  expect(transport.saveNote).not.toHaveBeenCalled()
})

it.each(['unavailable', 'unsupported', 'read failure'])(
  'uses an edit created during a search read rather than the stale %s disk response',
  async (kind) => {
    vi.useFakeTimers()
    const pending = deferred(),
      { store, transport } = fixture(() => pending.promise)
    await store.open()
    const search = store.readSearchNote(original.id)
    const draft = {
      ...store.getSnapshot().notes[0],
      text: 'unsaved draft',
      content: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'unsaved draft' }] }],
      },
    }
    store.setNotes([draft])
    if (kind === 'read failure') pending.reject(Error('Synthetic read failed.'))
    else
      pending.resolve({
        ...original,
        revision: 1,
        documentVersion: kind === 'unsupported' ? 2 : 1,
        source: {
          ...original.source!,
          markdown: 'old disk',
          unavailable: kind === 'unavailable' ? 'Synthetic missing' : null,
        },
      })
    expect(await search).toBe(store.getSnapshot().notes[0])
    expect((await search).text).toBe('unsaved draft')
    expect(transport.saveNote).not.toHaveBeenCalled()
  },
)
