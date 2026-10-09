// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { LibraryProjection } from './librarySelectors'
import { LibraryStore } from './library'
import { matchesView, type Note, type View } from '../model'
import { sortNotes, type NoteListPreferences } from '../noteOrder'

const note = (id: string, updated = 1): Note => ({
  id,
  title: id,
  updated,
  text: 'Body',
  content: { type: 'doc', content: [{ type: 'paragraph' }] },
  notebookIds: ['book'],
  tags: [],
  pinned: false,
  trashed: false,
  quickAccess: false,
})

it('retains navigation, tags, counts, and ordered IDs across ordinary body edits', () => {
  const projection = new LibraryProjection()
  const store = new LibraryStore(null)
  const a = note('a', Date.now())
  store.setNotes([a, note('b')])
  const state = store.getSnapshot()
  const navigation = projection.navigation(state)
  const tags = projection.tags(state)
  const readList = projection.list('all', '', undefined)
  const ids = readList(state)
  store.setNotes([{ ...a, text: 'Body changed', updated: a.updated + 1 }, state.notes[1]])
  const next = store.getSnapshot()
  expect(projection.navigation(next)).toBe(navigation)
  expect(projection.tags(next)).toBe(tags)
  expect(projection.count(next, 'all')).toBe(2)
  expect(readList(next)).toBe(ids)
  expect(projection.note(next, 'a')?.text).toBe('Body changed')
})

it('keeps each sort and filter equal to the existing behavior after changes', () => {
  const views: View[] = [
    'all',
    'pinned',
    'quickAccess',
    'trash',
    'todo',
    'book:book',
    'tag:confirmed',
  ]
  const preferences: (NoteListPreferences | undefined)[] = [
    undefined,
    { mode: 'title', order: [] },
    { mode: 'custom', order: ['c', 'a'] },
  ]
  for (const view of views)
    for (const preference of preferences)
      for (const query of ['', 'body', 'special']) {
        const projection = new LibraryProjection()
        const store = new LibraryStore(null)
        const read = projection.list(view, query, preference)
        const verify = () => {
          const state = store.getSnapshot()
          const expected = sortNotes(
            state.notes.filter((n) => matchesView(n, view)),
            preference,
          )
            .filter((n) => `${n.title} ${n.text}`.toLowerCase().includes(query.toLowerCase()))
            .map((n) => n.id)
          expect(read(state)).toEqual(expected)
          expect(projection.count(state, view)).toBe(
            state.notes.filter((n) => matchesView(n, view)).length,
          )
        }
        store.setNotes([note('a', 1), note('b', 2), note('c', 3)])
        verify()
        const changes: Partial<Note>[] = [
          { updated: 8, text: 'special body' },
          { pinned: true },
          { title: 'aaa' },
          { quickAccess: true },
          { notebookIds: [] },
          { hasTasks: true },
          { trashed: true },
          { trashed: false },
        ]
        for (const patch of changes) {
          store.setNotes((old) => old.map((n) => (n.id === 'b' ? { ...n, ...patch } : n)))
          verify()
        }
        store.setNotes((old) => [note('d', 9), ...old.filter((n) => n.id !== 'a')])
        verify()
      }
})

it('refreshes the Today view after midnight without a note mutation', () => {
  let now = new Date(2026, 9, 9, 23, 59).getTime()
  const projection = new LibraryProjection(() => now)
  const store = new LibraryStore(null)
  store.setNotes([note('today', now)])
  const read = projection.list('today', '', undefined)
  expect(read(store.getSnapshot())).toEqual(['today'])
  expect(projection.count(store.getSnapshot(), 'today')).toBe(1)
  now += 120_000
  expect(read(store.getSnapshot())).toEqual([])
  expect(projection.count(store.getSnapshot(), 'today')).toBe(0)
})

it('updates cached counts and tags for confirmed tags, tasks, membership, and deletion', async () => {
  const { tagFooterContent } = await import('../tags')
  const projection = new LibraryProjection()
  const store = new LibraryStore(null)
  store.setNotes([note('a'), note('b')])
  const views: View[] = ['all', 'tag:confirmed', 'todo', 'uncategorized', 'book:book', 'trash']
  for (const view of views) projection.count(store.getSnapshot(), view)
  store.patchNote('a', {
    title: 'New title',
    notebookIds: [],
    hasTasks: true,
    content: { type: 'doc', content: [tagFooterContent(['confirmed'])] },
  })
  for (const view of views)
    expect(projection.count(store.getSnapshot(), view)).toBe(
      store.getSnapshot().notes.filter((n) => matchesView(n, view)).length,
    )
  expect(projection.tags(store.getSnapshot())).toEqual(['confirmed'])
  store.patchNote('a', { trashed: true })
  expect(projection.tags(store.getSnapshot())).toEqual([])
  store.setNotes([])
  for (const view of views) expect(projection.count(store.getSnapshot(), view)).toBe(0)
})

it('catches up after skipped snapshots and keeps untouched note lookups current', () => {
  const projection = new LibraryProjection()
  const store = new LibraryStore(null)
  store.setNotes([note('a', 3), note('b', 2), note('c', 1)])
  const read = projection.list('all', 'special')
  expect(read(store.getSnapshot())).toEqual([])
  store.patchNote('b', { text: 'special', updated: 4 })
  projection.note(store.getSnapshot(), 'a')
  store.patchNote('c', { text: 'special', updated: 5 })
  expect(read(store.getSnapshot())).toEqual(['c', 'b'])
})
