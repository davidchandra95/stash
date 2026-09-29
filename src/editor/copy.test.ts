// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { CellSelection } from '@tiptap/pm/tables'
import { getEditor, clearSessions } from './session'
import { normalizeContent } from './clipboard'
import { writingExtensions } from './extensions'
import { type JSONContent } from '@tiptap/core'
const paragraph = (text?: string): JSONContent => ({
  type: 'paragraph',
  ...(text ? { content: [{ type: 'text', text }] } : {}),
})
const item = (...content: JSONContent[]): JSONContent => ({ type: 'mixedListItem', content })
const list = (...content: JSONContent[]): JSONContent => ({ type: 'mixedList', content })
function copy(...content: JSONContent[]) {
  const editor = getEditor('copy', { type: 'doc', content })
  editor.commands.selectAll()
  return { editor, ...editor.view.serializeForClipboard(editor.state.selection.content()) }
}
afterEach(clearSessions)
it('copies simple and nested lists without paragraph wrappers or duplicate separators', () => {
  const { editor, dom, text } = copy(
    list(item(paragraph('one')), item(paragraph('two'), list(item(paragraph('child'))))),
    paragraph('after'),
  )
  expect(dom.querySelectorAll('li > p')).toHaveLength(0)
  expect(text).toBe('- one\n- two\n    - child\nafter')
  expect(normalizeContent(dom.innerHTML, writingExtensions)).toEqual(editor.getJSON())
})
it('preserves intentional empty and multiple paragraphs, hard breaks, and code lines', () => {
  const { dom, text } = copy(
    list(
      item(paragraph('one'), paragraph(), paragraph('two')),
      item({
        type: 'paragraph',
        content: [
          { type: 'text', text: 'three' },
          { type: 'hardBreak' },
          { type: 'text', text: 'four' },
        ],
      }),
    ),
    { type: 'codeBlock', content: [{ type: 'text', text: 'code\n\nnext' }] },
    paragraph('end'),
  )
  expect(dom.querySelectorAll('li:first-child > p')).toHaveLength(3)
  expect(dom.querySelector('br')).not.toBeNull()
  expect(text).toBe('- one\n\n    two\n- three\n    four\ncode\n\nnext\nend')
})
it('preserves an empty list item and paragraph formatting', () => {
  const { dom } = copy(
    list(item(paragraph()), item({ ...paragraph('aligned'), attrs: { textAlign: 'right' } })),
    paragraph('end'),
  )
  expect(dom.querySelector('li:first-child > p')).not.toBeNull()
  expect(dom.querySelector('li:nth-child(2) > p')?.getAttribute('style')).toContain(
    'text-align: right',
  )
})
it('copies partial selections across list items without leading or duplicate newlines', () => {
  const { editor } = copy(list(item(paragraph('first')), item(paragraph('second'))))
  let from = 0,
    to = 0
  editor.state.doc.descendants((node, pos) => {
    if (node.isText) {
      if (node.text === 'first') from = pos + 2
      if (node.text === 'second') to = pos + 3
    }
  })
  editor.commands.setTextSelection({ from, to })
  const { text } = editor.view.serializeForClipboard(editor.state.selection.content())
  expect(text).toBe('- rst\n- sec')
})
it('keeps inline marks and list attributes when copied HTML is pasted back', () => {
  const { editor, dom, text } = copy(
    list(
      {
        ...item({
          type: 'paragraph',
          content: [
            { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
            { type: 'hardBreak' },
            { type: 'text', text: 'next' },
          ],
        }),
        attrs: { kind: 'task', checked: true },
      },
      { ...item(paragraph('number')), attrs: { kind: 'number', checked: false } },
    ),
    paragraph('end'),
  )
  expect(dom.querySelector('li > strong')?.textContent).toBe('bold')
  expect(text).toBe('- [x] bold\n    next\n1. number\nend')
  const target = getEditor('paste', { type: 'doc', content: [paragraph()] })
  const event = new Event('paste')
  Object.defineProperty(event, 'clipboardData', {
    value: { getData: (type: string) => (type === 'text/html' ? dom.innerHTML : text) },
  })
  target.view.someProp('handlePaste', (handler) =>
    handler(target.view, event as ClipboardEvent, editor.state.selection.content()),
  )
  expect(target.getJSON()).toEqual(editor.getJSON())
})

it('copies only selected table cells in document order', () => {
  const editor = getEditor('cells', { type: 'doc', content: [] })
  editor.commands.setContent(
    '<table><tbody><tr><td><p>one</p></td><td><p>skip one</p></td></tr><tr><td><p>two</p></td><td><p>skip two</p></td></tr></tbody></table>',
  )
  const positions: number[] = []
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'tableCell') positions.push(pos)
  })
  editor.view.dispatch(
    editor.state.tr.setSelection(
      CellSelection.create(editor.state.doc, positions[2], positions[0]),
    ),
  )
  expect(editor.view.serializeForClipboard(editor.state.selection.content()).text).toBe('one\ntwo')
})

it('preserves ordered starts, checkbox states, and deep nesting in plain text', () => {
  const { text } = copy(
    {
      ...list(
        { ...item(paragraph('seven')), attrs: { kind: 'number' } },
        {
          ...item(paragraph('todo'), list(item(paragraph('child'), list(item(paragraph('deep')))))),
          attrs: { kind: 'task', checked: false },
        },
        { ...item(paragraph('eight')), attrs: { kind: 'number' } },
      ),
      attrs: { start: 7 },
    },
    paragraph('end'),
  )
  expect(text).toBe('7. seven\n- [ ] todo\n    - child\n        - deep\n8. eight\nend')
})
it('copies a phrase inside one item as literal text without a marker', () => {
  const { editor } = copy(list(item(paragraph('first item'))))
  editor.state.doc.descendants((node, pos) => {
    if (node.isText) editor.commands.setTextSelection({ from: pos + 1, to: pos + 4 })
  })
  expect(editor.view.serializeForClipboard(editor.state.selection.content()).text).toBe('irs')
})
