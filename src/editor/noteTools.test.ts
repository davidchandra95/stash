// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { writingExtensions } from './extensions'
import { markdownExtensions, parseMarkdown } from './markdown'
import {
  clearReveals,
  documentMatches,
  findKey,
  literalMatches,
  outline,
  revealPosition,
  setFind,
} from './noteTools'
const editors: Editor[] = []
const editor = (content: string) => {
  const e = new Editor({ extensions: writingExtensions, content })
  editors.push(e)
  return e
}
afterEach(() => {
  editors.splice(0).forEach((e) => e.destroy())
})
it('builds a heading tree with repeated titles, skipped levels and empty headings', () => {
  const e = editor('<h2>Same</h2><h4>Child</h4><h2>Same</h2><h6></h6>')
  const tree = outline(e.state.doc)
  expect(tree.map((h) => h.title)).toEqual(['Same', 'Same'])
  expect(tree[0].children[0].level).toBe(4)
  expect(tree[1].children[0].title).toBe('Untitled heading')
  expect(tree[0].pos).not.toBe(tree[1].pos)
})
it('finds literal text across formatting but not across blocks or atoms', () => {
  const e = editor('<p>one <strong>TW</strong>O [x].</p><p>three</p><p>four</p>')
  const matches = documentMatches(e.state.doc, 'two')
  expect(matches).toHaveLength(1)
  expect(e.state.doc.textBetween(matches[0].from, matches[0].to)).toBe('TWO')
  expect(documentMatches(e.state.doc, 'threefour')).toEqual([])
  expect(documentMatches(e.state.doc, '[x].')).toHaveLength(1)
  expect(literalMatches('😀 Test TEST', 'test')).toEqual([
    { from: 3, to: 7 },
    { from: 8, to: 12 },
  ])
  expect(literalMatches('a', '')).toEqual([])
})
it('decorates and updates matches without changing JSON, selection, save callbacks, or undo', () => {
  const e = editor('<p>Alpha alpha</p>')
  const update = vi.fn()
  e.on('update', update)
  const before = e.getJSON(),
    selection = e.state.selection.toJSON()
  setFind(e, 'alpha', 1)
  expect(findKey.getState(e.state)?.decorations.find()).toHaveLength(2)
  expect(e.getJSON()).toEqual(before)
  expect(e.state.selection.toJSON()).toEqual(selection)
  expect(update).not.toHaveBeenCalled()
  expect(e.can().undo()).toBe(false)
  e.commands.insertContent('alpha ')
  expect(findKey.getState(e.state)?.decorations.find()).toHaveLength(3)
  setFind(e, '', -1)
  expect(findKey.getState(e.state)?.decorations.find()).toEqual([])
  e.commands.undo()
  expect(e.getJSON()).toEqual(before)
})
it('reveals collapsed headings across DOM updates without changing content or undo', async () => {
  const e = editor(
    '<section data-type="collapsible" data-collapsed="true"><div data-type="collapsibleHeader"><p>Section</p></div><div data-type="collapsibleBody"><h2>Hidden</h2></div></section>',
  )
  const before = e.getJSON(),
    update = vi.fn()
  e.on('update', update)
  revealPosition(e, outline(e.state.doc)[0].pos + 1)
  await new Promise((resolve) => setTimeout(resolve, 0))
  setFind(e, 'Hidden', 0)
  expect(e.view.dom.querySelector('.navigation-revealed')).toBeTruthy()
  expect(e.view.dom.querySelector('[aria-label="Collapse section"]')).toBeTruthy()
  expect(e.getJSON()).toEqual(before)
  expect(update).not.toHaveBeenCalled()
  expect(e.can().undo()).toBe(false)
  clearReveals(e)
  expect(e.view.dom.querySelector('.navigation-revealed')).toBeFalsy()
  expect(e.getJSON()).toEqual(before)
})
it('finding a note that ends in a heading does not append an empty paragraph', () => {
  const e = editor('<h2>Only heading</h2>')
  const before = e.getJSON()
  setFind(e, 'heading', 0)
  expect(e.getJSON()).toEqual(before)
})

it('highlights each occurrence in preserved visible Markdown source without changing its saved document', () => {
  const e = new Editor({
    extensions: markdownExtensions,
    content: parseMarkdown('<div>fix fix</div>'),
  })
  editors.push(e)
  const before = e.getJSON()
  expect(documentMatches(e.state.doc, 'fix')).toHaveLength(2)
  setFind(e, 'fix', 1)
  const marks = e.view.dom.querySelectorAll('.markdown-source-block mark')
  expect(marks).toHaveLength(2)
  expect(marks[1].classList.contains('current-match')).toBe(true)
  expect(marks[0].classList.contains('current-match')).toBe(false)
  expect(e.getJSON()).toEqual(before)
  expect(e.can().undo()).toBe(false)
  setFind(e, '', -1)
  expect(e.view.dom.querySelector('.markdown-source-block')?.textContent).toBe('<div>fix fix</div>')
  expect(e.view.dom.querySelectorAll('.markdown-source-block mark')).toHaveLength(0)
})
