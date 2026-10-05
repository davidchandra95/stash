// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { writingExtensions } from '../editor/extensions'
import { LibraryStore, defaultAppearance, type SavedNote, type Transport } from '../storage/library'
import { drawingFixture, previewFixture } from './fixtures'
import { DrawingSession } from './session'

const editors: Editor[] = []
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()))
function setup() {
  let note: SavedNote = {
    id: 'drawing-note',
    title: 'Sketch',
    notebookIds: [],
    tags: [],
    quickAccess: false,
    pinned: false,
    trashed: false,
    updated: 1,
    revision: 1,
    documentVersion: 1,
    text: '[Drawing]',
    content: {
      type: 'doc',
      content: [{ type: 'drawing', attrs: { id: 'drawing-1', data: drawingFixture() } }],
    },
  }
  const quit = vi.fn(async () => {})
  const save = vi.fn(async (input: Record<string, unknown>) => {
    note = { ...note, ...structuredClone(input), revision: note.revision + 1 } as SavedNote
    return { revision: note.revision, updated: 2 }
  })
  const transport: Transport = {
    open: async () => ({
      notes: [{ ...note, content: undefined }],
      notebooks: [],
      appearance: defaultAppearance,
      preferencesRevision: 1,
      path: 'test',
    }),
    load: async () => structuredClone(note),
    saveNote: save,
    savePreferences: async () => ({ revision: 2, updated: 2 }),
    quit,
  }
  return { store: new LibraryStore(transport), transport, save, quit, saved: () => note }
}
async function edit(store: LibraryStore) {
  await store.open()
  await store.load('drawing-note')
  const editor = new Editor({
    extensions: writingExtensions,
    content: store.getSnapshot().notes[0].content,
    onUpdate: ({ editor }) =>
      store.setNotes((notes) =>
        notes.map((note) => ({ ...note, content: editor.getJSON(), text: editor.getText() })),
      ),
  })
  editors.push(editor)
  const session = new DrawingSession(
    editor,
    'drawing-1',
    async () => previewFixture,
    undefined,
    (data) => store.saveDrawingPreview('drawing-note', 'drawing-1', data),
  )
  const scene = drawingFixture().scene
  scene.elements = scene.elements.map((element) => ({ ...element, x: 500 }))
  session.change(scene)
  return session
}
it('flushes the latest drawing before immediate quit and reopens editable content', async () => {
  const test = setup(),
    session = await edit(test.store)
  await test.store.requestQuit()
  expect(test.quit).toHaveBeenCalledOnce()
  expect(test.saved().content!.content![0].attrs!.data.scene.elements[0].x).toBe(500)
  const reopened = new LibraryStore(test.transport)
  await reopened.open()
  await reopened.load('drawing-note')
  expect(reopened.getSnapshot().notes[0].content).toEqual(test.saved().content)
  session.dispose()
})
it('keeps failed saves retryable and prevents quit until scene data is saved', async () => {
  const test = setup()
  test.save.mockRejectedValueOnce(Error('disk full'))
  const session = await edit(test.store)
  await test.store.requestQuit()
  expect(test.quit).not.toHaveBeenCalled()
  expect(test.store.getSnapshot().quitFailed).toBe(true)
  await test.store.requestQuit()
  expect(test.quit).toHaveBeenCalledOnce()
  expect(test.save.mock.calls[0][0].operationId).toBe(test.save.mock.calls[1][0].operationId)
  expect(test.saved().content!.content![0].attrs!.data.scene.elements[0].x).toBe(500)
  session.dispose()
})
it('duplicates complete scenes with fresh drawing IDs', async () => {
  const test = setup()
  await test.store.open()
  const id = await test.store.duplicate('drawing-note')
  const duplicate = test.store.getSnapshot().notes.find((note) => note.id === id)!
  expect(duplicate.content.content![0].attrs!.data).toEqual(drawingFixture())
  expect(duplicate.content.content![0].attrs!.id).not.toBe('drawing-1')
  await test.store.flush()
})

it('finishes and saves a preview during the quit flush after editing is frozen', async () => {
  const test = setup(),
    session = await edit(test.store)
  const unregister = test.store.registerFlush(session.flushPreview)
  await test.store.requestQuit()
  const saved = test.saved().content!.content![0].attrs!.data
  expect(saved.scene.elements[0].x).toBe(500)
  expect(saved.preview).toBe(previewFixture)
  expect(saved.previewRevision).toBe(saved.revision)
  expect(test.quit).toHaveBeenCalledOnce()
  unregister()
  session.dispose()
})

it('does not apply a stale preview to a newer drawing scene', async () => {
  const test = setup(),
    session = await edit(test.store)
  test.store.saveDrawingPreview('drawing-note', 'drawing-1', {
    ...drawingFixture(),
    preview: previewFixture,
    previewRevision: 1,
  })
  await test.store.flush()
  expect(test.saved().content!.content![0].attrs!.data.preview).toBeNull()
  expect(test.saved().content!.content![0].attrs!.data.scene.elements[0].x).toBe(500)
  session.dispose()
})
