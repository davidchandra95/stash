// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { undoDepth } from '@tiptap/pm/history'
import { retainEditorView } from './lifecycle'
import { clearSessions, getEditor, getSplitEditor, peekEditor, resetSession } from './session'

Range.prototype.getClientRects = () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () =>
  ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }) as DOMRect
Element.prototype.scrollIntoView = vi.fn()

const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }] }
afterEach(clearSessions)

it('keeps both views of a note in step, saving through the main session once', () => {
  const change = vi.fn()
  const main = getEditor('a', content, change)
  const split = getSplitEditor('a', content)
  expect(split).not.toBe(main)
  const release = retainEditorView(split)

  split.commands.insertContentAt(1, 'right ')
  expect(main.getText()).toBe('right hello')
  expect(change).toHaveBeenCalledTimes(1)
  expect(change.mock.calls[0][1]).toBe('right hello')

  main.commands.insertContentAt(1, 'left ')
  expect(split.getText()).toBe('left right hello')
  expect(change).toHaveBeenCalledTimes(2)
  release()
})

it('gives each view its own selection and undo history', () => {
  const main = getEditor('a', content, vi.fn())
  const split = getSplitEditor('a', content)
  const release = retainEditorView(split)
  split.commands.setTextSelection(3)
  main.commands.setTextSelection(5)
  expect(split.state.selection.from).toBe(3)
  split.commands.insertContentAt(1, 'x')
  expect(undoDepth(split.state)).toBe(1)
  expect(undoDepth(main.state)).toBe(0)
  split.commands.undo()
  expect(main.getText()).toBe('hello')
  release()
})

it('starts from the live document, not the saved content', () => {
  const main = getEditor('a', content, vi.fn())
  main.commands.insertContentAt(1, 'unsaved ')
  expect(getSplitEditor('a', content).getText()).toBe('unsaved hello')
})

it('destroys the split view after its last consumer and with its session', async () => {
  const main = getEditor('a', content, vi.fn())
  const split = getSplitEditor('a', content)
  const release = retainEditorView(split)
  await Promise.resolve()
  expect(split.isDestroyed).toBe(false)
  expect(peekEditor('a', true)).toBe(split)
  release()
  await Promise.resolve()
  expect(split.isDestroyed).toBe(true)
  expect(peekEditor('a', true)).toBe(main)

  const next = getSplitEditor('a', content)
  const releaseNext = retainEditorView(next)
  resetSession('a')
  expect(next.isDestroyed).toBe(true)
  releaseNext()
})
