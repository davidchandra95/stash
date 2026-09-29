// @vitest-environment jsdom
import { Editor } from '@tiptap/core'
import { afterEach, expect, it, vi } from 'vitest'
import { writingExtensions } from './extensions'
import { markdownExtensions } from './markdown'
import { editorShortcutOverrides } from './shortcuts'
const editors: Editor[] = []
Element.prototype.scrollIntoView = vi.fn()
Range.prototype.getClientRects = () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () =>
  ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }) as DOMRect
function make(markdown = false) {
  const editor = new Editor({
    extensions: markdown ? markdownExtensions : writingExtensions,
    content: '<p>hello</p>',
  })
  editors.push(editor)
  editor.commands.setTextSelection({ from: 1, to: 6 })
  return editor
}
function key(editor: Editor, key: string, extra: KeyboardEventInit = {}) {
  return editor.view.someProp('handleKeyDown', (handler) =>
    handler(editor.view, new KeyboardEvent('keydown', { key, ctrlKey: true, ...extra })),
  )
}
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()))
it('updates bindings without losing selection, content or undo history; old aliases stay disabled', () => {
  const editor = make()
  key(editor, 'b')
  expect(editor.isActive('bold')).toBe(true)
  editorShortcutOverrides.set(editor, { bold: 'Mod+Alt+b' })
  const selection = editor.state.selection.toJSON()
  key(editor, 'b')
  key(editor, 'B', { shiftKey: true })
  expect(editor.isActive('bold')).toBe(true)
  expect(editor.state.selection.toJSON()).toEqual(selection)
  key(editor, 'b', { altKey: true })
  expect(editor.isActive('bold')).toBe(false)
  editor.commands.undo()
  expect(editor.isActive('bold')).toBe(true)
  expect(editor.getText()).toBe('hello')
  editorShortcutOverrides.set(editor, { bold: null, h2: null })
  key(editor, 'b')
  key(editor, '2', { altKey: true })
  expect(editor.isActive('bold')).toBe(true)
  expect(editor.isActive('heading')).toBe(false)
})
it('ignores repeats, composition, read-only editors, and unassigned built-in mark shortcuts', () => {
  const editor = make()
  key(editor, 'b', { repeat: true })
  key(editor, 'b', { isComposing: true })
  key(editor, 'e')
  key(editor, 's', { shiftKey: true })
  key(editor, 'h', { shiftKey: true })
  expect(editor.getJSON().content?.[0].content?.[0].marks).toBeUndefined()
  editor.setEditable(false)
  key(editor, 'b')
  expect(editor.isActive('bold')).toBe(false)
})
it('honors Markdown command restrictions while retaining supported formatting', () => {
  const editor = make(true)
  key(editor, 'u')
  expect(editor.getHTML()).not.toContain('<u>')
  key(editor, 'b')
  expect(editor.isActive('bold')).toBe(true)
  editorShortcutOverrides.set(editor, { bold: null })
  key(editor, 'b')
  expect(editor.isActive('bold')).toBe(true)
})
