// @vitest-environment jsdom
import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { generateJSON, type JSONContent } from '@tiptap/core'
import NoteEditor from '../components/NoteEditor'
import NoteTools from '../components/NoteTools'
import { defaultAppearance } from '../storage/library'
import type { Note } from '../model'
import { pastePlain } from './plainPaste'
import { insertImages } from './images'
import { findKey, setFind } from './noteTools'
import { retainEditorOperation } from './lifecycle'
import { writingExtensions } from './extensions'
import { richWritingFixture } from './fixtures'
import { parseMarkdown } from './markdown'
import { drawingFixture } from '../drawing/fixtures'
import { DrawingSession } from '../drawing/session'

vi.mock('./mermaid', () => ({ renderMermaid: vi.fn(async () => '<svg></svg>') }))
import {
  clearSessions,
  evictSession,
  getEditor,
  getSessionStats,
  noteScrollPositions,
  resetSession,
  trimEditorSessions,
} from './session'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
Element.prototype.scrollIntoView = vi.fn()
Range.prototype.getClientRects = () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () =>
  ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }) as DOMRect
const content: JSONContent = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Alpha beta' }] }],
}
const makeNote = (id: string): Note => ({
  id,
  content,
  title: id,
  text: 'Alpha beta',
  notebookIds: [],
  tags: [],
  pinned: false,
  quickAccess: false,
  trashed: false,
  updated: 1,
})
const noteLinks = { notes: () => [], create: () => undefined, open: () => {} }
let root: Root | undefined
let host: HTMLDivElement | undefined
afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  root = undefined
  host?.remove()
  host = undefined
  clearSessions()
})
function visitOthers(count = 12) {
  for (let i = 0; i < count; i++) getEditor(`other-${i}`, content)
  trimEditorSessions()
}

it('bounds live views across real React note switches and preserves edited-note undo', async () => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const changes = vi.fn()
  const render = (note: Note) =>
    root!.render(
      <StrictMode>
        <NoteEditor
          note={note}
          cursorSettings={defaultAppearance}
          onChange={changes}
          noteLinks={noteLinks}
          onOpenTag={() => {}}
        />
        <NoteTools
          note={note}
          contentsOpen={false}
          findOpen={false}
          onFindOpenChange={() => {}}
          disabled={false}
        />
      </StrictMode>,
    )
  await act(async () => render(makeNote('first')))
  const first = getEditor('first', content)
  await act(async () => first.commands.insertContent('edit '))
  for (let i = 0; i < 20; i++) await act(async () => render(makeNote(`react-${i}`)))
  expect(getSessionStats().liveViews).toBeLessThanOrEqual(4)
  expect(getSessionStats().visibleConsumers).toBe(2)
  await act(async () => render(makeNote('first')))
  expect(getEditor('first', content)).toBe(first)
  await act(async () => first.commands.undo())
  expect(first.getText()).toBe('Alpha beta')
  await act(async () => first.commands.redo())
  expect(first.getText()).toBe('edit Alpha beta')
}, 15000)

it('preserves selection, stored marks, find state and history over repeated suspension', () => {
  const first = getEditor('state', content)
  first.commands.insertContent('edit ')
  first.commands.setTextSelection(4)
  first.commands.setMark('bold')
  setFind(first, 'beta', 0)
  const doc = first.getJSON()
  const marks = first.state.storedMarks?.map((mark) => mark.toJSON())
  for (let cycle = 0; cycle < 10; cycle++) {
    visitOthers()
    expect(first.isDestroyed).toBe(true)
    expect(getEditor('state', content)).toBe(first)
    expect(first.getJSON()).toEqual(doc)
    expect(first.state.selection.from).toBe(4)
    expect(first.state.storedMarks?.map((mark) => mark.toJSON())).toEqual(marks)
    expect(findKey.getState(first.state)?.query).toBe('beta')
  }
  expect(first.commands.undo()).toBe(true)
  expect(first.getText()).toBe('Alpha beta')
  expect(first.commands.redo()).toBe(true)
  expect(first.getJSON()).toEqual(doc)
})

it('releases zero-history editors while retaining compact selection and tool state', () => {
  const first = getEditor('cold', content)
  first.commands.setTextSelection(4)
  first.commands.setMark('bold')
  setFind(first, 'beta', 0)
  noteScrollPositions.set('cold', 123)
  visitOthers()
  expect(getSessionStats().retainedEditors).toBeLessThanOrEqual(4)
  const reopened = getEditor('cold', content)
  expect(reopened).not.toBe(first)
  expect(reopened.state.selection.from).toBe(4)
  expect(reopened.state.storedMarks?.[0].type.name).toBe('bold')
  expect(findKey.getState(reopened.state)?.query).toBe('beta')
  expect(noteScrollPositions.get('cold')).toBe(123)
})

