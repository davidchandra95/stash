// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { Editor, getSchema } from '@tiptap/core'
import { writingExtensions } from './extensions'
import {
  NoteReference,
  noteSuggestions,
  referenceMatch,
  setNoteLinkContext,
  type NoteCandidate,
} from './noteReferences'
import { normalizeContent } from './clipboard'
const editors: Editor[] = []
Element.prototype.scrollIntoView = vi.fn()
Range.prototype.getClientRects = () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () =>
  ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }) as DOMRect
const candidates: NoteCandidate[] = [
  { id: 'a', title: 'Alpha', notebook: 'Work', updated: 2, trashed: false },
  { id: 'b', title: 'Alpha', notebook: 'Personal', updated: 1, trashed: false },
  { id: 'c', title: 'Alpha plans', notebook: '', updated: 3, trashed: false },
  { id: 'd', title: 'Meet Alpha', notebook: '', updated: 4, trashed: false },
  { id: 'e', title: 'Alpha trash', notebook: '', updated: 5, trashed: true },
  { id: 'f', title: '', notebook: '', updated: 6, trashed: false },
  { id: 'g', title: '日本語 café', notebook: '', updated: 7, trashed: false },
]
function make(content = '<p></p>') {
  const e = new Editor({ extensions: writingExtensions, content })
  editors.push(e)
  e.commands.setTextSelection(e.state.doc.content.size - 1)
  const create = vi.fn((title: string) => ({ ...candidates[0], id: 'new', title }))
  const open = vi.fn()
  setNoteLinkContext(e, { notes: () => candidates, create, open })
  return { e, create, open }
}
function key(e: Editor, key: string, extra: KeyboardEventInit = {}) {
  return e.view.someProp('handleKeyDown', (f) =>
    f(e.view, new KeyboardEvent('keydown', { key, ...extra })),
  )
}
afterEach(() => editors.splice(0).forEach((e) => e.destroy()))
it('ranks titles, includes duplicates and untitled, excludes trash, supports Unicode', () => {
  expect(noteSuggestions(candidates, 'ALPHA').map((n) => n.id)).toEqual(['a', 'b', 'c', 'd'])
  expect(noteSuggestions(candidates, '')[0].id).toBe('g')
  expect(noteSuggestions(candidates, 'untitled')[0].id).toBe('f')
  expect(noteSuggestions(candidates, '日本')[0].id).toBe('g')
})
it('renders note and create suggestions as compact title-detail rows', () => {
  make('<p>[[Alpha</p>')
  const note = document.querySelector<HTMLButtonElement>('.note-link-option')!
  expect(note.querySelector('.note-link-title')?.textContent).toBe('Alpha')
  expect(note.querySelector('.note-link-separator')?.textContent).toBe('·')
  expect(note.querySelector('.note-link-separator')?.getAttribute('aria-hidden')).toBe('true')
  expect(note.querySelector('.note-link-detail')?.textContent).toBe('Work')
})
it('renders create suggestions with one-line detail text', () => {
  make('<p>[[New</p>')
  const create = document.querySelector<HTMLButtonElement>('.note-link-option')!
  expect(create.querySelector('.note-link-title')?.textContent).toBe('Create “New”')
  expect(create.querySelector('.note-link-separator')?.textContent).toBe('·')
  expect(create.querySelector('.note-link-detail')?.textContent).toBe('Create a new note')
})
it('inserts by keyboard at inline trigger and separates undo from subsequent typing', () => {
  const { e } = make('<p>Before [[Alpha</p>')
  key(e, 'ArrowDown')
  key(e, 'Enter')
  expect(e.getJSON().content?.[0].content?.[1]).toMatchObject({
    type: 'noteReference',
    attrs: { noteId: 'b' },
  })
  expect(e.getText()).toBe('Before Alpha')
  e.commands.insertContent(' after')
  e.commands.undo()
  expect(e.getText()).toBe('Before Alpha')
  e.commands.undo()
  expect(e.getText()).toBe('Before [[Alpha')
  e.commands.redo()
  expect(e.getText()).toBe('Before Alpha')
})
it('mouse selection retains range, consumes closing brackets, and preserves following text', () => {
  const { e } = make('<p>[[Alpha]] suffix</p>')
  e.commands.setTextSelection(8)
  document.querySelectorAll<HTMLButtonElement>('.note-link-option')[1].click()
  expect(e.getText()).toBe('Alpha suffix')
  expect(e.getJSON().content?.[0].content?.[0]).toMatchObject({ attrs: { noteId: 'b' } })
})
it.each(['<p>[[Alpha]</p>', '<p>[[Alpha]]</p>'])(
  'keeps suggestions open through valid closing brackets: %s',
  (content) => {
    const { e } = make(content)
    expect(referenceMatch(e)).toMatchObject({ query: 'Alpha' })
    expect(document.querySelector<HTMLDivElement>('.note-link-menu')?.hidden).toBe(false)
    key(e, 'Enter')
    expect(e.getText()).toBe('Alpha')
    expect(e.getJSON().content?.[0].content?.[0]).toMatchObject({ attrs: { noteId: 'a' } })
  },
)
it('mouse selection replaces a typed closing bracket', () => {
  const { e } = make('<p>[[Alpha]</p>')
  document.querySelectorAll<HTMLButtonElement>('.note-link-option')[1].click()
  expect(e.getText()).toBe('Alpha')
  expect(e.getJSON().content?.[0].content?.[0]).toMatchObject({ attrs: { noteId: 'b' } })
})
it.each(['<p>[[Alpha]]]</p>', '<p>[[Alpha]<><</p>', '<p>[[Alpha[</p>'])(
  'hides suggestions for malformed note-link syntax: %s',
  (content) => {
    const { e } = make(content)
    expect(referenceMatch(e)).toBeNull()
    expect(document.querySelector<HTMLDivElement>('.note-link-menu')?.hidden).toBe(true)
  },
)
it('Escape keeps trigger and further typing literal until a new trigger', () => {
  const { e, create } = make('<p>[[New</p>')
  key(e, 'Escape')
  e.commands.insertContent(' title')
  expect(document.querySelector<HTMLDivElement>('.note-link-menu')?.hidden).toBe(true)
  expect(e.getText()).toBe('[[New title')
  expect(create).not.toHaveBeenCalled()
  e.commands.insertContent(' [[Other')
  key(e, 'Enter')
  expect(create).toHaveBeenCalledWith('Other')
})
it('creates a missing note only on selection and undo leaves it created', () => {
  const { e, create } = make('<p>[[New title</p>')
  expect(create).not.toHaveBeenCalled()
  key(e, 'Enter')
  expect(create).toHaveBeenCalledExactlyOnceWith('New title')
  e.commands.undo()
  expect(create).toHaveBeenCalledTimes(1)
  expect(e.getText()).toBe('[[New title')
})
it.each(['<p>\\[[Alpha</p>', '<p><code>[[Alpha</code></p>', '<pre><code>[[Alpha</code></pre>'])(
  'ignores literal context %s',
  (content) => {
    const { e } = make(content)
    expect(referenceMatch(e)).toBeNull()
  },
)
it('does not select while composing', () => {
  const { e, create } = make('<p>[[New</p>')
  key(e, 'Enter', { isComposing: true })
  expect(create).not.toHaveBeenCalled()
})
it.each([
  '<h2>[[Alpha</h2>',
  '<blockquote><p>[[Alpha</p></blockquote>',
  '<ul><li><p>[[Alpha</p></li></ul>',
  '<table><tbody><tr><td><p>[[Alpha</p></td></tr></tbody></table>',
  '<section data-type="collapsible"><div data-type="collapsibleHeader"><p>Header</p></div><div data-type="collapsibleBody"><p>[[Alpha</p></div></section>',
])('supports nested text %s', (content) => {
  const { e } = make(content)
  let pos = 0
  e.state.doc.descendants((node, at) => {
    if (node.isText && node.text?.includes('[[Alpha')) pos = at + node.nodeSize
  })
  e.commands.setTextSelection(pos)
  key(e, 'Enter')
  expect(JSON.stringify(e.getJSON())).toContain('noteReference')
})
it('updates displayed label and clipboard text without changing JSON or history', () => {
  const { e, open } = make('<p>[[Alpha</p>')
  key(e, 'Enter')
  const before = e.getJSON()
  setNoteLinkContext(e, {
    notes: () => candidates.map((n) => (n.id === 'a' ? { ...n, title: 'Renamed' } : n)),
    create: vi.fn(),
    open,
  })
  expect(e.getText()).toBe('Renamed')
  expect(e.getJSON()).toEqual(before)
  expect(e.getHTML()).toContain('Renamed')
  e.view.dom.querySelector<HTMLElement>('.note-reference')!.click()
  expect(open).toHaveBeenCalledWith('a')
  const roundtrip = normalizeContent(e.getHTML(), writingExtensions)
  expect(roundtrip.content?.[0].content?.[0]).toMatchObject({
    type: 'noteReference',
    attrs: { noteId: 'a', fallbackTitle: 'Renamed' },
  })
  e.commands.undo()
  expect(e.getText()).toBe('[[Alpha')
})
it('validates JSON IDs and safely drops malformed HTML reference attributes', () => {
  const schema = getSchema(writingExtensions)
  expect(() =>
    schema
      .nodeFromJSON({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'noteReference', attrs: { noteId: 'javascript:bad', fallbackTitle: 'Bad' } },
            ],
          },
        ],
      })
      .check(),
  ).toThrow()
  expect(
    JSON.stringify(
      normalizeContent('<span data-note-id="javascript:bad">Text</span>', writingExtensions),
    ),
  ).not.toContain('noteReference')
  expect(NoteReference.name).toBe('noteReference')
})

