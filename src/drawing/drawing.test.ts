// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { Editor, getSchema } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import { writingExtensions } from '../editor/extensions'
import { markdownExtensions, serializeMarkdown } from '../editor/markdown'
import { runCommand } from '../editor/commands'
import { platform } from '../platform'
import { captureScene, copyDrawingIds, drawingPreview, emptyDrawing, readDrawing } from './model'
import { drawingFixture, previewFixture } from './fixtures'
import { findDrawing } from './node'
import { DrawingSession } from './session'
import { copyDrawings, drawingClipboardType, pasteDrawings } from './clipboard'
import { normalizeContent } from '../editor/clipboard'
import { clipboardText } from '../editor/copy'
import type { AppState } from '@excalidraw/excalidraw/types'
Range.prototype.getClientRects = () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () => new DOMRect()
Element.prototype.scrollIntoView = vi.fn()
window.scrollBy = vi.fn()
vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)

const editors: Editor[] = []
function editor(markdown = false) {
  const value = new Editor({
    extensions: markdown ? markdownExtensions : writingExtensions,
    content: '<p></p>',
  })
  editors.push(value)
  return value
}
function drawingEditor(data: unknown = drawingFixture()) {
  const value = editor()
  value.commands.setContent({
    type: 'doc',
    content: [{ type: 'drawing', attrs: { id: 'drawing-1', data } }, { type: 'paragraph' }],
  })
  return value
}
const data = (editor: Editor) => readDrawing(findDrawing(editor, 'drawing-1')?.node.attrs.data)!
afterEach(() => {
  editors.splice(0).forEach((value) => value.destroy())
  platform.mobile = false
  vi.useRealTimers()
})

