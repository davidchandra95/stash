// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { writingExtensions } from './extensions'
import { runCommand } from './commands'
const editors: Editor[] = []
Element.prototype.scrollIntoView = vi.fn()
Range.prototype.getClientRects = () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () => new DOMRect()
const make = (content: string) => {
  const e = new Editor({ extensions: writingExtensions, content })
  editors.push(e)
  return e
}
const key = (e: Editor, key: string, extra: KeyboardEventInit = {}) =>
  e.view.someProp('handleKeyDown', (f) =>
    f(e.view, new KeyboardEvent('keydown', { key, ...extra })),
  )
const pos = (e: Editor, text: string) => {
  let result = 0
  e.state.doc.descendants((n, p) => {
    if (n.isText && n.text === text) result = p
  })
  expect(result).toBeGreaterThan(0)
  return result
}
const select = (e: Editor, a: string, b = a) =>
  e.commands.setTextSelection({ from: pos(e, a), to: pos(e, b) + b.length })
const items = (e: Editor) => {
  const result: { kind: string; checked: boolean }[] = []
  e.state.doc.descendants((n) => {
    if (n.type.name === 'mixedListItem') result.push(n.attrs as (typeof result)[number])
  })
  return result
}
afterEach(() => editors.splice(0).forEach((e) => e.destroy()))
it('applying tasks preserves completion, converting mixed items creates unchecked tasks, and Enter is unchecked', () => {
  const e = make(
    '<ul><li data-kind="task" data-checked="true"><p>Done</p></li><li><p>Other</p></li></ul>',
  )
  select(e, 'Done')
  e.commands.setListKind('task')
  expect(items(e)[0].checked).toBe(true)
  select(e, 'Done', 'Other')
  runCommand(e, 'task')
  expect(items(e).map((i) => i.checked)).toEqual([true, false])
  e.commands.setTextSelection(pos(e, 'Done') + 4)
  key(e, 'Enter')
  expect(items(e).map((i) => i.checked)).toEqual([true, false, false])
})
it('toggling selected items preserves marks, children and neighboring numbered starts through Undo/Redo', () => {
  const e = make(
    '<ol start="5"><li><p>Before</p></li><li><p><strong>Middle</strong></p><ul><li><p>Child</p></li></ul></li><li><p>After</p></li></ol><p>Tail</p>',
  )
  const before = e.getJSON()
  select(e, 'Middle')
  expect(runCommand(e, 'number')).toBe(true)
  expect(e.state.doc.child(0).attrs.start).toBe(5)
  expect(e.state.doc.child(1).type.name).toBe('paragraph')
  expect(e.state.doc.child(1).firstChild?.marks[0].type.name).toBe('bold')
  expect(e.state.doc.child(2).textContent).toBe('Child')
  expect(e.state.doc.child(3).attrs.start).toBe(7)
  const after = e.getJSON()
  e.commands.undo()
  expect(e.getJSON()).toEqual(before)
  e.commands.redo()
  expect(e.getJSON()).toEqual(after)
})
it('handles a selection including standalone headings, paragraphs and existing checked items', () => {
  const e = make(
    '<p>Before</p><h2>Heading</h2><ul><li data-kind="task" data-checked="true"><p>Done</p></li></ul><p>After</p>',
  )
  select(e, 'Before', 'After')
  const before = e.getJSON()
  e.commands.toggleListKind('task')
  expect(items(e).map((i) => i.checked)).toEqual([false, false, true, false])
  expect(e.state.doc.textContent).toBe('BeforeHeadingDoneAfter')
  e.commands.undo()
  expect(e.getJSON()).toEqual(before)
})
it('unwraps all selected nested items without losing any content', () => {
  const e = make(
    '<ul><li><p>Parent</p><ul><li><p>Child</p></li></ul></li><li><p>Sibling</p></li></ul>',
  )
  select(e, 'Parent', 'Sibling')
  e.commands.toggleListKind('bullet')
  expect(items(e)).toEqual([])
  expect(e.state.doc.textContent).toBe('ParentChildSibling')
})
it.each(['5.', '5)'])('typed %s starts at five and avoids renumbering neighbors', (prefix) => {
  const e = make(
    '<ol start="2"><li><p>Before</p></li></ol><p></p><ol start="9"><li><p>After</p></li></ol>',
  )
  let p = 0
  e.state.doc.forEach((n, offset) => {
    if (n.type.name === 'paragraph') p = offset + 1
  })
  e.commands.setTextSelection(p)
  e.commands.insertContent(prefix)
  e.view.someProp('handleTextInput', (f) =>
    f(e.view, e.state.selection.from, e.state.selection.to, ' ', () => e.state.tr.insertText(' ')),
  )
  const lists = e.getJSON().content!.filter((n) => n.type === 'mixedList')
  expect(lists.map((n) => n.attrs?.start)).toEqual([2, 5, 9])
  expect(items(e).map((i) => i.kind)).toEqual(['number', 'number', 'number'])
})
it('cycles bullet markers by depth without saving display attributes', () => {
  const e = make(
    '<ul><li><p>One</p><ul><li><p>Two</p><ul><li><p>Three</p><ul><li><p>Four</p></li></ul></li></ul></li></ul></li></ul>',
  )
  expect(
    [...e.view.dom.querySelectorAll('[data-bullet-shape]')].map((n) =>
      n.getAttribute('data-bullet-shape'),
    ),
  ).toEqual(['disc', 'circle', 'square', 'disc'])
  expect(JSON.stringify(e.getJSON())).not.toContain('bullet-shape')
  expect(e.getHTML()).not.toContain('bullet-shape')
})
it.each([2, 3, 4])('Enter exits empty nested items one level at a time from depth %s', (depth) => {
  let html = '<ul><li><p>Deep</p></li></ul>'
  for (let i = 1; i < depth; i++) html = `<ul><li><p>Level ${i}</p>${html}</li></ul>`
  const e = make(html)
  e.commands.setTextSelection(pos(e, 'Deep') + 4)
  key(e, 'Enter')
  const listDepth = () => {
    let count = 0
    for (let d = 1; d <= e.state.selection.$from.depth; d++)
      if (e.state.selection.$from.node(d).type.name === 'mixedList') count++
    return count
  }
  expect(listDepth()).toBe(depth)
  for (let remaining = depth - 1; remaining >= 0; remaining--) {
    key(e, 'Enter')
    expect(listDepth()).toBe(remaining)
  }
  key(e, 'Backspace')
  expect(e.state.selection.$from.parent.textContent).toBe('Deep')
})
it.each([2, 3])(
  'Backspace exits an empty nested item from depth %s and returns to its previous item',
  (depth) => {
    let html = '<ul><li><p>Deep</p></li></ul>'
    for (let i = 1; i < depth; i++) html = `<ul><li><p>Level ${i}</p>${html}</li></ul>`
    const e = make(html)
    e.commands.setTextSelection(pos(e, 'Deep') + 4)
    key(e, 'Enter')
    key(e, 'Backspace')
    expect(e.state.selection.$from.parent.type.name).toBe('paragraph')
    expect(e.state.selection.$from.depth).toBe((depth - 1) * 2 + 1)
    for (let remaining = depth - 2; remaining >= 0; remaining--) {
      key(e, 'Backspace')
      expect(e.state.selection.$from.depth).toBe(remaining * 2 + 1)
    }
    key(e, 'Backspace')
    expect(e.state.selection.$from.parent.textContent).toBe('Deep')
    expect(e.state.selection.$from.parentOffset).toBe(4)
  },
)

