// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { LibraryStore, defaultAppearance, type LibraryData, type SavedNote } from './library'
const note: SavedNote = {
  id: 'a',
  title: 'local',
  notebookIds: [],
  quickAccess: false,
  tags: [],
  content: { type: 'doc', content: [{ type: 'paragraph' }] },
  text: '',
  pinned: false,
  trashed: false,
  updated: 1,
  revision: 1,
  documentVersion: 1,
}
const data: LibraryData = {
  notes: [note],
  notebooks: [],
  appearance: defaultAppearance,
  workspace: null,
  preferencesRevision: 1,
  path: 'test',
}
function setup(command: (name: string, args: Record<string, unknown>) => Promise<unknown>) {
  const transport = {
    open: async () => data,
    load: vi.fn(async () => ({ ...note, title: 'remote' })),
    saveNote: vi.fn(async () => ({ revision: 2, updated: 2 })),
    savePreferences: vi.fn(async () => ({ revision: 2, updated: 2 })),
    quit: vi.fn(async () => {}),
    command: command as <T>(name: string, args: Record<string, unknown>) => Promise<T>,
  }
  return { store: new LibraryStore(transport), transport }
}
describe('manual sync', () => {
  it('flushes local changes before syncing and reloads loaded documents', async () => {
    const order: string[] = []
    const { store, transport } = setup(async (name) => {
      order.push(name)
      return {
        library: { ...data, notes: [{ ...note, title: 'remote' }] },
        status: {
          configured: true,
          url: 'https://stash.example.com',
          lastSuccess: 3,
          pending: 0,
          warnings: [],
        },
      }
    })
    transport.saveNote.mockImplementation(async () => {
      order.push('save')
      return { revision: 2, updated: 2 }
    })
    await store.open()
    await store.load('a')
    store.setNotes((old) => old.map((n) => ({ ...n, title: 'edit' })))
    await store.sync()
    expect(order).toEqual(['save', 'sync_library'])
    expect(store.getSnapshot().notes[0].title).toBe('remote')
    expect(store.getSnapshot().syncGeneration).toBe(1)
    expect(store.getSnapshot().syncing).toBe(false)
  })
  it('reconciles saved revisions and unloads a note when its post-sync reload fails', async () => {
    const staleContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'stale body' }] }],
    }
    const { store, transport } = setup(async () => ({
      library: { ...data, notes: [{ ...note, title: 'remote', revision: 2, content: undefined }] },
      status: {
        configured: true,
        url: 'https://stash.example.com',
        lastSuccess: 3,
        pending: 0,
        warnings: [],
      },
    }))
    await store.open()
    transport.load.mockResolvedValueOnce({ ...note, content: staleContent })
    await store.load('a')
    transport.load.mockRejectedValueOnce(Error('Body unavailable'))

    await store.sync()

    const failed = store.getSnapshot()
    expect(failed.syncing).toBe(false)
    expect(failed.syncGeneration).toBe(1)
    expect(failed.syncError).toContain('Sync completed')
    expect(failed.loaded.has('a')).toBe(false)
    expect(failed.noteErrors.a).toContain('Body unavailable')
    expect(failed.notes[0].content).not.toEqual(staleContent)

    transport.load.mockResolvedValueOnce({ ...note, title: 'remote', revision: 2 })
    await store.load('a')
    expect(store.getSnapshot().loaded.has('a')).toBe(true)
    expect(store.getSnapshot().noteErrors.a).toBeUndefined()

    store.setNotes((notes) => notes.map((current) => ({ ...current, title: 'after retry' })))
    await store.flush()
    expect(transport.saveNote).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'a', title: 'after retry', expectedRevision: 2 }),
    )
  })
  it('blocks overlapping sync, editing and quit, then restores interaction after failure', async () => {
    let fail!: (e: Error) => void
    const command = vi.fn(
      () =>
        new Promise((_, reject) => {
          fail = reject
        }),
    )
    const { store, transport } = setup(command)
    await store.open()
    const run = store.sync()
    await vi.waitFor(() => expect(command).toHaveBeenCalledOnce())
    await store.sync()
    store.setNotes(() => [])
    await store.requestQuit()
    expect(transport.quit).not.toHaveBeenCalled()
    expect(store.getSnapshot().notes).toHaveLength(1)
    fail(Error('offline'))
    await run
    expect(store.getSnapshot().syncing).toBe(false)
    expect(store.getSnapshot().syncError).toContain('offline')
    store.setNotes(() => [])
    expect(store.getSnapshot().notes).toHaveLength(0)
  })
  it('never calls sync when saving fails', async () => {
    const command = vi.fn()
    const { store, transport } = setup(command)
    await store.open()
    transport.saveNote.mockRejectedValue(Error('disk full'))
    store.setNotes((old) => old.map((n) => ({ ...n, title: 'pending' })))
    await store.sync()
    expect(command).not.toHaveBeenCalled()
    expect(store.getSnapshot().notes[0].title).toBe('pending')
    expect(store.getSnapshot().syncError).toContain('disk full')
  })
})
