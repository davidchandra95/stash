// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { LibraryStore, type SavedNote, type Transport } from './library'

const linkTo = (noteId: string) => ({
  type: 'doc',
  content: [
    {
      type: 'blockquote',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'noteReference', attrs: { noteId, fallbackTitle: noteId } }],
        },
      ],
    },
  ],
})
const empty = { type: 'doc', content: [{ type: 'paragraph' }] }
const saved = (id: string, patch: Partial<SavedNote> = {}): SavedNote =>
  ({
    id,
    title: id,
    text: '',
    notebookIds: [],
    tags: [],
    pinned: false,
    trashed: false,
    quickAccess: false,
    updated: 1,
    revision: 1,
    documentVersion: 1,
    ...patch,
  }) as SavedNote

async function open(notes: SavedNote[], bodies: Record<string, unknown>, candidates: string[]) {
  const load = vi.fn(async (id: string) => {
    if (!(id in bodies)) throw Error(`Cannot read ${id}`)
    return { ...notes.find((note) => note.id === id)!, content: bodies[id] } as SavedNote
  })
  const command = vi.fn(async () => candidates)
  const store = new LibraryStore({
    open: async () => ({ notes, notebooks: [], appearance: {}, preferencesRevision: 1 }),
    load,
    command,
    saveNote: vi.fn(),
    savePreferences: vi.fn(),
    quit: vi.fn(),
  } as unknown as Transport)
  await store.open()
  return { store, load, command }
}

it('confirms candidates, so a mention of the ID in text is not a backlink', async () => {
  const { store, command } = await open(
    [
      saved('target'),
      saved('older', { updated: 1 }),
      saved('newer', { updated: 2 }),
      saved('text'),
    ],
    {
      older: linkTo('target'),
      newer: linkTo('target'),
      text: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'target' }] }],
      },
    },
    ['older', 'newer', 'text'],
  )
  expect(await store.backlinks('target')).toEqual({ ids: ['newer', 'older'], unreadable: 0 })
  expect(command).toHaveBeenCalledWith('note_backlink_candidates', { id: 'target' })
})

it('finds ordinary note links, including ones to a heading', async () => {
  const link = (href: string) => ({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href } }] }],
      },
    ],
  })
  const { store } = await open(
    [saved('target'), saved('plain'), saved('heading'), saved('other')],
    {
      plain: link('upnote2://note/target'),
      heading: link('upnote2://note/target#section'),
      other: link('upnote2://note/target-2'),
    },
    ['plain', 'heading', 'other'],
  )
  expect((await store.backlinks('target')).ids.sort()).toEqual(['heading', 'plain'])
})

it('uses unsaved content ahead of what is saved', async () => {
  const { store } = await open(
    [saved('target'), saved('added'), saved('removed')],
    { added: empty, removed: linkTo('target') },
    ['removed'],
  )
  await store.load('added')
  await store.load('removed')
  store.patchNote('added', { content: linkTo('target') })
  store.patchNote('removed', { content: empty })
  expect((await store.backlinks('target')).ids).toEqual(['added'])
})

it('skips trash and self-links, and counts notes it could not read', async () => {
  const { store } = await open(
    [saved('target'), saved('trashed', { trashed: true }), saved('broken')],
    { target: linkTo('target'), trashed: linkTo('target') },
    ['target', 'trashed', 'broken'],
  )
  expect(await store.backlinks('target')).toEqual({ ids: [], unreadable: 1 })
})

it('reports a failed search instead of an empty list', async () => {
  const { store, command } = await open([saved('target')], {}, [])
  command.mockRejectedValueOnce(Error('Storage stopped'))
  await expect(store.backlinks('target')).rejects.toThrow('Storage stopped')
})

it('searches notes in memory when there is no storage', async () => {
  const store = new LibraryStore(null)
  store.setNotes([
    { ...saved('target'), content: empty },
    { ...saved('source'), content: linkTo('target') },
  ] as never)
  expect((await store.backlinks('target')).ids).toEqual(['source'])
})
