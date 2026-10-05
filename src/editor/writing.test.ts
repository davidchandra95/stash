// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { writingExtensions } from './extensions'
import { getEditor, clearSessions } from './session'
import { runCommand } from './commands'
import { NodeSelection } from '@tiptap/pm/state'
import { platform } from '../platform'
const editors: Editor[] = []
Element.prototype.scrollIntoView = vi.fn()
Range.prototype.getClientRects = () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () =>
  ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }) as DOMRect
function make(content = '<p></p>') {
  const e = new Editor({ extensions: writingExtensions, content })
  editors.push(e)
  e.commands.focus('end')
  return e
}
function key(e: Editor, key: string, extra: KeyboardEventInit = {}) {
  return e.view.someProp('handleKeyDown', (f) =>
    f(e.view, new KeyboardEvent('keydown', { key, ...extra })),
  )
}
function placeCursorAfterText(e: Editor, text: string) {
  let end: number | undefined
  e.state.doc.descendants((node, pos) => {
    if (node.isText && node.text === text) end = pos + node.nodeSize
  })
  expect(end).toBeDefined()
  e.commands.setTextSelection(end!)
}
afterEach(() => {
  editors.splice(0).forEach((e) => e.destroy())
  clearSessions()
})
describe('writing contracts', () => {
  it('paints multiline text selection with inline-only view decorations', () => {
    const e = make('<p>short</p><p>longer <strong>formatted</strong> line</p><p>last</p>')
    const positions = new Map<string, number>()
    e.state.doc.descendants((node, pos) => {
      if (node.isText) positions.set(node.text!, pos)
    })
    const before = e.getJSON()

    e.commands.setTextSelection({
      from: positions.get('short')! + 2,
      to: positions.get('last')! + 4,
    })

    const highlights = [...e.view.dom.querySelectorAll('.selection-highlight')]
    expect(e.view.dom.dataset.selectionHighlight).toBe('true')
    expect(highlights.map((element) => element.textContent)).toEqual([
      'ort',
      'longer ',
      'formatted',
      ' line',
      'last',
    ])
    expect(highlights.every((element) => element.tagName === 'SPAN')).toBe(true)
    expect(e.view.dom.querySelector('p.selection-highlight')).toBeNull()
    expect(
      e.view
        .serializeForClipboard(e.state.selection.content())
        .dom.querySelector('.selection-highlight'),
    ).toBeNull()
    expect(e.getJSON()).toEqual(before)

    e.commands.setTextSelection({
      from: positions.get('last')! + 4,
      to: positions.get('short')! + 2,
    })
    expect(
      [...e.view.dom.querySelectorAll('.selection-highlight')].map(
        (element) => element.textContent,
      ),
    ).toEqual(['ort', 'longer ', 'formatted', ' line', 'last'])

    e.commands.setTextSelection(positions.get('short')!)
    expect(e.view.dom.dataset.selectionHighlight).toBeUndefined()
    expect(e.view.dom.querySelector('.selection-highlight')).toBeNull()

    e.commands.selectAll()
    expect(e.view.dom.dataset.selectionHighlight).toBe('true')
    expect(e.view.dom.querySelectorAll('.selection-highlight')).toHaveLength(5)

    e.commands.insertContent('replacement')
    expect(e.getText()).toBe('replacement')
    expect(e.commands.undo()).toBe(true)
    expect(e.getJSON()).toEqual(before)
  })

  it('keeps node selections and mobile text selections native', () => {
    const e = make('<p>before</p><hr><p>after</p>')
    let rulePosition: number | undefined
    e.state.doc.descendants((node, pos) => {
      if (node.type.name === 'horizontalRule') rulePosition = pos
    })
    expect(rulePosition).toBeDefined()
    e.view.dispatch(e.state.tr.setSelection(NodeSelection.create(e.state.doc, rulePosition!)))
    expect(e.view.dom.dataset.selectionHighlight).toBeUndefined()
    expect(e.view.dom.querySelector('.selection-highlight')).toBeNull()

    const wasMobile = platform.mobile
    try {
      platform.mobile = true
      const mobile = getEditor('mobile-selection', {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'mobile text' }] }],
      })
      mobile.commands.setTextSelection({ from: 1, to: 7 })
      expect(mobile.view.dom.dataset.selectionHighlight).toBeUndefined()
      expect(mobile.view.dom.querySelector('.selection-highlight')).toBeNull()
    } finally {
      platform.mobile = wasMobile
    }
  })

  it('selects list text without highlighting markers or changing copied list text', () => {
    const e = make(
      '<ul><li><p>one</p></li><li><p>two</p></li><li><p>three</p></li><li><p>four</p></li><li data-kind="number"><p>five</p></li><li data-kind="task"><p>six</p></li></ul>',
    )
    const textPositions = new Map<string, number>()
    e.state.doc.descendants((node, pos) => {
      if (node.isText) textPositions.set(node.text!, pos)
    })
    const selected = () =>
      [...e.view.dom.querySelectorAll('li.selection-has-text')].map(
        (item) => item.querySelector(':scope > div > p')?.textContent,
      )
    const before = e.getJSON()

    e.commands.setTextSelection({
      from: textPositions.get('one')!,
      to: textPositions.get('four')! + 4,
    })
    expect(selected()).toEqual([])
    expect(e.view.dom.querySelector('.selection-highlight')?.textContent).toBe('one')
    expect(e.view.serializeForClipboard(e.state.selection.content()).text).toBe(
      '- one\n- two\n- three\n- four',
    )

    e.commands.setTextSelection({
      from: textPositions.get('five')! + 1,
      to: textPositions.get('five')! + 3,
    })
    expect(selected()).toEqual([])
    expect(e.view.dom.querySelector('.selection-highlight')?.textContent).toBe('iv')
    e.commands.setTextSelection({
      from: textPositions.get('six')!,
      to: textPositions.get('six')! + 2,
    })
    expect(selected()).toEqual([])
    e.commands.setTextSelection(textPositions.get('one')!)
    expect(selected()).toEqual([])
    expect(e.getJSON()).toEqual(before)
  })

  it('copies paragraphs with single newlines and preserves intentional breaks', () => {
    const e = getEditor('copy-spacing', {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'first' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'second' }] },
        { type: 'paragraph' },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'third' },
            { type: 'hardBreak' },
            { type: 'text', text: 'fourth' },
          ],
        },
        { type: 'codeBlock', content: [{ type: 'text', text: 'code\n\nnext' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'last' }] },
      ],
    })
    e.commands.selectAll()
    const copied = e.view.serializeForClipboard(e.state.selection.content())
    expect(copied.text).toBe('first\nsecond\n\nthird\nfourth\ncode\n\nnext\nlast')
    expect(copied.dom.querySelectorAll('p')).toHaveLength(5)
    expect(copied.dom.querySelector('br')).not.toBeNull()
  })
  it('retains paragraphs and intentional blank lines', () => {
    const e = make('<p>one</p>')
    key(e, 'Enter')
    key(e, 'Enter')
    e.commands.insertContent('three')
    expect(e.getJSON().content?.map((n) => n.type)).toEqual(['paragraph', 'paragraph', 'paragraph'])
    expect(e.getJSON().content?.[1].content).toBeUndefined()
  })
  it('Shift Enter adds a break and heading Enter returns to text', () => {
    const e = make('<h2>Title</h2>')
    key(e, 'Enter', { shiftKey: true })
    expect(e.getJSON().content?.[0].content?.[1].type).toBe('hardBreak')
    key(e, 'Enter')
    expect(e.getJSON().content?.[1].type).toBe('paragraph')
  })
  it('code keeps repeated newlines and exits explicitly', () => {
    const e = make('<pre><code>x</code></pre>')
    key(e, 'Enter')
    key(e, 'Enter')
    key(e, 'Enter')
    expect(e.state.doc.firstChild?.textContent).toBe('x\n\n\n')
    key(e, 'Enter', { ctrlKey: true })
    expect(e.getJSON().content?.[1].type).toBe('paragraph')
  })
  it('Tab and Shift Tab insert and remove ordinary tabs', () => {
    const e = make('<p>x</p>')
    key(e, 'Tab')
    expect(e.getText()).toBe('x\t')
    key(e, 'Tab', { shiftKey: true })
    expect(e.getText()).toBe('x')
  })
  it('empty quote paragraph exits exactly one quote', () => {
    const e = make('<blockquote><blockquote><p></p></blockquote></blockquote>')
    key(e, 'Enter')
    expect(e.getJSON().content?.[0].type).toBe('blockquote')
    expect(e.getJSON().content?.[0].content?.[0].type).toBe('paragraph')
  })
  it('slash dismissal preserves input and command selection removes only command', () => {
    const e = make()
    e.commands.insertContent('/hea')
    key(e, 'Escape')
    expect(e.getText()).toBe('/hea')
    key(e, 'Enter')
    expect(e.getJSON().content?.[0].type).toBe('paragraph')
    e.commands.insertContent('/heading 2')
    key(e, 'Enter')
    expect(e.getJSON().content?.[1].type).toBe('heading')
    expect(e.getText()).not.toContain('/heading')
  })
  it('does not trigger slash inside code or paths', () => {
    const e = make('<pre><code>/heading</code></pre>')
    key(e, 'Enter')
    expect(e.getJSON().content?.[0].type).toBe('codeBlock')
    e.commands.setContent('<p>/usr/bin</p>')
    e.commands.focus('end')
    key(e, 'Enter')
    expect(e.getJSON().content?.[0].type).toBe('paragraph')
  })
  it('pastes markdown as one undo step, sanitizes HTML, code stays literal', () => {
    const e = make('<p>Before</p>')
    const paste = (text: string, html = '') =>
      e.view.someProp('handlePaste', (f) =>
        f(
          e.view,
          {
            clipboardData: { getData: (t: string) => (t === 'text/html' ? html : text) },
          } as ClipboardEvent,
          {} as never,
        ),
      )
    paste('# Title\n\n**Bold**')
    expect(e.getHTML()).toContain('<strong>Bold</strong>')
    e.commands.undo()
    expect(e.getText()).toBe('Before')
    paste('safe', '<p onclick="bad()">safe<script>alert(1)</script></p>')
    expect(e.getHTML()).not.toMatch(/script|onclick/)
    e.commands.setContent('<pre><code>x</code></pre>')
    e.commands.setTextSelection(2)
    paste('**literal**')
    expect(e.getText()).toContain('**literal**')
  })
  it('retains per-note selection and undo', () => {
    const a = getEditor('a', { type: 'doc', content: [{ type: 'paragraph' }] })
    a.commands.insertContent('alpha')
    a.commands.setTextSelection(3)
    const b = getEditor('b', { type: 'doc', content: [{ type: 'paragraph' }] })
    b.commands.insertContent('beta')
    expect(getEditor('a', a.getJSON())).toBe(a)
    expect(a.state.selection.from).toBe(3)
    a.commands.undo()
    expect(a.getText()).toBe('')
    expect(b.getText()).toBe('beta')
  })
  it('registry supports toolbar and slash using the same action', () => {
    const e = make()
    expect(runCommand(e, 'h2')).toBe(true)
    expect(e.isActive('heading', { level: 2 })).toBe(true)
  })
})
describe('rich content', () => {
  it('mixes list styles at one level and continues nesting', () => {
    const e = make('<ol><li><p>First</p></li></ol>')
    key(e, 'Enter')
    runCommand(e, 'task')
    e.commands.insertContent('Check')
    key(e, 'Enter')
    runCommand(e, 'number')
    e.commands.insertContent('Second')
    const list = e.getJSON().content?.[0]
    expect(list?.content?.map((n) => ('attrs' in n ? n.attrs?.kind : null))).toEqual([
      'number',
      'task',
      'number',
    ])
    key(e, 'Tab')
    expect(e.getHTML()).toContain('<ul')
    key(e, 'Tab', { shiftKey: true })
    expect(e.state.doc.firstChild?.childCount).toBe(3)
  })
  it('new checklist item is unchecked and empty item exits', () => {
    const e = make(
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Done</p></li></ul>',
    )
    key(e, 'Enter')
    expect(e.state.doc.firstChild?.child(1).attrs.checked).toBe(false)
    key(e, 'Enter')
    expect(e.state.selection.$from.parent.type.name).toBe('paragraph')
    expect(e.state.selection.$from.depth).toBe(1)
  })
  it.each(['bullet', 'number', 'task'] as const)(
    'Backspace on a new empty %s list item exits to a normal paragraph',
    (kind) => {
      const e = make(`<ul><li data-kind="${kind}"><p>Item</p></li></ul><p>After</p>`)
      placeCursorAfterText(e, 'Item')

      key(e, 'Enter')
      key(e, 'Backspace')

      expect(e.getJSON().content?.map((node) => node.type)).toEqual([
        'mixedList',
        'paragraph',
        'paragraph',
      ])
      expect(e.state.doc.firstChild?.childCount).toBe(1)
      expect(e.state.selection.$from.parent.type.name).toBe('paragraph')
      expect(e.state.selection.$from.depth).toBe(1)
      expect(e.isActive('mixedListItem')).toBe(false)
    },
  )
  it.each(['bullet', 'number', 'task'] as const)(
    'Backspace after exiting a %s list returns to the previous list item',
    (kind) => {
      const e = make(`<ul><li data-kind="${kind}"><p>Item</p></li></ul><p>After</p>`)
      placeCursorAfterText(e, 'Item')

      key(e, 'Enter')
      key(e, 'Enter')
      expect(e.state.selection.$from.depth).toBe(1)
      key(e, 'Backspace')

      expect(e.getJSON().content?.map((node) => node.type)).toEqual(['mixedList', 'paragraph'])
      expect(e.state.doc.firstChild?.childCount).toBe(1)
      expect(e.state.doc.lastChild?.textContent).toBe('After')
      expect(e.state.selection.$from.parent.textContent).toBe('Item')
      expect(e.state.selection.$from.parentOffset).toBe('Item'.length)
      expect(e.isActive('mixedListItem', { kind })).toBe(true)
    },
  )
  it('retains combined formatting in headings, links, rich cells and colored quotes', () => {
    const e = make(
      '<blockquote style="background-color:rgba(30,80,100,.2)"><table><tbody><tr><td><h2><a href="https://example.com"><strong><em>Linked heading</em></strong></a></h2><ul><li><p>List in cell</p></li></ul></td></tr></tbody></table></blockquote>',
    )
    const json = e.getJSON()
    const copy = new Editor({ extensions: writingExtensions, content: json })
    editors.push(copy)
    expect(copy.getJSON()).toEqual(json)
    expect(copy.getHTML()).toContain('<strong><em>')
    expect(copy.getHTML()).toContain('background-color')
    expect(copy.getHTML()).toContain('<h2')
  })
  it('supports inline checkbox beside heading text and retains state', () => {
    const e = make('<h2>Checklist title </h2>')
    runCommand(e, 'checkbox')
    expect(e.state.doc.firstChild?.lastChild?.type.name).toBe('inlineCheckbox')
    expect(e.getHTML()).toContain('data-checked="false"')
  })
  it('table Tab navigation and cell styling preserve content', () => {
    const e = make()
    runCommand(e, 'table')
    const before = e.state.selection.from
    key(e, 'Tab')
    expect(e.state.selection.from).toBeGreaterThan(before)
    key(e, 'Tab', { shiftKey: true })
    expect(e.state.selection.from).toBe(before)
    e.commands.setCellAttribute('backgroundColor', '#64ae7040')
    expect(e.getHTML()).toContain('background-color')
  })
  it('does not intercept composition keystrokes', () => {
    const e = make('<p>/h2</p>')
    e.view.dom.dispatchEvent(new CompositionEvent('compositionstart'))
    e.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }),
    )
    expect(e.getText()).toBe('/h2')
    e.view.dom.dispatchEvent(new CompositionEvent('compositionend'))
  })
})
describe('rich collapsibles', () => {
  it('header Enter moves to body and empty body Enter exits', () => {
    const e = make()
    runCommand(e, 'collapsible')
    e.commands.insertContent('Header')
    key(e, 'Enter')
    expect(e.isActive('collapsibleBody')).toBe(true)
    e.commands.insertContent('Body')
    key(e, 'Enter')
    expect(e.isActive('collapsibleBody')).toBe(true)
    key(e, 'Enter')
    expect(e.isActive('collapsible')).toBe(false)
    expect(e.getText()).toContain('Body')
  })
  it('header Shift Enter stays in the same rich header', () => {
    const e = make()
    runCommand(e, 'collapsible')
    e.commands.insertContent('Header')
    key(e, 'Enter', { shiftKey: true })
    e.commands.insertContent('second line')
    expect(e.isActive('collapsibleHeader')).toBe(true)
    expect(e.getHTML()).toContain('<br>')
  })
  it('wrapping and unwrapping preserve selected content', () => {
    const e = make(
      '<p><strong>Keep this</strong></p><blockquote><p>And this quote</p></blockquote>',
    )
    e.commands.selectAll()
    expect(runCommand(e, 'wrap')).toBe(true)
    expect(e.getHTML()).toContain('<strong>Keep this</strong>')
    expect(runCommand(e, 'unwrap')).toBe(true)
    expect(e.getHTML()).not.toContain('data-type="collapsible"')
    expect(e.getText()).toContain('And this quote')
  })
  it('collapse hides only the body and moves selection out of hidden content', () => {
    const e = make()
    runCommand(e, 'collapsible')
    e.commands.insertContent('Title')
    key(e, 'Enter')
    e.commands.insertContent('Inside')
    key(e, 'Enter', { ctrlKey: true })
    e.commands.insertContent('Outside')
    e.commands.setTextSelection(3)
    runCommand(e, 'toggle-section')
    expect(e.state.doc.firstChild?.attrs.collapsed).toBe(true)
    expect(e.getText()).toContain('Outside')
    runCommand(e, 'expand-all')
    expect(e.state.doc.firstChild?.attrs.collapsed).toBe(false)
  })
})
it('round-trips the original nesting fixture through JSON and sanitized HTML', async () => {
  const { richWritingFixture } = await import('./fixtures')
  const { normalizeContent } = await import('./clipboard')
  const json = normalizeContent(richWritingFixture, writingExtensions)
  const e = new Editor({ extensions: writingExtensions, content: json })
  editors.push(e)
  const round = normalizeContent(e.getHTML(), writingExtensions)
  expect(round).toEqual(json)
  e.commands.setTextSelection(3)
  e.commands.insertContent('Edited ')
  const copy = new Editor({ extensions: writingExtensions, content: e.getJSON() })
  editors.push(copy)
  expect(copy.getJSON()).toEqual(e.getJSON())
  expect(copy.getText()).toContain('Edited')
})
it('plain paste shortcut preserves literal Markdown', () => {
  const e = make()
  key(e, 'v', { ctrlKey: true, shiftKey: true })
  e.view.someProp('handlePaste', (f) =>
    f(
      e.view,
      {
        clipboardData: {
          getData: (type: string) =>
            type === 'text/plain' ? '**literal**\n# heading' : '<h1>rich</h1>',
        },
      } as ClipboardEvent,
      {} as never,
    ),
  )
  expect(e.getText()).toContain('**literal**')
  expect(e.getHTML()).not.toContain('<h1>')
})
it('unmatched slash and mouse choice preserve or replace only the command', () => {
  const e = make()
  e.commands.insertContent('/unknown')
  key(e, 'Enter')
  expect(e.getText()).toContain('/unknown')
  e.commands.insertContent('/heading 3')
  const option = Array.from(document.querySelectorAll('.slash-menu button')).find(
    (b) => b.getAttribute('aria-label') === 'Heading / H3',
  ) as HTMLButtonElement
  expect(option).toBeTruthy()
  option.click()
  expect(e.isActive('heading', { level: 3 })).toBe(true)
  expect(e.getText()).toContain('/unknown')
  expect(e.getText()).not.toContain('/heading')
})
it('inserts a dropped local image at the drop point and undoes it separately', async () => {
  const e = make('<p>before</p>')
  vi.spyOn(e.view, 'posAtCoords').mockReturnValue({ pos: 1, inside: -1 })
  const file = new File([new Uint8Array([137, 80, 78, 71])], 'test.png', { type: 'image/png' })
  const handled = e.view.someProp('handleDrop', (f) =>
    f(
      e.view,
      { dataTransfer: { files: [file] }, clientX: 0, clientY: 0 } as unknown as DragEvent,
      {} as never,
      false,
    ),
  )
  expect(handled).toBe(true)
  await vi.waitFor(() => expect(e.state.doc.firstChild?.firstChild?.type.name).toBe('image'))
  expect(e.state.doc.firstChild?.firstChild?.attrs.src).toMatch(/^data:image\/png;base64,/)
  e.commands.undo()
  expect(e.getText()).toBe('before')
  expect(e.getHTML()).not.toContain('<img')
})
it('rich HTML wins when the clipboard also carries an image file', () => {
  const e = make()
  const file = new File(['image'], 'test.png', { type: 'image/png' })
  const data = {
    files: [file],
    getData: (type: string) =>
      type === 'text/html' ? '<p><strong>Keep caption</strong></p>' : 'Keep caption',
  }
  e.view.someProp('handlePaste', (f) =>
    f(e.view, { clipboardData: data } as unknown as ClipboardEvent, {} as never),
  )
  expect(e.getHTML()).toContain('<strong>Keep caption</strong>')
})
it('empty list inside a quote exits the list before the quote', () => {
  const e = make('<blockquote><ul><li><p>item</p></li></ul></blockquote>')
  key(e, 'Enter')
  key(e, 'Enter')
  expect(e.isActive('blockquote')).toBe(true)
  expect(e.isActive('mixedList')).toBe(false)
})
it('slash commands take precedence over heading Enter', () => {
  const e = make('<h2></h2>')
  e.commands.insertContent('/paragraph')
  key(e, 'Enter')
  expect(e.isActive('paragraph')).toBe(true)
  expect(e.state.doc.firstChild?.textContent).toBe('')
})
it('changing a nested list style leaves its parent unchanged', () => {
  const e = make('<ol><li><p>Parent</p><ul><li><p>Child</p></li></ul></li></ol>')
  runCommand(e, 'task')
  expect(e.state.doc.firstChild?.firstChild?.attrs.kind).toBe('number')
  expect(e.state.doc.firstChild?.firstChild?.lastChild?.firstChild?.attrs.kind).toBe('task')
})
it('code inside a list keeps Enter and Tab inside code', () => {
  const e = make('<ul><li><p>Snippet</p><pre><code>x</code></pre></li></ul>')
  let pos = 0
  e.state.doc.descendants((node, p) => {
    if (node.type.name === 'codeBlock') pos = p + 2
  })
  e.commands.setTextSelection(pos)
  key(e, 'Enter')
  key(e, 'Enter', { shiftKey: true })
  key(e, 'Tab')
  expect(e.isActive('codeBlock')).toBe(true)
  expect(e.state.doc.firstChild?.childCount).toBe(1)
  expect(e.state.selection.$from.parent.textContent).toContain('x\n\n')
})
it('native plain paste preserves literal text and is a separate undo step', async () => {
  const { pastePlain } = await import('./plainPaste')
  const e = make('<p>Before</p>')
  await pastePlain(e, async () => '**literal**\n# plain heading')
  expect(e.getText()).toContain('**literal**')
  expect(e.getHTML()).not.toContain('<h1>')
  e.commands.undo()
  expect(e.getText()).toBe('Before')
})
it('session updates still reach the note model after switching away', () => {
  const changed = vi.fn()
  const a = getEditor('a', { type: 'doc', content: [{ type: 'paragraph' }] }, changed)
  getEditor('b', { type: 'doc', content: [{ type: 'paragraph' }] })
  a.commands.insertContent('Finished async image caption')
  expect(changed).toHaveBeenLastCalledWith(a.getJSON(), a.getText())
})
it('merges and splits a real multi-cell selection', async () => {
  const { CellSelection } = await import('@tiptap/pm/tables')
  const e = make()
  runCommand(e, 'table')
  const cells: number[] = []
  e.state.doc.descendants((node, pos) => {
    if (node.type.name === 'tableHeader') cells.push(pos)
  })
  e.view.dispatch(e.state.tr.setSelection(CellSelection.create(e.state.doc, cells[0], cells[1])))
  expect(runCommand(e, 'merge-cells')).toBe(true)
  expect(e.state.doc.firstChild?.firstChild?.childCount).toBe(2)
  expect(runCommand(e, 'split-cell')).toBe(true)
  expect(e.state.doc.firstChild?.firstChild?.childCount).toBe(3)
})
describe('UpNote-style slash navigation and checkboxes', () => {
  const options = () =>
    Array.from(document.querySelectorAll('.slash-menu:not([hidden]) .slash-option'))
  it('opens categories, drills into headings, and returns with Left', () => {
    const e = make()
    e.commands.insertContent('/')
    expect(options()[0].getAttribute('aria-label')).toBe('Heading')
    key(e, 'ArrowRight')
    expect(options().map((o) => o.getAttribute('aria-label'))).toContain('H2')
    key(e, 'ArrowLeft')
    expect(options()[0].getAttribute('aria-label')).toBe('Heading')
    key(e, 'Enter')
    key(e, 'ArrowDown')
    key(e, 'Enter')
    expect(e.isActive('heading', { level: 2 })).toBe(true)
    expect(e.getText()).not.toContain('/')
  })
  it('filters nested actions with their category path after ordinary text', () => {
    const e = make('<p>Remember</p>')
    e.commands.insertContent(' /check')
    expect(options().some((o) => o.getAttribute('aria-label') === 'List / Checklist')).toBe(true)
    key(e, 'Enter')
    expect(e.getText()).toContain('Remember')
    expect(e.getText()).not.toContain('/check')
    expect(e.isActive('mixedListItem', { kind: 'task' })).toBe(true)
  })
  it('opens table sizes and inserts the chosen size', () => {
    const e = make()
    e.commands.insertContent('/')
    ;(options().find((o) => o.getAttribute('aria-label') === 'Table') as HTMLButtonElement).click()
    expect(options().map((o) => o.getAttribute('aria-label'))).toContain('4x4')
    ;(options().find((o) => o.getAttribute('aria-label') === '4x4') as HTMLButtonElement).click()
    expect(e.state.doc.firstChild?.childCount).toBe(4)
    expect(e.state.doc.firstChild?.firstChild?.childCount).toBe(4)
  })
  it('keeps text when a submenu is dismissed and ignores paths and inline code', () => {
    const e = make()
    e.commands.insertContent('Keep /')
    key(e, 'ArrowRight')
    key(e, 'Escape')
    expect(e.getText()).toBe('Keep /')
    e.commands.setContent('<p>https://example.com/path</p>')
    e.commands.focus('end')
    expect(options()).toHaveLength(0)
    e.commands.setContent('<p><code>/heading</code></p>')
    e.commands.setTextSelection(4)
    expect(options()).toHaveLength(0)
  })
  it('draws both checkbox types consistently and preserves toggling and undo', () => {
    const e = make(
      '<p><span data-type="inlineCheckbox" data-checked="false">☐</span> Inline</p><ul><li data-kind="task"><p>Task</p></li></ul>',
    )
    const inline = e.view.dom.querySelector<HTMLButtonElement>('.inline-checkbox')!,
      task = e.view.dom.querySelector<HTMLButtonElement>('[data-kind="task"] > .list-marker')!
    expect(inline.querySelector('.checkbox-box svg')).toBeTruthy()
    expect(task.querySelector('.checkbox-box svg')).toBeTruthy()
    inline.click()
    expect(inline.getAttribute('aria-checked')).toBe('true')
    e.commands.undo()
    expect(inline.getAttribute('aria-checked')).toBe('false')
    task.click()
    expect(task.getAttribute('aria-checked')).toBe('true')
  })
})

