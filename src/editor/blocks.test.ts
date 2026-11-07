// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { writingExtensions } from './extensions'
import {
  blockAt,
  blockKind,
  deleteBlock,
  highlightBlock,
  highlightedBlock,
  insertBlockBelow,
  moveBlock,
  turnBlockInto,
} from './blocks'
import { headingNumbers } from './headingNumbers'
import { outline } from './noteTools'

const editors: Editor[] = []
const editor = (content: string) => {
  const e = new Editor({ extensions: writingExtensions, content })
  editors.push(e)
  return e
}
afterEach(() => editors.splice(0).forEach((e) => e.destroy()))
const find = (e: Editor, text: string) => {
  let found = -1
  e.state.doc.descendants((node, pos) => {
    if (found < 0 && node.isTextblock && node.textContent === text) found = pos + 1
  })
  return blockAt(e.state.doc, found)!
}
const tops = (e: Editor) =>
  e.state.doc.content.content.map((node) => `${node.type.name}:${node.textContent}`)
const list = '<ul><li><p>one</p></li><li><p>two</p></li></ul>'

it('treats top-level nodes and every list item as blocks', () => {
  const e = editor(`<h2>Title</h2><p>text</p>${list}<blockquote><p>quoted</p></blockquote>`)
  expect(blockKind(find(e, 'Title'))).toBe('h2')
  expect(blockKind(find(e, 'text'))).toBe('paragraph')
  expect(find(e, 'two').listItem).toBe(true)
  expect(blockKind(find(e, 'two'))).toBe('bullet')
  expect(blockKind(find(e, 'quoted'))).toBe('quote')
})

it('turns blocks into other types, including list items back to text', () => {
  const e = editor(`<p>text</p>${list}`)
  turnBlockInto(e, find(e, 'text'), 'h3')
  expect(blockKind(find(e, 'text'))).toBe('h3')
  turnBlockInto(e, find(e, 'one'), 'paragraph')
  expect(find(e, 'one').listItem).toBe(false)
  expect(find(e, 'two').listItem).toBe(true)
})

it('numbers a heading from the ordered-list button and keeps numbering per level', () => {
  const e = editor('<h2>A</h2><h3>a</h3><h3>b</h3><h2>B</h2><h3>c</h3><h2>C</h2>')
  for (const text of ['A', 'a', 'b', 'B', 'c']) turnBlockInto(e, find(e, text), 'number')
  expect([...headingNumbers(e.state.doc).values()]).toEqual(['1.', '1.', '2.', '2.', '1.'])
  expect(outline(e.state.doc).map((h) => h.number)).toEqual(['1.', '2.', undefined])
  expect(e.view.dom.querySelector('h2 .heading-number')?.textContent).toBe('1.')
  expect(e.getText()).not.toContain('1.')
  turnBlockInto(e, find(e, 'A'), 'number')
  expect(find(e, 'A').node.attrs.numbered).toBe(false)
  expect(headingNumbers(e.state.doc).get(find(e, 'B').pos)).toBe('1.')
})

it('moves blocks and list items, wrapping an item dropped outside a list', () => {
  const e = editor(`<p>first</p><p>second</p>${list}`)
  moveBlock(e, find(e, 'first'), e.state.doc.content.size, false)
  expect(tops(e)).toEqual(['paragraph:second', 'mixedList:onetwo', 'paragraph:first'])
  moveBlock(e, find(e, 'two'), 0, false)
  expect(tops(e)).toEqual(['mixedList:two', 'paragraph:second', 'mixedList:one', 'paragraph:first'])
  const one = find(e, 'one')
  moveBlock(e, one, 1, true)
  expect(tops(e)).toEqual(['mixedList:onetwo', 'paragraph:second', 'paragraph:first'])
})

it('deletes a block, its emptied parent list, and keeps one paragraph in an empty note', () => {
  const e = editor(`<p>keep</p><ul><li><p>only</p></li></ul>`)
  deleteBlock(e, find(e, 'only'))
  expect(tops(e)).toEqual(['paragraph:keep'])
  deleteBlock(e, find(e, 'keep'))
  expect(tops(e)).toEqual(['paragraph:'])
})

it('inserts below: list items in the list, other types after the top-level block', () => {
  const e = editor(`${list}<p>tail</p>`)
  insertBlockBelow(e, find(e, 'one'), 'task')
  expect(e.state.doc.firstChild!.childCount).toBe(3)
  expect(e.state.doc.firstChild!.child(1).attrs.kind).toBe('task')
  insertBlockBelow(e, find(e, 'one'), 'h2')
  expect(tops(e)).toEqual(['mixedList:onetwo', 'heading:', 'paragraph:tail'])
})

it('highlights a block as view state that follows edits and clears when it is removed', () => {
  const e = editor('<p>first</p><p>second</p>')
  const second = find(e, 'second')
  highlightBlock(e, second.pos)
  expect(e.view.dom.querySelector('.block-highlighted')?.textContent).toBe('second')
  expect(e.can().undo()).toBe(false)
  e.chain().setTextSelection(1).insertContent('new ').run()
  expect(highlightedBlock(e)).toBe(second.pos + 4)
  deleteBlock(e, find(e, 'second'))
  expect(highlightedBlock(e)).toBe(null)
  expect(e.view.dom.querySelector('.block-highlighted')).toBe(null)
})
