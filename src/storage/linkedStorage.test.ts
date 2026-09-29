// @vitest-environment jsdom
import { it, expect, vi } from 'vitest'
import { LibraryStore, defaultAppearance, type SavedNote, type Transport } from './library'
import { parseMarkdown } from '../editor/markdown'

async function fixture() {
  const original: SavedNote = {
    id: 'a',
    title: 'a',
    notebookIds: ['root'],
    quickAccess: false,
    tags: [],
    pinned: false,
    trashed: false,
    text: 'Original',
    updated: 1,
    revision: 1,
    documentVersion: 1,
    source: { rootId: 'root', relativePath: 'a.md', fingerprint: 'one', markdown: 'Original\n' },
  }
  let disk = original
  const saveNote = vi.fn<Transport['saveNote']>(async (input) => ({
    revision: 2,
    updated: 2,
    note: {
      ...original,
      ...input,
      revision: 2,
      source: {
        ...original.source!,
        fingerprint: 'two',
        markdown: String(input.markdown ?? disk.source!.markdown),
      },
    } as SavedNote,
  }))
  const command = vi.fn(async (name: string) =>
    name === 'resolve_file_conflict' ? disk : undefined,
  )
  const transport: Transport = {
    open: async () => ({
      notes: [original, { ...original, id: 'ordinary', source: undefined, notebookIds: [] }],
      notebooks: [
        {
          id: 'root',
          name: 'Root',
          color: 'green',
          icon: 'folder',
          rootId: 'root',
          relativePath: '',
        },
      ],
      roots: [{ id: 'root', path: '/fixture' }],
      appearance: defaultAppearance,
      preferencesRevision: 1,
      path: '/test',
    }),
    load: async () => disk,
    saveNote,
    savePreferences: async () => ({ revision: 2, updated: 2 }),
    command: command as Transport['command'],
    quit: vi.fn(),
  }
  const store = new LibraryStore(transport)
  await store.open()
  await store.load('a')
  return {
    store,
    saveNote,
    command,
    transport,
    setDisk: (note: SavedNote) => (disk = note),
    original,
  }
}
it('opening and changing metadata never send Markdown to the writer', async () => {
  const { store, saveNote } = await fixture()
  await store.activate('a')
  expect(saveNote).not.toHaveBeenCalled()
  store.setNotes((notes) =>
    notes.map((n) => (n.id === 'a' ? { ...n, pinned: true, tags: ['tag'] } : n)),
  )
  await store.flush()
  expect(saveNote.mock.calls[0][0].markdown).toBeUndefined()
})
it('a conflict freezes one note while ordinary notes save and quit stays blocked', async () => {
  const { store, saveNote, transport } = await fixture()
  saveNote.mockImplementation(async (input) => {
    if (input.id === 'a') throw Error('FILE_CONFLICT: disk changed')
    return { revision: 2, updated: 2 }
  })
  store.setNotes((notes) =>
    notes.map((n) => ({ ...n, text: 'new', content: parseMarkdown('Local') })),
  )
  await expect(store.flush()).rejects.toThrow('Resolve')
  expect(saveNote.mock.calls.map((c) => c[0].id)).toContain('ordinary')
  await store.requestQuit()
  expect(transport.quit).not.toHaveBeenCalled()
  expect(store.getSnapshot().quitFailed).toBe(true)
})
it('a failed resolution preserves the local draft and retries the same operation', async () => {
  const { store, saveNote, command, setDisk, original } = await fixture()
  saveNote.mockRejectedValueOnce(Error('FILE_CONFLICT: disk changed'))
  store.setNotes((notes) =>
    notes.map((n) => (n.id === 'a' ? { ...n, content: parseMarkdown('Local draft') } : n)),
  )
  await expect(store.flush()).rejects.toThrow()
  setDisk({
    ...original,
    revision: 2,
    source: { ...original.source!, fingerprint: 'external', markdown: 'External' },
  })
  saveNote.mockRejectedValueOnce(Error('Temporary disk failure'))
  await expect(store.resolveConflict('a', 'copy')).rejects.toThrow('Temporary')
  expect(JSON.stringify(store.getSnapshot().notes[0].content)).toContain('Local draft')
  expect(store.getSnapshot().conflicts.a).toBeTruthy()
  const attempt = saveNote.mock.calls.at(-1)![0]
  await store.resolveConflict('a', 'copy')
  expect(saveNote.mock.calls.at(-1)![0]).toBe(attempt)
  expect(store.getSnapshot().conflicts.a).toBeUndefined()
  expect(store.getSnapshot().notes).toHaveLength(3)
  expect(JSON.stringify(store.getSnapshot().notes[0].content)).toContain('External')
  expect(command).toHaveBeenCalledWith('clear_file_conflict', { id: 'a' })
})
it('reopening a clean cached note loads external changes', async () => {
  const { store, setDisk, original } = await fixture()
  setDisk({
    ...original,
    revision: 2,
    source: { ...original.source!, fingerprint: 'external', markdown: 'External change' },
  })
  await store.activate('a')
  expect(JSON.stringify(store.getSnapshot().notes[0].content)).toContain('External change')
})
it('renaming a note refreshes rewritten relative links in the editor document', async () => {
  const { store, saveNote, original } = await fixture()
  saveNote.mockResolvedValue({
    revision: 2,
    updated: 2,
    note: {
      ...original,
      title: 'Renamed',
      source: {
        ...original.source!,
        relativePath: 'Renamed.md',
        fingerprint: 'new',
        markdown: '[Self](Renamed.md)',
      },
    },
  })
  store.setNotes((notes) => notes.map((n) => (n.id === 'a' ? { ...n, title: 'Renamed' } : n)))
  await store.flush()
  expect(JSON.stringify(store.getSnapshot().notes[0].content)).toContain('Renamed.md')
})

it('restores a new-note conflict draft even when no note record was committed', async () => {
  const { transport } = await fixture()
  const content = parseMarkdown('Unsaved creation')
  transport.open = async () => ({
    notes: [],
    notebooks: [
      {
        id: 'root',
        name: 'Root',
        color: 'green',
        icon: 'folder',
        rootId: 'root',
        relativePath: '',
      },
    ],
    appearance: defaultAppearance,
    preferencesRevision: 1,
    path: '/test',
    conflicts: [
      {
        draft: {
          id: 'pending',
          title: 'Pending',
          notebookIds: ['root'],
          text: 'Unsaved creation',
          content,
        },
        error: 'FILE_CONFLICT: interrupted creation',
      },
    ],
  })
  transport.command = async <T>() => null as T
  const store = new LibraryStore(transport)
  await store.open()
  expect(store.getSnapshot().notes[0].source?.rootId).toBe('root')
  expect(JSON.stringify(store.getSnapshot().notes[0].content)).toContain('Unsaved creation')
  await store.resolveConflict('pending', 'disk')
  expect(store.getSnapshot().notes).toHaveLength(0)
})
