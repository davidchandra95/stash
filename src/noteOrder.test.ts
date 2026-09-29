// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { sortNotes, moveNote, reorderSlots, retainAbsent, reconcileNoteLists } from './noteOrder'
import type { Note } from './model'
const note = (id: string, pinned = false, updated = 1) =>
  ({ id, title: id, pinned, updated }) as Note
const ids = (notes: Note[]) => notes.map((n) => n.id)
describe('note ordering', () => {
  it('keeps pins first in every mode and gives automatic sorts stable ties', () => {
    const notes = [note('b'), note('a'), note('p', true)]
    expect(ids(sortNotes(notes))).toEqual(['p', 'a', 'b'])
    expect(ids(sortNotes(notes, { mode: 'title', order: [] }))).toEqual(['p', 'a', 'b'])
    expect(ids(sortNotes(notes, { mode: 'custom', order: ['b', 'p', 'a'] }))).toEqual([
      'p',
      'b',
      'a',
    ])
  })
  it('puts newcomers first but editing a saved note does not move it', () => {
    const saved = { mode: 'custom' as const, order: ['b', 'a'] }
    expect(
      ids(
        sortNotes(
          [note('a', false, 99), note('b'), note('new', false, 4), note('newer', false, 5)],
          saved,
        ),
      ),
    ).toEqual(['newer', 'new', 'b', 'a'])
  })
  it('moves search matches within their slots, preserving hidden and absent notes', () => {
    const notes = ['a', 'hidden', 'b', 'c'].map((id) => note(id))
    const visible = [notes[0], notes[2], notes[3]]
    expect(
      reorderSlots(notes, moveNote(visible, 'a', 'c'), ['a', 'absent', 'hidden', 'b', 'c']),
    ).toEqual(['b', 'absent', 'hidden', 'c', 'a'])
  })
  it('does not cross pin groups and can return to the original position', () => {
    const notes = [note('p', true), note('a'), note('b')]
    expect(moveNote(notes, 'p', 'b')).toBe(notes)
    expect(ids(moveNote(moveNote(notes, 'a', 'b'), 'a', 'b'))).toEqual(ids(notes))
  })
  it('retains temporarily unavailable IDs without duplicates', () => {
    expect(retainAbsent(['a', 'missing', 'b'], ['b', 'a'])).toEqual(['b', 'missing', 'a'])
  })
})

it('cleans permanently removed IDs and notebooks but retains notes temporarily outside a list', () => {
  const a = { ...note('a'), notebookIds: [], trashed: true }
  const b = { ...note('b'), notebookIds: [], trashed: false }
  expect(
    reconcileNoteLists(
      {
        all: { mode: 'custom', order: ['a', 'gone', 'b'] },
        'book:deleted': { mode: 'custom', order: ['a'] },
      },
      [a, b],
      [],
    ),
  ).toEqual({ all: { mode: 'custom', order: ['a', 'b'] } })
})
