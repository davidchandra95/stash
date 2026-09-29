// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { useNotebookMove } from './useNotebookMove'
import { library } from './storage/useLibrary'
import type { Note, Notebook } from './model'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const books: Notebook[] = ['personal', 'work', 'chain', 'extra'].map((id) => ({
  id,
  name: id,
  color: '',
  icon: 'notebook',
}))
const note: Note = {
  id: 'n',
  title: 'Chain-gate',
  notebookIds: ['personal', 'work'],
  content: { type: 'doc' },
  text: '',
  tags: [],
  pinned: false,
  trashed: false,
  quickAccess: false,
  updated: 1,
}
const intent = { noteId: 'n', source: 'work', destination: 'chain' }
let api: ReturnType<typeof useNotebookMove>
let cleanup: () => void
async function mount() {
  library.setNotebooks(books)
  library.setNotes([note])
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  function Harness() {
    api = useNotebookMove(() => {})
    return null
  }
  await act(async () => root.render(<Harness />))
  cleanup = () => {
    act(() => root.unmount())
    host.remove()
  }
}
afterEach(() => {
  cleanup?.()
  vi.restoreAllMocks()
})
it('announces only after saving and Undo preserves content and unrelated memberships', async () => {
  await mount()
  let resolve!: () => void
  vi.spyOn(library, 'flush').mockImplementationOnce(
    () =>
      new Promise<void>((r) => {
        resolve = r
      }),
  )
  await act(async () => {
    api.move(intent)
  })
  expect(api.busy).toBe(true)
  expect(api.notice).toBeNull()
  expect(library.getSnapshot().notes).toHaveLength(1)
  expect(library.getSnapshot().notes[0].notebookIds).toEqual(['personal', 'chain'])
  await act(async () => resolve())
  expect(api.notice?.message).toContain('Moved')
  library.setNotes((notes) =>
    notes.map((n) => ({ ...n, title: 'Edited', notebookIds: [...n.notebookIds, 'extra'] })),
  )
  await act(async () => api.undo())
  expect(library.getSnapshot().notes[0]).toMatchObject({
    title: 'Edited',
    notebookIds: ['personal', 'extra', 'work'],
  })
  expect(api.notice?.message).toBe('Notebook move undone.')
})
it('retries saving without applying the membership mutation twice', async () => {
  await mount()
  const save = vi
    .spyOn(library, 'flush')
    .mockRejectedValueOnce(new Error('disk full'))
    .mockResolvedValue(undefined)
  const mutations = vi.spyOn(library, 'setNotes')
  await act(async () => {
    api.move(intent)
  })
  expect(api.notice).toBeNull()
  expect(api.failure?.message).toContain('not been saved')
  expect(api.failure?.message).toContain('disk full')
  await act(async () => api.failure!.retry!())
  expect(save).toHaveBeenCalledTimes(2)
  expect(mutations).toHaveBeenCalledTimes(1)
  expect(api.notice?.change).toBeTruthy()
})
it('revalidates deleted destinations and blocks overlapping moves', async () => {
  await mount()
  library.setNotebooks(books.filter((b) => b.id !== 'chain'))
  await act(async () => {
    expect(api.move(intent)).toBe(false)
  })
  expect(library.getSnapshot().notes[0].notebookIds).toEqual(['personal', 'work'])
  await act(async () => api.dismissFailure())
  library.setNotebooks(books)
  let resolve!: () => void
  vi.spyOn(library, 'flush').mockImplementationOnce(
    () =>
      new Promise<void>((r) => {
        resolve = r
      }),
  )
  await act(async () => {
    expect(api.move(intent)).toBe(true)
    expect(api.move(intent)).toBe(false)
  })
  await act(async () => resolve())
})
it.each(['syncing', 'converting', 'quitting'] as const)('blocks moves during %s', async (field) => {
  await mount()
  const state = library.getSnapshot()
  vi.spyOn(library, 'getSnapshot').mockReturnValue({ ...state, [field]: true })
  const mutations = vi.spyOn(library, 'setNotes')
  await act(async () => {
    expect(api.move(intent)).toBe(false)
  })
  expect(mutations).not.toHaveBeenCalled()
})