it('protects asynchronous clipboard completion after switching away', async () => {
  let resolve!: (text: string) => void
  const changed = vi.fn()
  const first = getEditor('clipboard', content, changed)
  const paste = pastePlain(
    first,
    () =>
      new Promise<string>((done) => {
        resolve = done
      }),
  )
  visitOthers()
  expect(first.isDestroyed).toBe(false)
  resolve('late ')
  await paste
  expect(first.getText()).toBe('late Alpha beta')
  expect(changed).toHaveBeenLastCalledWith(first.getJSON(), first.getText())
  visitOthers()
  expect(first.isDestroyed).toBe(true)
  expect(getEditor('clipboard', content)).toBe(first)
  expect(first.commands.undo()).toBe(true)
  expect(first.getText()).toBe('Alpha beta')
})

it('never evicts undo or redo and validates the model before discarding history-free edits', () => {
  const first = getEditor('evict', content)
  first.commands.insertContent('edit ')
  expect(evictSession('evict', first.getJSON())).toBe(false)
  first.commands.undo()
  expect(evictSession('evict', first.getJSON())).toBe(false)
  const derived = getEditor('derived', content)
  derived.view.dispatch(derived.state.tr.insertText('derived ').setMeta('addToHistory', false))
  expect(evictSession('derived', content)).toBe(false)
  expect(evictSession('derived', derived.getJSON())).toBe(true)
})

it('stale operation releases cannot affect a replacement session', () => {
  const first = getEditor('reset', content)
  const release = retainEditorOperation(first)
  resetSession('reset')
  const replacement = getEditor('reset', content)
  const releaseReplacement = retainEditorOperation(replacement)
  release()
  release()
  visitOthers()
  expect(replacement.isDestroyed).toBe(false)
  expect(getSessionStats().pendingOperations).toBe(1)
  releaseReplacement()
  trimEditorSessions()
  expect(getSessionStats().pendingOperations).toBe(0)
})

it('round-trips rich blocks, drawings and Mermaid through suspended views without document edits', () => {
  const initial = generateJSON(richWritingFixture, writingExtensions)
  initial.content!.push(
    { type: 'drawing', attrs: { id: 'lifecycle-drawing', data: drawingFixture() } },
    {
      type: 'codeBlock',
      attrs: { language: 'mermaid' },
      content: [{ type: 'text', text: 'graph TD\nA-->B' }],
    },
    { type: 'paragraph' },
  )
  const editor = getEditor('rich', initial)
  const normalized = editor.getJSON()
  editor.commands.insertContent('edit ')
  const changed = editor.getJSON()
  for (let i = 0; i < 5; i++) {
    visitOthers()
    expect(getEditor('rich', initial)).toBe(editor)
    expect(editor.getJSON()).toEqual(changed)
    expect(editor.view.dom.querySelector('.drawing-block')).toBeTruthy()
    expect(editor.view.dom.querySelector('.mermaid-preview')).toBeTruthy()
  }
  expect(editor.commands.undo()).toBe(true)
  expect(editor.getJSON()).toEqual(normalized)
  expect(editor.commands.redo()).toBe(true)
  expect(editor.getJSON()).toEqual(changed)
})

it('preserves linked Markdown source and undo through suspension', () => {
  const initial = parseMarkdown('## Linked\n\nBody\n\n```mermaid\ngraph TD\nA-->B\n```\n')
  const editor = getEditor('markdown', initial, undefined, true)
  editor.commands.insertContent('edit ')
  const changed = editor.getJSON()
  visitOthers()
  expect(getEditor('markdown', initial, undefined, true)).toBe(editor)
  expect(editor.getJSON()).toEqual(changed)
  expect(editor.commands.undo()).toBe(true)
  expect(editor.getJSON()).toEqual(initial)
})

it('keeps a drawing session live until its flush participant is disposed', () => {
  const initial = {
    type: 'doc',
    content: [
      { type: 'drawing', attrs: { id: 'drawing-lease', data: drawingFixture() } },
      { type: 'paragraph' },
    ],
  }
  const editor = getEditor('drawing', initial)
  const drawing = new DrawingSession(editor, 'drawing-lease', async () => 'preview')
  visitOthers()
  expect(editor.isDestroyed).toBe(false)
  expect(getSessionStats().pendingOperations).toBe(1)
  drawing.dispose()
  drawing.dispose()
  visitOthers()
  expect(editor.isDestroyed).toBe(true)
  expect(getSessionStats().pendingOperations).toBe(0)
})

it('finishes a delayed image read in its originating note after other notes open', async () => {
  const editor = getEditor('image-origin', content)
  const before = editor.getJSON()
  let reader!: FileReader
  const read = vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function (
    this: FileReader,
  ) {
    reader = this
  })
  try {
    const pending = insertImages(editor, [
      new File(['synthetic'], 'image.png', { type: 'image/png' }),
    ])
    visitOthers()
    expect(getSessionStats().pendingOperations).toBe(1)
    expect(editor.isDestroyed).toBe(false)
    Object.defineProperty(reader, 'result', { value: 'data:image/png;base64,c3ludGhldGlj' })
    reader.dispatchEvent(new ProgressEvent('load'))
    await pending
    expect(JSON.stringify(editor.getJSON())).toContain('image.png')
    expect(getSessionStats().pendingOperations).toBe(0)
    visitOthers()
    expect(getEditor('image-origin', content)).toBe(editor)
    expect(editor.commands.undo()).toBe(true)
    expect(editor.getJSON()).toEqual(before)
  } finally {
    read.mockRestore()
  }
})
