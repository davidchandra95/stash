import { expect, it } from 'vitest'
import type { Note, Notebook } from './model'
import { moveSource, moveMembership, notebookMoveTarget, undoMembership } from './notebookMove'
const books: Notebook[] = ['personal', 'work', 'chain-gate', 'extra'].map((id) => ({
  id,
  name: id,
  color: '',
  icon: 'notebook',
}))
books[2].parentId = 'work'
books.push({ id: 'linked', name: 'Linked', color: '', icon: 'folder', rootId: 'root' })
const note: Note = {
  id: 'chain',
  title: 'Chain-gate',
  notebookIds: ['personal', 'work'],
  content: { type: 'doc' },
  text: '',
  tags: [],
  updated: 1,
  quickAccess: false,
  pinned: false,
  trashed: false,
}
const intent = { noteId: note.id, source: 'work', destination: 'chain-gate' }
it('replaces Work with its child and keeps Personal without changing the original note', () => {
  expect(moveSource(note, 'book:work')).toBe('work')
  const moved = moveMembership(note, books, intent)
  expect(moved.notebookIds).toEqual(['personal', 'chain-gate'])
  expect(note.notebookIds).toEqual(['personal', 'work'])
  expect(notebookMoveTarget(note, 'book:work', 'chain-gate', books).hint).toBe(
    'Move from work to work / chain-gate',
  )
})
it('requires a source in combined views only when multiple memberships exist', () => {
  expect(moveSource(note, 'all')).toBeUndefined()
  expect(moveSource({ ...note, notebookIds: ['work'] }, 'tag:tag')).toBe('work')
  expect(moveSource({ ...note, notebookIds: [] }, 'today')).toBeNull()
  expect(
    moveMembership({ ...note, notebookIds: [] }, books, { ...intent, source: null }).notebookIds,
  ).toEqual(['chain-gate'])
})
it('does nothing for the same source and deduplicates an existing destination', () => {
  expect(moveMembership(note, books, { ...intent, destination: 'work' }).changed).toBe(false)
  const result = moveMembership(note, books, { ...intent, destination: 'personal' })
  expect(result.notebookIds).toEqual(['personal'])
  expect(result.change.addedDestination).toBe(false)
  expect(notebookMoveTarget(note, 'book:work', 'personal', books).hint).toContain(
    'Remove from work',
  )
  expect(
    undoMembership({ ...note, notebookIds: result.notebookIds }, books, result.change),
  ).toEqual(['personal', 'work'])
})
it('undo only reverses the membership delta and keeps unrelated additions', () => {
  const result = moveMembership(note, books, intent)
  const edited = { ...note, title: 'Edited', notebookIds: [...result.notebookIds, 'extra'] }
  expect(undoMembership(edited, books, result.change)).toEqual(['personal', 'extra', 'work'])
  expect(edited.title).toBe('Edited')
})
it('rejects stale source/destination, linked files, linked folders, and trash', () => {
  expect(() => moveMembership(note, books, { ...intent, destination: 'gone' })).toThrow(
    'no longer available',
  )
  expect(() => moveMembership(note, books, { ...intent, source: 'extra' })).toThrow(
    'source notebook changed',
  )
  expect(() => moveMembership(note, books, { ...intent, source: null })).toThrow('now belongs')
  expect(() => moveMembership(note, books, { ...intent, destination: 'linked' })).toThrow(
    'linked folders',
  )
  expect(() => moveMembership({ ...note, trashed: true }, books, intent)).toThrow('cannot be moved')
  expect(() =>
    moveMembership(
      { ...note, source: { rootId: 'root', relativePath: 'x.md', fingerprint: '' } },
      books,
      intent,
    ),
  ).toThrow('Linked files')
  expect(() =>
    undoMembership(
      note,
      books.filter((b) => b.id !== 'work'),
      { ...intent, addedDestination: true },
    ),
  ).toThrow('original notebook')
})