it.each(['bullet', 'number', 'task'])(
  'typed numbering inside a %s item preserves surrounding numbers and completion',
  (kind) => {
    const e = make(
      `<ol start="2"><li><p>Before</p></li><li data-kind="${kind}"><p></p></li><li><p>After</p></li><li data-kind="task" data-checked="true"><p>Done</p></li></ol><p>Tail</p>`,
    )
    let cursor = 0
    e.state.doc.descendants((node, p) => {
      if (node.type.name === 'paragraph' && !node.content.size) cursor = p + 1
    })
    e.commands.setTextSelection(cursor)
    const before = e.getJSON()
    e.commands.insertContent('5)')
    e.view.someProp('handleTextInput', (f) =>
      f(e.view, e.state.selection.from, e.state.selection.to, ' ', () =>
        e.state.tr.insertText(' '),
      ),
    )
    expect(
      e
        .getJSON()
        .content!.filter((n) => n.type === 'mixedList')
        .map((n) => n.attrs?.start),
    ).toEqual([2, 5, kind === 'number' ? 4 : 3])
    expect(items(e).map((i) => i.kind)).toEqual(['number', 'number', 'number', 'task'])
    expect(items(e).at(-1)?.checked).toBe(true)
    const after = e.getJSON()
    e.commands.undo()
    expect(e.getJSON()).toEqual(before)
    e.commands.redo()
    expect(e.getJSON()).toEqual(after)
  },
)
