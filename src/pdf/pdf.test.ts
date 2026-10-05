// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { ReadingQueue } from './store'
import { initialReading } from './model'
import {
  activeTab,
  currentLocation,
  openNote,
  openPdf,
  previewNote,
  pruneWorkspace,
  restoreWorkspace,
  workspacePreferences,
} from '../workspace'
import type { Note } from '../model'
const notes = [
  { id: 'a', trashed: false },
  { id: 'b', trashed: false },
] as Note[]
const documents = [{ id: 'pdf' }]

describe('mixed document workspace', () => {
  it('restores legacy notes and PDFs, retaining missing-byte documents and note preview', () => {
    const state = restoreWorkspace(
      {
        tabs: [
          { id: 'n', noteId: 'a', preview: true },
          { id: 'p', kind: 'pdf', documentId: 'pdf' },
        ],
        activeTabId: 'p',
      },
      notes,
      documents,
    )
    expect(state.tabs).toHaveLength(2)
    expect(currentLocation(activeTab(state)!)).toEqual({ kind: 'pdf', documentId: 'pdf' })
    expect(workspacePreferences(state).tabs[0]).toEqual({ id: 'n', noteId: 'a', preview: true })
    expect(pruneWorkspace(state, [], documents).tabs.map((t) => t.id)).toEqual(['p'])
  })
  it('opens permanent PDF tabs without consuming the note preview and opens notes separately', () => {
    let state = restoreWorkspace(null, notes)
    state = previewNote(state, { noteId: 'b', view: 'all', query: '', scroll: 0 })
    const previewId = state.activeTabId
    state = openPdf(state, 'pdf')
    const pdfId = state.activeTabId
    expect(state.tabs.find((t) => t.id === previewId)?.preview).toBe(true)
    expect(state.tabs.find((t) => t.id === pdfId)?.preview).toBeUndefined()
    expect(openPdf(state, 'pdf').tabs).toHaveLength(state.tabs.length)
    state = openNote(state, { noteId: 'new', view: 'all', query: '', scroll: 0 })
    expect(state.activeTabId).not.toBe(pdfId)
    expect(state.tabs.find((t) => t.id === pdfId)?.entries).toEqual([
      { kind: 'pdf', documentId: 'pdf' },
    ])
  })
  it('keeps note and PDF identities separate even when their IDs match', () => {
    const state = restoreWorkspace(
      {
        tabs: [
          { id: 'a', noteId: 'a' },
          { id: 'p', kind: 'pdf', documentId: 'a' },
        ],
        activeTabId: 'p',
      },
      notes,
      [{ id: 'a' }],
    )
    expect(state.tabs).toHaveLength(2)
  })
})
describe('PDF reading saves', () => {
  it('serializes writes and drains the newest state before flush resolves', async () => {
    let release!: () => void
    const write = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = resolve
          }),
      )
      .mockResolvedValue(undefined)
    const queue = new ReadingQueue(write)
    queue.set('pdf', { ...initialReading(), page: 2 })
    const flush = queue.flush()
    queue.set('pdf', { ...initialReading(), page: 7 })
    expect(write).toHaveBeenCalledTimes(1)
    release()
    await flush
    expect(write.mock.calls.map((args) => args[1].page)).toEqual([2, 7])
  })
  it('retains failed saves and retries the latest position', async () => {
    const write = vi
      .fn()
      .mockRejectedValueOnce(Error('storage failed'))
      .mockResolvedValue(undefined)
    const queue = new ReadingQueue(write)
    queue.set('pdf', { ...initialReading(), page: 2 })
    await expect(queue.flush()).rejects.toThrow('storage failed')
    queue.set('pdf', { ...initialReading(), page: 5 })
    await queue.flush()
    expect(write.mock.calls.map((args) => args[1].page)).toEqual([2, 5])
  })
})

it('joins the library flush and blocks quit when PDF storage fails', async () => {
  const { LibraryStore } = await import('../storage/library')
  const library = new LibraryStore(null)
  const save = vi.fn().mockRejectedValueOnce(Error('PDF disk full')).mockResolvedValue(undefined)
  const unregister = library.registerFlush(save)
  await library.requestQuit()
  expect(library.getSnapshot().quitFailed).toBe(true)
  expect(library.getSnapshot().quitting).toBe(false)
  await library.requestQuit()
  expect(library.getSnapshot().quitFailed).toBe(false)
  expect(save).toHaveBeenCalledTimes(2)
  unregister()
})