it('pastes a copied app link as a reference but preserves literal and code pastes', () => {
  const paste = (e: Editor, text: string) => {
    const event = new Event('paste')
    Object.defineProperty(event, 'clipboardData', {
      value: { getData: (type: string) => (type === 'text/plain' ? text : '') },
    })
    e.view.someProp('handlePaste', (handler) =>
      handler(e.view, event as ClipboardEvent, null as never),
    )
  }
  const { e } = make()
  paste(e, 'upnote2://note/a')
  expect(e.getJSON().content?.[0].content?.[0]).toMatchObject({
    type: 'noteReference',
    attrs: { noteId: 'a' },
  })
  expect(e.view.dom.textContent).toContain('Alpha')
  const { e: literal } = make()
  key(literal, 'v', { metaKey: true, shiftKey: true })
  paste(literal, 'upnote2://note/a')
  expect(literal.getText()).toBe('upnote2://note/a')
  expect(JSON.stringify(literal.getJSON())).not.toContain('noteReference')
  const { e: code } = make('<pre><code></code></pre>')
  code.commands.setTextSelection(1)
  paste(code, 'upnote2://note/a')
  expect(code.state.doc.firstChild?.textContent).toBe('upnote2://note/a')
  expect(JSON.stringify(code.getJSON())).not.toContain('noteReference')
})