it('inserts one selectable block, opens after dispatch, and supports insertion undo', async () => {
  const value = editor(),
    open = vi.fn()
  value.view.dom.addEventListener('drawing-open', open)
  expect(runCommand(value, 'drawing')).toBe(true)
  await Promise.resolve()
  expect(value.state.doc.firstChild!.type.name).toBe('drawing')
  expect(open).toHaveBeenCalledTimes(1)
  expect(value.commands.undo()).toBe(true)
  expect(value.state.doc.textContent).toBe('')
  expect(value.state.doc.firstChild!.type.name).toBe('paragraph')
})
it('replaces a slash command and opens a selected drawing with Enter', async () => {
  const value = editor(),
    open = vi.fn()
  value.commands.insertContent('/drawing')
  expect(runCommand(value, 'drawing', { from: 1, to: 9 })).toBe(true)
  await Promise.resolve()
  value.commands.setNodeSelection(0)
  value.view.dom.addEventListener('drawing-open', open)
  value.view.someProp('handleKeyDown', (handler) =>
    handler(value.view, new KeyboardEvent('keydown', { key: 'Enter' })),
  )
  expect(open).toHaveBeenCalledTimes(1)
  expect(value.getText()).not.toContain('/drawing')
})
it('selects previews without opening and opens once through Edit', () => {
  const value = drawingEditor(),
    open = vi.fn()
  value.view.dom.addEventListener('drawing-open', open)
  const preview = value.view.dom.querySelector<HTMLButtonElement>('.drawing-preview')!
  preview.click()
  preview.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  expect(value.state.selection).toBeInstanceOf(NodeSelection)
  expect(open).not.toHaveBeenCalled()
  value.view.dom.querySelector<HTMLButtonElement>('.drawing-edit')!.click()
  expect(open).toHaveBeenCalledTimes(1)
})
it('updates Edit visibility when editability changes and keeps read-only preview access', () => {
  const value = drawingEditor(),
    open = vi.fn()
  value.view.dom.addEventListener('drawing-open', open)
  const actions = value.view.dom.querySelector<HTMLElement>('.drawing-actions')!
  expect(actions.hidden).toBe(false)
  value.setEditable(false, false)
  expect(actions.hidden).toBe(true)
  value.view.dom.querySelector<HTMLButtonElement>('.drawing-preview')!.click()
  expect(open).toHaveBeenCalledTimes(1)
  value.view.dom.querySelector<HTMLButtonElement>('.drawing-edit')!.click()
  expect(open).toHaveBeenCalledTimes(1)
  value.setEditable(true, false)
  expect(actions.hidden).toBe(false)
})
it('keeps mobile preview access without an Edit control', () => {
  platform.mobile = true
  const value = drawingEditor(),
    open = vi.fn()
  value.view.dom.addEventListener('drawing-open', open)
  expect(value.view.dom.querySelector<HTMLElement>('.drawing-actions')!.hidden).toBe(true)
  value.view.dom.querySelector<HTMLButtonElement>('.drawing-preview')!.click()
  expect(open).toHaveBeenCalledTimes(1)
})
it('blocks insertion on mobile, in Markdown, and in read-only editors', () => {
  expect(runCommand(editor(true), 'drawing')).toBe(false)
  platform.mobile = true
  expect(runCommand(editor(), 'drawing')).toBe(false)
  platform.mobile = false
  const value = editor()
  value.setEditable(false)
  expect(runCommand(value, 'drawing')).toBe(false)
})
it('preserves unsupported payloads and rejects lossy Markdown conversion', () => {
  const unsupported = { version: 99, privateData: 'keep me' }
  const value = drawingEditor(unsupported)
  expect(value.getJSON().content![0].attrs!.data).toEqual(unsupported)
  expect(value.view.dom.textContent).toContain('unsupported')
  expect(() => serializeMarkdown(value.getJSON())).toThrow('Markdown cannot preserve drawing')
  expect(() => getSchema(markdownExtensions).nodeFromJSON(value.getJSON())).toThrow()
})
it('captures immutable content but excludes selection, theme, and viewport state', () => {
  const fixture = drawingFixture()
  const state = {
    ...fixture.scene.appState,
    theme: 'dark',
    selectedElementIds: { x: true },
    scrollX: 500,
  } as unknown as AppState
  const scene = captureScene(fixture.scene.elements, state, {})
  expect(scene.appState).toEqual(fixture.scene.appState)
  expect(scene.elements).not.toBe(fixture.scene.elements)
  expect(readDrawing({ ...fixture, scene })).not.toBeNull()
})
it('validates malformed scenes, external images, and preview URLs without altering them', () => {
  expect(readDrawing(emptyDrawing())).not.toBeNull()
  expect(readDrawing(drawingFixture())).not.toBeNull()
  const fixture = drawingFixture()
  expect(readDrawing({ ...fixture, preview: 'https://example.com/image.png' })).toBeNull()
  expect(
    readDrawing({ ...fixture, scene: { ...fixture.scene, elements: [{ type: 'rectangle' }] } }),
  ).toBeNull()
  expect(
    readDrawing({
      ...fixture,
      scene: {
        ...fixture.scene,
        files: {
          x: {
            id: 'x',
            dataURL: 'https://example.com/image.png',
            mimeType: 'image/png',
            created: 1,
          },
        },
      },
    }),
  ).toBeNull()
})
it('saves scenes immediately, ignores identical scenes, and updates only current previews', async () => {
  const value = drawingEditor(),
    changes = vi.fn()
  value.on('update', changes)
  const pending: Array<(value: string) => void> = []
  const session = new DrawingSession(
    value,
    'drawing-1',
    () => new Promise((resolve) => pending.push(resolve)),
  )
  const first = structuredClone(data(value).scene)
  first.elements = first.elements.map((e) => ({ ...e, x: 42 }))
  expect(session.change(first)).toBe(true)
  expect(data(value).scene.elements[0].x).toBe(42)
  expect(session.change(first)).toBe(false)
  expect(changes).toHaveBeenCalledTimes(1)
  const flushing = session.flushPreview()
  const second = structuredClone(first)
  second.elements = second.elements.map((e) => ({ ...e, x: 90 }))
  session.change(second)
  const concurrentFlush = session.flushPreview()
  pending.shift()!(previewFixture)
  await vi.waitFor(() => expect(pending).toHaveLength(1))
  expect(drawingPreview(data(value))).toBeNull()
  pending.shift()!(previewFixture)
  await flushing
  await concurrentFlush
  expect(data(value).scene.elements[0].x).toBe(90)
  expect(drawingPreview(data(value))).toBe(previewFixture)
  session.dispose()
})
it('keeps source data when preview export fails and supports retry', async () => {
  const value = drawingEditor(),
    render = vi.fn().mockRejectedValueOnce(Error('canvas failed')).mockResolvedValue(previewFixture)
  const session = new DrawingSession(value, 'drawing-1', render)
  await session.flushPreview()
  expect(session.previewError).toContain('could not be created')
  expect(data(value).scene).toEqual(drawingFixture().scene)
  await session.flushPreview()
  expect(drawingPreview(data(value))).toBe(previewFixture)
  session.dispose()
})
it.each(['delete', 'dispose', 'destroy'])('ignores pending preview after %s', async (action) => {
  const value = drawingEditor()
  let resolve!: (value: string) => void
  const session = new DrawingSession(
    value,
    'drawing-1',
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  const flush = session.flushPreview()
  if (action === 'delete') {
    value.commands.setNodeSelection(0)
    value.commands.deleteSelection()
  }
  if (action === 'dispose') session.dispose()
  if (action === 'destroy') value.destroy()
  resolve(previewFixture)
  await flush
  if (action === 'delete') expect(findDrawing(value, 'drawing-1')).toBeUndefined()
  if (action === 'dispose') expect(data(value).preview).toBeNull()
  session.dispose()
})
it('keeps drawing edits out of text history, and deletion undo restores the latest scene', () => {
  const value = drawingEditor(),
    session = new DrawingSession(value, 'drawing-1', async () => previewFixture)
  const scene = drawingFixture().scene
  scene.elements = scene.elements.map((e) => ({ ...e, x: 99 }))
  session.change(scene)
  value.commands.setNodeSelection(0)
  value.commands.deleteSelection()
  value.commands.undo()
  expect(data(value).scene.elements[0].x).toBe(99)
  session.dispose()
})
it('copies editable data privately, exports only a preview, and gives pasted drawings new IDs', () => {
  const fixture = { ...drawingFixture(), preview: previewFixture, previewRevision: 1 }
  const source = drawingEditor(fixture)
  source.commands.setNodeSelection(0)
  const values = new Map<string, string>()
  const clipboard = {
    clearData: () => values.clear(),
    setData: (key: string, value: string) => values.set(key, value),
    getData: (key: string) => values.get(key) ?? '',
  } as unknown as DataTransfer
  const event = { clipboardData: clipboard, preventDefault: vi.fn() } as unknown as ClipboardEvent
  expect(copyDrawings(source, event, false)).toBe(true)
  expect(clipboard.getData('text/plain')).toBe('[Drawing]')
  expect(clipboard.getData('text/html')).toContain(previewFixture)
  expect(clipboard.getData('text/html')).not.toContain('rectangle-1')
  expect(clipboard.getData(drawingClipboardType)).toContain('rectangle-1')
  const target = editor()
  expect(pasteDrawings(target, clipboard)).toBe(true)
  const copied = target.getJSON().content!.find((node) => node.type === 'drawing')!
  expect(copied.attrs!.id).not.toBe('drawing-1')
  expect(copied.attrs!.data).toEqual(fixture)
  // macOS WebKit drops private MIME types but retains our opaque HTML marker.
  values.delete(drawingClipboardType)
  const webkitTarget = editor()
  expect(pasteDrawings(webkitTarget, clipboard)).toBe(true)
  expect(webkitTarget.getJSON().content![0].attrs!.data).toEqual(fixture)
  const markdown = normalizeContent(clipboard.getData('text/html'), markdownExtensions)
  expect(serializeMarkdown(markdown)).toContain(previewFixture)
  expect(copyDrawingIds(source.getJSON()).content![0].attrs!.id).not.toBe('drawing-1')
  expect(source.state.selection).toBeInstanceOf(NodeSelection)
  expect(clipboardText(source)).toBe('[Drawing]')
})

it('lets clipboard events from the preview reach the editor clipboard handler', () => {
  const source = drawingEditor({ ...drawingFixture(), preview: previewFixture, previewRevision: 1 })
  source.commands.setNodeSelection(0)
  const values = new Map<string, string>()
  const event = new Event('copy', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: {
      clearData: () => values.clear(),
      setData: (key: string, value: string) => values.set(key, value),
      getData: (key: string) => values.get(key) ?? '',
    },
  })
  source.view.dom.querySelector('.drawing-preview')!.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
  expect(values.get(drawingClipboardType)).toContain('rectangle-1')
})