describe('paste joins the text at the cursor', () => {
  const paste = (e: Editor, text: string, html = '') =>
    e.view.someProp('handlePaste', (handler) =>
      handler(
        e.view,
        {
          clipboardData: { getData: (type: string) => (type === 'text/html' ? html : text) },
        } as ClipboardEvent,
        {} as never,
      ),
    )

  it.each(['', '<p>sample-value</p>', '<span>sample-value</span>'])(
    'keeps a single value beside its label with HTML %s',
    (html) => {
      const e = make('<p>id:</p>')
      e.commands.setTextSelection(4)
      e.commands.insertContent(' ')
      e.commands.setTextSelection(5)
      paste(e, 'sample-value', html)
      expect(e.getHTML()).toBe('<p>id: sample-value</p>')
      e.commands.undo()
      expect(e.getHTML()).toBe('<p>id: </p>')
      e.commands.redo()
      expect(e.getHTML()).toBe('<p>id: sample-value</p>')
    },
  )

  it('replaces selected text and preserves pasted formatting', () => {
    const e = make('<p>before old after</p>')
    e.commands.setTextSelection({ from: 8, to: 11 })
    paste(e, 'new', '<p><strong>new</strong></p>')
    expect(e.getHTML()).toBe('<p>before <strong>new</strong> after</p>')
  })

  it('joins multiline paragraph edges without extra blank paragraphs', () => {
    const e = make('<p>before after</p>')
    e.commands.setTextSelection(8)
    paste(e, 'one\n\ntwo')
    expect(e.getHTML()).toBe('<p>before one</p><p>twoafter</p>')
  })

  it('keeps native plain paste inline and preserves literal characters', async () => {
    const { pastePlain } = await import('./plainPaste')
    const e = make('<p>id:</p>')
    e.commands.setTextSelection(4)
    e.commands.insertContent(' ')
    e.commands.setTextSelection(5)
    await pastePlain(e, async () => '**value**')
    expect(e.getHTML()).toBe('<p>id: **value**</p>')
  })

  it('keeps fallback plain paste inline', () => {
    const e = make('<p>id:</p>')
    e.commands.setTextSelection(4)
    e.commands.insertContent(' ')
    e.commands.setTextSelection(5)
    key(e, 'v', { ctrlKey: true, shiftKey: true })
    paste(e, '**value**', '<strong>value</strong>')
    expect(e.getHTML()).toBe('<p>id: **value**</p>')
  })
})
