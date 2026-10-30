import { expect, it } from 'vitest'
import { notePreview, noteNotebookContext } from './noteListPresentation'
import type { Notebook } from './model'

it('renders one body line and a text-free fallback without interpreting markup', () => {
  expect(notePreview('  First line\n\nSecond\tline  ')).toBe('First line Second line')
  expect(notePreview(' \n\t ')).toBe('No text preview')
  expect(notePreview('<script>alert(1)</script>')).toBe('<script>alert(1)</script>')
})

it('describes all unique memberships with paths while keeping the visible summary short', () => {
  const books: Notebook[] = [
    { id: 'parent', name: 'Work', icon: 'book', color: '#888888' },
    { id: 'child', name: 'Plans', parentId: 'parent', icon: 'book', color: '#888888' },
    { id: 'personal', name: 'Personal', icon: 'book', color: '#888888' },
  ]
  expect(
    noteNotebookContext({ notebookIds: ['child', 'personal', 'child', 'missing'] }, books),
  ).toEqual({
    name: 'Plans',
    color: '#888888',
    extra: 1,
    description: 'Notebooks: Work / Plans, Personal',
  })
  expect(noteNotebookContext({ notebookIds: ['missing'] }, books)).toEqual({
    name: 'Uncategorized',
    color: undefined,
    extra: 0,
    description: 'Uncategorized',
  })
})
