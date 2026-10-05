// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { writingExtensions } from './extensions'
import { markdownExtensions, parseMarkdown, serializeMarkdown } from './markdown'
import { replaceBodyText } from './replace'
import { documentMatches } from './searchText'
import { getEditor, clearSessions } from './session'
const editors: Editor[] = []
const make = (content: string) => {
  const e = new Editor({ extensions: writingExtensions, content })
  editors.push(e)
  return e
}
afterEach(() => {
  editors.splice(0).forEach((e) => e.destroy())
  clearSessions()
})
it('replaces across marks, inherits match-start formatting and retains surrounding structure', () => {
  const e = make(
    '<blockquote><p>before <strong>TW</strong><em>O</em> after</p></blockquote><p>Tail</p>',
  )
  const before = e.getJSON()
  expect(replaceBodyText(e, 'two', 'Three')?.count).toBe(1)
  expect(e.getHTML()).toContain(
    '<blockquote><p>before <strong>Three</strong> after</p></blockquote>',
  )
  const after = e.getJSON()
  e.commands.undo()
  expect(e.getJSON()).toEqual(before)
  e.commands.redo()
  expect(e.getJSON()).toEqual(after)
})
it('deletes repeated matches and handles replacement containing the query once per original match', () => {
  const e = make('<p>cat CAT cat</p>')
  replaceBodyText(e, 'cat', 'cat cat')
  expect(e.getText()).toBe('cat cat cat cat cat cat')
  e.commands.undo()
  expect(e.getText()).toBe('cat CAT cat')
  replaceBodyText(e, 'cat', '')
  expect(e.getText()).toBe('  ')
  e.commands.undo()
  expect(e.getText()).toBe('cat CAT cat')
})
it('each replacement is one Undo step separate from previous typing and other replacements', () => {
  const e = make('<p>cat cat</p>')
  e.commands.setTextSelection(8)
  e.commands.insertContent(' typed')
  replaceBodyText(e, 'cat', 'dog', documentMatches(e.state.doc, 'cat')[0])
  replaceBodyText(e, 'cat', 'fox', documentMatches(e.state.doc, 'cat')[0])
  expect(e.getText()).toBe('dog fox typed')
  e.commands.undo()
  expect(e.getText()).toBe('dog cat typed')
  e.commands.undo()
  expect(e.getText()).toBe('cat cat typed')
  e.commands.undo()
  expect(e.getText()).toBe('cat cat')
})
it('rechecks matches and refuses stale positions and read-only writes', () => {
  const e = make('<p>cat</p>')
  const match = documentMatches(e.state.doc, 'cat')[0]
  e.commands.insertContentAt(1, 'new ')
  const before = e.getJSON()
  expect(replaceBodyText(e, 'cat', 'dog', match)).toBeNull()
  expect(e.getJSON()).toEqual(before)
  e.setEditable(false)
  expect(replaceBodyText(e, 'cat', 'dog')).toBeNull()
  expect(e.getJSON()).toEqual(before)
})
it('never crosses paragraphs or object boundaries and keeps searchable references intact', () => {
  const e = make(
    '<p>cat<span data-type="note-reference" data-note-id="other" >cat</span>cat</p><p>ca</p><p>t</p>',
  )
  expect(documentMatches(e.state.doc, 'cat')).toHaveLength(3)
  expect(replaceBodyText(e, 'cat', 'dog')?.count).toBe(2)
  expect(documentMatches(e.state.doc, 'cat')).toHaveLength(1)
  expect(documentMatches(e.state.doc, 'cat')[0].atom).toBe(true)
  expect(documentMatches(e.state.doc, 'catdog')).toHaveLength(0)
})
it('uses the existing save callback and Markdown serialization, excluding preserved source', () => {
  const initial = parseMarkdown('cat **cat**\n\n<div>cat cat</div>'),
    saved: unknown[] = []
  const e = getEditor('linked-replace', initial, (content) => saved.push(content), true)
  expect(replaceBodyText(e, 'cat', 'dog')?.count).toBe(2)
  expect(serializeMarkdown(e.getJSON())).toContain('dog **dog**')
  expect(serializeMarkdown(e.getJSON())).toContain('<div>cat cat</div>')
  expect(saved).toHaveLength(1)
  e.commands.undo()
  expect(e.getJSON()).toEqual(initial)
  const rich = getEditor(
    'ordinary-replace',
    { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'cat' }] }] },
    (content) => saved.push(content),
  )
  replaceBodyText(rich, 'cat', 'dog')
  expect(saved).toHaveLength(3)
})
