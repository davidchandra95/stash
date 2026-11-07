// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { writingExtensions } from './extensions'
import { HeadingFolds, foldedHeadings, hiddenRanges, toggleHeadingFold } from './headingFolds'
import { revealPosition } from './noteTools'

const editors: Editor[] = []
const editor = (content: string, noteId: string | null = 'note-1') => {
  const e = new Editor({
    extensions: writingExtensions.map((extension) =>
      extension.name === HeadingFolds.name ? HeadingFolds.configure({ noteId }) : extension,
    ),
    content,
  })
  editors.push(e)
  return e
}
const doc = '<h2>One</h2><p>a</p><h3>Sub</h3><p>b</p><h2>Two</h2><p>c</p><h1>Top</h1><p>d</p>'
const headingPos = (e: Editor, text: string) => {
  let found = -1
  e.state.doc.forEach((node, pos) => {
    if (found < 0 && node.type.name === 'heading' && node.textContent === text) found = pos
  })
  return found
}
const hiddenText = (e: Editor) =>
  [...e.view.dom.querySelectorAll('.heading-fold-hidden')].map((el) => el.textContent)
beforeEach(() => localStorage.clear())
afterEach(() => editors.splice(0).forEach((e) => e.destroy()))

it('hides blocks up to the next heading of the same or a higher level', () => {
  const e = editor(doc)
  toggleHeadingFold(e, headingPos(e, 'One'))
  expect(hiddenText(e)).toEqual(['a', 'Sub', 'b'])
  toggleHeadingFold(e, headingPos(e, 'Two'))
  expect(hiddenText(e)).toEqual(['a', 'Sub', 'b', 'c'])
  toggleHeadingFold(e, headingPos(e, 'One'))
  expect(hiddenText(e)).toEqual(['c'])
})

it('folding never changes the document or the undo history', () => {
  const e = editor(doc)
  const before = JSON.stringify(e.getJSON())
  toggleHeadingFold(e, headingPos(e, 'One'))
  expect(JSON.stringify(e.getJSON())).toBe(before)
  expect(e.can().undo()).toBe(false)
})

it('recomputes the hidden range when the heading level changes', () => {
  const e = editor(doc)
  toggleHeadingFold(e, headingPos(e, 'Sub'))
  expect(hiddenText(e)).toEqual(['b'])
  e.chain()
    .setTextSelection(headingPos(e, 'Sub') + 1)
    .setHeading({ level: 1 })
    .run()
  expect(hiddenText(e)).toEqual(['b', 'Two', 'c'])
  e.chain()
    .setTextSelection(headingPos(e, 'Sub') + 1)
    .setParagraph()
    .run()
  expect(foldedHeadings(e.state)).toEqual([])
  expect(hiddenText(e)).toEqual([])
})

it('remembers folds per note and restores them by heading', () => {
  const first = editor(doc, 'note-a')
  toggleHeadingFold(first, headingPos(first, 'Two'))
  const again = editor(doc, 'note-a')
  expect(hiddenText(again)).toEqual(['c'])
  expect(hiddenText(editor(doc, 'note-b'))).toEqual([])
  toggleHeadingFold(again, headingPos(again, 'Two'))
  expect(hiddenText(editor(doc, 'note-a'))).toEqual([])
})

it('keeps folds when the whole document is replaced', () => {
  const e = editor(doc)
  toggleHeadingFold(e, headingPos(e, 'Two'))
  e.commands.setContent(doc + '<p>more</p>')
  expect(hiddenText(e)).toEqual(['c'])
})

it('moves the caret past a folded section instead of into it', () => {
  const e = editor(doc)
  const one = headingPos(e, 'One')
  toggleHeadingFold(e, one)
  const [range] = hiddenRanges(e.state.doc, foldedHeadings(e.state))
  e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, range.from + 1)))
  expect(e.state.selection.$from.parent.textContent).toBe('Two')
  e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, range.from + 1)))
  expect(e.state.selection.$from.parent.textContent).toBe('One')
})

it('Enter at the end of a folded heading starts the next section after it', () => {
  const e = editor(doc)
  const one = headingPos(e, 'One')
  toggleHeadingFold(e, one)
  e.commands.setTextSelection(one + 4)
  const enter = new KeyboardEvent('keydown', { key: 'Enter' })
  e.view.someProp('handleKeyDown', (handle) => handle(e.view, enter))
  const { parent } = e.state.selection.$from
  expect([parent.type.name, parent.attrs.level, parent.textContent]).toEqual(['heading', 2, ''])
  expect(e.state.doc.childAfter(e.state.selection.$from.before(1)).index).toBe(4)
  expect(hiddenText(e)).toEqual(['a', 'Sub', 'b'])
})

it('navigation unfolds the headings that hide its target', () => {
  const e = editor(doc)
  toggleHeadingFold(e, headingPos(e, 'One'))
  toggleHeadingFold(e, headingPos(e, 'Sub'))
  revealPosition(e, headingPos(e, 'Sub') + 1)
  expect(foldedHeadings(e.state)).toEqual([headingPos(e, 'Sub')])
  expect(hiddenText(e)).toEqual(['b'])
})

it('shows an arrow on top-level headings only', () => {
  const e = editor('<h2>A</h2><blockquote><h2>B</h2></blockquote>')
  const arrows = e.view.dom.querySelectorAll('.heading-fold-toggle')
  expect(arrows).toHaveLength(1)
  ;(arrows[0] as HTMLButtonElement).click()
  expect(foldedHeadings(e.state)).toEqual([0])
  expect(e.view.dom.querySelector('.heading-fold-toggle')!.getAttribute('aria-expanded')).toBe(
    'false',
  )
})
