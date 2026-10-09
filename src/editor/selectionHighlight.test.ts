// @vitest-environment jsdom
import { Editor } from '@tiptap/core'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { writingExtensions } from './extensions'

const editors: Editor[] = []
const hosts: HTMLElement[] = []
Element.prototype.scrollIntoView = vi.fn()
Range.prototype.getClientRects = () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () => new DOMRect()

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  vi.spyOn(window, 'scrollBy').mockImplementation(() => {})
})

function make() {
  const host = document.createElement('div')
  document.body.append(host)
  hosts.push(host)
  const editor = new Editor({
    element: host,
    extensions: writingExtensions,
    content: '<ul><li><p>Selected text</p></li><li><p>Other text</p></li></ul><p>After list</p>',
  })
  editors.push(editor)
  editor.commands.setTextSelection({ from: 3, to: 16 })
  editor.view.focus()
  return editor
}

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy())
  hosts.splice(0).forEach((host) => host.remove())
  document.getSelection()?.removeAllRanges()
  vi.restoreAllMocks()
})

it('clears stale highlights when the focused browser selection is removed after copying', async () => {
  const editor = make()
  const before = editor.getJSON()
  const updates = vi.fn()
  editor.on('update', updates)
  // Let ProseMirror finish its normal focus/selection synchronization first.
  await new Promise((resolve) => setTimeout(resolve, 30))
  expect(document.getSelection()?.toString()).toBe('Selected text')
  expect(editor.view.dom.querySelector('.selection-highlight')).not.toBeNull()

  document.getSelection()?.removeAllRanges()
  document.dispatchEvent(new Event('selectionchange'))

  await vi.waitFor(() => {
    expect(editor.view.dom.querySelector('.selection-highlight')).toBeNull()
    expect(editor.state.selection.empty).toBe(true)
  })
  expect(editor.getJSON()).toEqual(before)
  expect(updates).not.toHaveBeenCalled()
  expect(editor.can().undo()).toBe(false)
})

it('keeps the selected formatting target when focus moves to a toolbar input', async () => {
  const editor = make()
  const selection = editor.state.selection.toJSON()
  const input = document.createElement('input')
  hosts[0].append(input)
  await new Promise((resolve) => setTimeout(resolve, 30))
  input.focus()
  document.getSelection()?.removeAllRanges()
  document.dispatchEvent(new Event('selectionchange'))
  expect(editor.state.selection.toJSON()).toEqual(selection)

  editor.view.focus()
  expect(document.getSelection()?.toString()).toBe('Selected text')
  editor.commands.toggleBold()
  expect(editor.getHTML()).toContain('<strong>Selected text</strong>')
})

it('lets Escape dismiss the selection without changing copied text or document content', () => {
  const editor = make()
  const before = editor.getJSON()
  expect(editor.view.serializeForClipboard(editor.state.selection.content()).text).toBe(
    '- Selected text',
  )
  editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  expect(editor.state.selection.empty).toBe(true)
  expect(editor.view.dom.querySelector('.selection-highlight')).toBeNull()
  expect(editor.getJSON()).toEqual(before)
  expect(editor.can().undo()).toBe(false)
})

it('does not clear a selection while composing text', async () => {
  const editor = make()
  await new Promise((resolve) => setTimeout(resolve, 30))
  editor.view.dom.dispatchEvent(new CompositionEvent('compositionstart'))
  document.getSelection()?.removeAllRanges()
  document.dispatchEvent(new Event('selectionchange'))
  editor.view.dom.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true }),
  )
  expect(editor.state.selection.empty).toBe(false)
})
