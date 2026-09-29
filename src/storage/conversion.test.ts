// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import {
  LibraryStore,
  defaultAppearance,
  type LibraryData,
  type SavedNote,
  type Transport,
} from './library'
function fixture() {
  const note: SavedNote = {
    id: 'a',
    title: 'A',
    notebookIds: ['root'],
    quickAccess: false,
    tags: [],
    text: 'Text',
    pinned: false,
    trashed: false,
    updated: 1,
    revision: 1,
    documentVersion: 1,
    source: { rootId: 'root', relativePath: 'a.md', fingerprint: 'hash', markdown: '# Text' },
  }
  const linked: LibraryData = {
    notes: [note],
    notebooks: [
      {
        id: 'root',
        rootId: 'root',
        relativePath: '',
        name: 'Imported',
        icon: 'folder',
        color: 'green',
      },
    ],
    roots: [{ id: 'root', path: '/notes' }],
    preferencesRevision: 1,
    appearance: defaultAppearance,
    path: '/library',
  }
  const native: LibraryData = {
    ...linked,
    notes: [{ ...note, source: null, revision: 2 }],
    notebooks: linked.notebooks.map((b) => ({ ...b, rootId: null, relativePath: null })),
    roots: [],
    preferencesRevision: 2,
  }
  const command = vi.fn(async (name: string) => {
    if (name === 'prepare_notebook_conversion')
      return { token: 'token', library: linked, notes: [note] }
    if (name === 'commit_notebook_conversion') return native
    return { pending: 2 }
  })
  const transport: Transport = {
    open: vi.fn(async () => linked),
    load: vi.fn(async () => note),
    saveNote: vi.fn(async () => ({ revision: 2, updated: 1 })),
    savePreferences: vi.fn(async () => ({ revision: 2, updated: 1 })),
    command: command as Transport['command'],
    quit: vi.fn(async () => {}),
  }
  return { linked, native, note, command, transport, store: new LibraryStore(transport) }
}
it('converts never-opened content and immediately switches to native editing', async () => {
  const { store, command, transport } = fixture()
  await store.open()
  await store.convertNotebook('root')
  const state = store.getSnapshot()
  expect(state.roots).toEqual([])
  expect(state.notes[0].source).toBeNull()
  expect(state.notes[0].content.content![0].type).toBe('heading')
  expect(state.loaded.has('a')).toBe(true)
  expect(state.converting).toBe(false)
  expect(command).toHaveBeenCalledWith(
    'commit_notebook_conversion',
    expect.objectContaining({ token: 'token', documents: [expect.objectContaining({ id: 'a' })] }),
  )
  store.setNotes((notes) => notes.map((n) => ({ ...n, title: 'Native edit' })))
  await store.flush()
  expect(transport.saveNote).toHaveBeenCalledWith(
    expect.objectContaining({ title: 'Native edit', expectedRevision: 2 }),
  )
})
it('keeps linked state on failure and recovers a lost committed response', async () => {
  for (const committed of [false, true]) {
    const { store, command, transport, native, linked, note } = fixture()
    await store.open()
    vi.mocked(transport.open).mockResolvedValue(committed ? native : linked)
    command.mockImplementation(async (name) => {
      if (name === 'prepare_notebook_conversion')
        return { token: 'token', library: linked, notes: [note] }
      if (name === 'commit_notebook_conversion') throw Error('Lost response')
      return { pending: 2 }
    })
    if (committed) await store.convertNotebook('root')
    else await expect(store.convertNotebook('root')).rejects.toThrow('Lost response')
    expect(!!store.getSnapshot().notes[0].source).toBe(!committed)
    expect(store.getSnapshot().converting).toBe(false)
    expect(
      command.mock.calls.filter(([name]) => name === 'commit_notebook_conversion'),
    ).toHaveLength(1)
  }
})
it('blocks edits, sync and folder actions, and defers quit until conversion finishes', async () => {
  const { store, command, linked, note, native, transport } = fixture()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  command.mockImplementation(async (name) => {
    if (name === 'prepare_notebook_conversion') {
      await gate
      return { token: 'token', library: linked, notes: [note] }
    }
    if (name === 'commit_notebook_conversion') return native
    return { pending: 2 }
  })
  await store.open()
  const conversion = store.convertNotebook('root')
  expect(store.getSnapshot().converting).toBe(true)
  store.setNotes([])
  await store.sync()
  await expect(store.folderAction('refresh_folder', { id: 'root' })).rejects.toThrow()
  await store.requestQuit()
  expect(transport.quit).not.toHaveBeenCalled()
  expect(store.getSnapshot().notes).toHaveLength(1)
  release()
  await conversion
  expect(transport.quit).toHaveBeenCalledOnce()
  expect(command.mock.calls.some(([name]) => name === 'sync_library')).toBe(false)
})

it('does not prepare conversion when pending edits cannot be saved', async () => {
  const { store, command, transport } = fixture()
  await store.open()
  vi.mocked(transport.saveNote).mockRejectedValue(Error('Disk full'))
  store.setNotes((notes) => notes.map((n) => ({ ...n, pinned: true })))
  await expect(store.convertNotebook('root')).rejects.toThrow('Disk full')
  expect(command).not.toHaveBeenCalledWith('prepare_notebook_conversion', expect.anything())
  expect(store.getSnapshot().notes[0].source).toBeTruthy()
  expect(store.getSnapshot().converting).toBe(false)
})
