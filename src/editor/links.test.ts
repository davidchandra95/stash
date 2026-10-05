// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { writingExtensions } from './extensions'
import { applyLink, captureLinkTarget, mapLinkTarget, removeLink } from './links'
const editors: Editor[] = []
Element.prototype.scrollIntoView = vi.fn()
Range.prototype.getClientRects = () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () => new DOMRect()
const make = (content = '<p></p>') => {
  const e = new Editor({ extensions: writingExtensions, content })
  editors.push(e)
  return e
}
afterEach(() => editors.splice(0).forEach((e) => e.destroy()))
it('inserts a title or falls back to the address with no selected text', () => {
  for (const title of ['Example', '']) {
    const e = make()
    e.commands.setTextSelection(1)
    expect(applyLink(e.chain(), captureLinkTarget(e), title, 'https://example.com').run()).toBe(
      true,
    )
    expect(e.getText()).toBe(title || 'https://example.com')
    expect(e.state.doc.firstChild?.firstChild?.marks[0].attrs.href).toBe('https://example.com')
  }
})
it('captures the complete existing label and preserves mixed formatting on an address-only update', () => {
  const e = make('<p><a href="https://old.com"><strong>hello</strong> <em>world</em></a> after</p>')
  e.commands.setTextSelection(3)
  const target = captureLinkTarget(e)
  expect(target.title).toBe('hello world')
  expect(target.href).toBe('https://old.com')
  applyLink(e.chain(), target, target.title, 'https://new.com').run()
  expect(e.getText()).toBe('hello world after')
  expect(e.getHTML()).toContain('<strong>hello</strong>')
  expect(e.getHTML()).toContain('<em>world</em>')
  expect(e.getHTML()).not.toContain('old.com')
  const renamed = captureLinkTarget(e)
  applyLink(e.chain(), renamed, 'New name', 'https://new.com').run()
  expect(e.getText()).toBe('New name after')
  expect(e.getHTML()).toContain('<strong>New name</strong>')
  removeLink(e.chain(), captureLinkTarget(e)).run()
  expect(e.getHTML()).not.toContain('<a ')
})
it('maps captured selection through edits while a form is open', () => {
  const e = make('<p>before label after</p>')
  e.commands.setTextSelection({ from: 8, to: 13 })
  let target = captureLinkTarget(e)
  e.on('transaction', ({ transaction }) => {
    target = mapLinkTarget(target, transaction)!
  })
  e.commands.insertContentAt(1, 'New ')
  e.commands.setTextSelection(1)
  applyLink(e.chain(), target, 'Renamed', 'https://example.com').run()
  expect(e.getText()).toBe('New before Renamed after')
})
it('disables title changes for multiple blocks or embedded objects but applies addresses', () => {
  for (const html of [
    '<p>first</p><p>second</p>',
    '<p>first <span data-type="inlineCheckbox" data-checked="false"></span> second</p>',
  ]) {
    const e = make(html)
    e.commands.setTextSelection({ from: 1, to: e.state.doc.content.size - 1 })
    const target = captureLinkTarget(e)
    expect(target.titleEditable).toBe(false)
    const before = e.state.doc.textContent
    applyLink(e.chain(), target, 'Ignored', 'https://example.com').run()
    expect(e.state.doc.textContent).toBe(before)
  }
})
it('does not write invalid URLs or after becoming read-only', () => {
  const e = make('<p>label</p>')
  e.commands.setTextSelection({ from: 1, to: 6 })
  const target = captureLinkTarget(e),
    before = e.getJSON()
  expect(applyLink(e.chain(), target, 'title', 'javascript:alert(1)').run()).toBe(false)
  expect(e.getJSON()).toEqual(before)
  e.setEditable(false)
  expect(applyLink(e.chain(), target, 'title', 'https://example.com').run()).toBe(false)
  expect(removeLink(e.chain(), target).run()).toBe(false)
  expect(e.getJSON()).toEqual(before)
})

it('uses captured initial formatting for new titles, including stored marks on an empty selection', () => {
  const e = make()
  e.commands.setTextSelection(1)
  e.commands.toggleBold()
  const target = captureLinkTarget(e)
  e.commands.unsetBold()
  applyLink(e.chain(), target, 'Title', 'https://example.com').run()
  expect(e.getHTML()).toContain('<strong>Title</strong>')
})
