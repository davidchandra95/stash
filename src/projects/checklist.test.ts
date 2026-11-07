import { expect, it } from 'vitest'
import {
  checklistProgress,
  checklistTitle,
  insertItem,
  moveItem,
  removeItem,
  reopenChecklist,
  updateItem,
  validateChecklist,
  type ChecklistItem,
} from './checklist'

const item = (id: string, title = id, done = false): ChecklistItem => ({ id, title, done })

it('keeps titles to one trimmed line of up to 500 characters', () => {
  expect(checklistTitle('  Call\n  the   plumber \r\n')).toBe('Call the   plumber')
  expect([...checklistTitle('深'.repeat(600))]).toHaveLength(500)
  expect(checklistTitle(' \n ')).toBe('')
})

it('inserts, renames, toggles, moves and removes items', () => {
  let list = insertItem([], item('a', ' First '))
  list = insertItem(list, item('b', 'Second'))
  list = insertItem(list, item('c', 'Zero'), 0)
  expect(list.map((i) => i.title)).toEqual(['Zero', 'First', 'Second'])
  // A blank title or a full list changes nothing.
  expect(insertItem(list, item('d', '  '))).toBe(list)
  const full = Array.from({ length: 100 }, (_, n) => item(`i${n}`))
  expect(insertItem(full, item('x'))).toBe(full)

  list = updateItem(list, 'a', { title: 'One\nline', done: true })
  expect(list[1]).toEqual({ id: 'a', title: 'One line', done: true })
  expect(moveItem(list, 'c', -1)).toBe(list)
  expect(moveItem(list, 'c', 1).map((i) => i.id)).toEqual(['a', 'c', 'b'])
  expect(moveItem(list, 'b', 1)).toBe(list)
  expect(removeItem(list, 'a').map((i) => i.id)).toEqual(['c', 'b'])
  expect(checklistProgress({ checklist: list })).toEqual({ done: 1, total: 3 })
  expect(checklistProgress({})).toEqual({ done: 0, total: 0 })
})

it('reopens every subtask for the next occurrence', () => {
  expect(reopenChecklist([item('a', 'a', true), item('b')])).toEqual([item('a'), item('b')])
  expect(reopenChecklist(undefined)).toBeUndefined()
})

it('validates the limits the native store and server enforce', () => {
  expect(() => validateChecklist(undefined)).not.toThrow()
  expect(() => validateChecklist([item('a', 'Fine', true)])).not.toThrow()
  for (const bad of [
    [item('a', '')],
    [item('a', 'two\nlines')],
    [item('a', 'x'.repeat(501))],
    [item('a'), item('a')],
    [item('bad id!')],
    Array.from({ length: 101 }, (_, n) => item(`i${n}`)),
  ])
    expect(() => validateChecklist(bad)).toThrow(/subtasks/)
})
