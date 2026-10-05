// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SaveQueue } from './saveQueue'
import {
  LibraryStore,
  defaultAppearance,
  type Transport,
  type SavedNote,
  type LibraryData,
} from './library'
import type { Note } from '../model'
function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((a, b) => {
    resolve = a
    reject = b
  })
  return { promise, resolve, reject }
}
const note = (id: string, text = 'hello'): Note => ({
  id,
  title: id,
  content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
  text,
  notebookIds: [],
  quickAccess: false,
  tags: [],
  pinned: false,
  trashed: false,
  updated: 1,
})
function transport(notes: SavedNote[] = []) {
  return {
    open: vi.fn(async (): Promise<LibraryData> => ({
      notes: notes.map(({ content: _, ...n }) => n),
      notebooks: [],
      appearance: null,
      preferencesRevision: 0,
      path: 'test-library',
    })),
    load: vi.fn(async (id: string) => notes.find((n) => n.id === id)!),
    saveNote: vi.fn(async (input: Record<string, unknown>) => ({
      revision: Number(input.expectedRevision) + 1,
      updated: 2,
    })),
    savePreferences: vi.fn(async (input: Record<string, unknown>) => ({
      revision: Number(input.expectedRevision) + 1,
      updated: 2,
    })),
    quit: vi.fn(async () => {}),
  } satisfies Transport
}
afterEach(() => {
  vi.useRealTimers()
})
it('saves and restores Aster with independent mode, layout and custom fonts', async () => {
  const native = transport()
  const store = new LibraryStore(native)
  await store.open()
  const appearance = {
    ...defaultAppearance,
    theme: 'aster' as const,
    dark: false,
    appStyle: 'cards' as const,
    uiFont: 'avenir',
    noteFont: 'palatino',
  }
  store.setAppearance(appearance)
  await store.flush()
  const saved = native.savePreferences.mock.calls.at(-1)![0]
  expect(saved.appearance).toEqual(appearance)
  native.open.mockResolvedValueOnce({
    notes: [],
    notebooks: [],
    appearance,
    preferencesRevision: 1,
    path: 'test-library',
  })
  const reopened = new LibraryStore(native)
  await reopened.open()
  expect(reopened.getSnapshot().appearance).toEqual(appearance)
  reopened.setAppearance({ ...reopened.getSnapshot().appearance, dark: true })
  await reopened.flush()
  expect(native.savePreferences.mock.calls.at(-1)![0].appearance).toEqual({
    ...appearance,
    dark: true,
  })
})
describe('save queue', () => {
  it('schedules mobile edits immediately but waits for the write acknowledgement', async () => {
    vi.useFakeTimers()
    const gate = deferred()
    const write = vi.fn(() => gate.promise)
    const q = new SaveQueue(() => {})
    q.useImmediateScheduling()
    q.enqueue('mobile-note', write)
    await vi.advanceTimersByTimeAsync(0)
    expect(write).toHaveBeenCalledOnce()
    expect(q.status).toBe('saving')
    gate.resolve()
    await q.flush()
    expect(q.status).toBe('saved')
  })
  it('coalesces a typing burst but saves continuous typing by the maximum interval', async () => {
    vi.useFakeTimers()
    const write = vi.fn(async () => {}),
      q = new SaveQueue(() => {}, 350, 2000)
    for (let i = 0; i < 10; i++) {
      q.enqueue('a', write)
      await vi.advanceTimersByTimeAsync(200)
    }
    expect(write).toHaveBeenCalledTimes(1)
    expect(q.status).toBe('saved')
  })
  it('retains a failed job and newer edits, retries in order, and never claims saved early', async () => {
    const calls: string[] = []
    let fail = true
    const q = new SaveQueue(() => {})
    q.enqueue('a', async () => {
      calls.push('first')
      if (fail) throw Error('disk full')
    })
    await expect(q.flush()).rejects.toThrow('disk full')
    expect(q.status).toBe('error')
    q.enqueue('a', async () => {
      calls.push('newer')
    })
    expect(q.status).toBe('error')
    fail = false
    await q.flush()
    expect(calls).toEqual(['first', 'first', 'newer'])
    expect(q.status).toBe('saved')
  })
  it('waits for an in-flight save and drains edits queued while it is running', async () => {
    const gate = deferred(),
      calls: string[] = []
    const q = new SaveQueue(() => {})
    q.enqueue('a', async () => {
      calls.push('a1')
      await gate.promise
    })
    const first = q.flush()
    q.enqueue('b', async () => {
      calls.push('b')
    })
    q.enqueue('a', async () => {
      calls.push('a2')
    })
    const quit = q.flush()
    expect(q.status).toBe('saving')
    gate.resolve()
    await Promise.all([first, quit])
    expect(calls).toEqual(['a1', 'b', 'a2'])
    expect(q.dirty).toBe(false)
  })
  it('commits notebook changes before notes that depend on them', async () => {
    const q = new SaveQueue(() => {}),
      calls: string[] = []
    q.enqueue('note', async () => {
      calls.push('note')
    })
    q.enqueue('preferences', async () => {
      calls.push('notebooks')
    })
    await q.flush()
    expect(calls).toEqual(['notebooks', 'note'])
  })
})
describe('persistent library controller', () => {
  it('loads summaries first and hydrates each body only once', async () => {
    const t = transport([{ ...note('a'), revision: 1, documentVersion: 1 }])
    const l = new LibraryStore(t)
    await l.open()
    expect(t.load).not.toHaveBeenCalled()
    expect(l.getSnapshot().loaded.size).toBe(0)
    await Promise.all([l.load('a'), l.load('a')])
    expect(t.load).toHaveBeenCalledTimes(1)
    expect(l.getSnapshot().notes[0].text).toBe('hello')
  })
  it('separates rapid edits across notes and increments revisions in save order', async () => {
    const t = transport(),
      l = new LibraryStore(t)
    await l.open()
    l.setNotes([note('a')])
    await l.flush()
    l.setNotes((old) => [note('b'), ...old.map((n) => ({ ...n, title: 'updated a' }))])
    await l.flush()
    expect(t.saveNote.mock.calls.map(([n]) => [n.id, n.title, n.expectedRevision])).toEqual([
      ['a', 'a', 0],
      ['b', 'b', 0],
      ['a', 'updated a', 1],
    ])
  })
  it('retries the same operation ID after an uncertain result before saving newer text', async () => {
    const t = transport(),
      l = new LibraryStore(t)
    let first = true
    t.saveNote.mockImplementation(async (input) => {
      if (first) {
        first = false
        throw Error('response interrupted')
      }
      return { revision: Number(input.expectedRevision) + 1, updated: 2 }
    })
    await l.open()
    l.setNotes([note('a', 'old')])
    await expect(l.flush()).rejects.toThrow()
    l.setNotes([note('a', 'new')])
    await l.flush()
    const calls = t.saveNote.mock.calls.map(([n]) => n)
    expect(calls[0]).toEqual(calls[1])
    expect(calls[2].operationId).not.toBe(calls[1].operationId)
    expect(calls[2].expectedRevision).toBe(1)
    expect(calls[2].text).toBe('new')
  })
  it('blocks quit on save failure, retains edits, and can retry and quit', async () => {
    const t = transport(),
      l = new LibraryStore(t)
    t.saveNote.mockRejectedValueOnce(Error('disk full'))
    await l.open()
    l.setNotes([note('a')])
    await l.requestQuit()
    expect(t.quit).not.toHaveBeenCalled()
    expect(l.getSnapshot().quitFailed).toBe(true)
    expect(l.getSnapshot().notes[0].text).toBe('hello')
    await l.requestQuit()
    expect(t.quit).toHaveBeenCalledTimes(1)
    expect(l.getSnapshot().status).toBe('saved')
  })
  it('quit waits for pending note and settings saves', async () => {
    const t = transport(),
      gate = deferred<{ revision: number; updated: number }>()
    t.saveNote.mockReturnValueOnce(gate.promise)
    const l = new LibraryStore(t)
    await l.open()
    l.setNotes([note('a')])
    l.setAppearance({ ...defaultAppearance, theme: 'zen', width: 100 })
    const quit = l.requestQuit()
    expect(t.quit).not.toHaveBeenCalled()
    gate.resolve({ revision: 1, updated: 3 })
    await quit
    expect(t.savePreferences).toHaveBeenCalled()
    expect(t.quit).toHaveBeenCalledOnce()
  })
  it('keeps startup failure visible and retries without seeding samples', async () => {
    const t = transport()
    t.open.mockRejectedValueOnce(Error('corrupt library'))
    const l = new LibraryStore(t)
    await l.open()
    expect(l.getSnapshot().ready).toBe(false)
    expect(l.getSnapshot().startupError).toContain('corrupt')
    expect(l.getSnapshot().notes).toEqual([])
    await l.open()
    expect(l.getSnapshot().ready).toBe(true)
  })
  it('refuses unknown document nodes instead of dropping their content', async () => {
    const t = transport([
      {
        ...note('a'),
        revision: 1,
        documentVersion: 1,
        content: { type: 'doc', content: [{ type: 'futureNode' }] },
      },
    ])
    const l = new LibraryStore(t)
    await l.open()
    await l.load('a')
    expect(l.getSnapshot().loaded.has('a')).toBe(false)
    expect(l.getSnapshot().noteErrors.a).toBeTruthy()
    expect(t.saveNote).not.toHaveBeenCalled()
  })
})

it('saves a new link target before coalesced source references and retains both on failure', async () => {
  const t = transport(),
    store = new LibraryStore(t)
  await store.open()
  store.setNotes([note('source')])
  const target = note('target')
  store.setNotes((old) => [...old, target])
  store.setNotes((old) =>
    old.map((n) =>
      n.id !== 'source'
        ? n
        : {
            ...n,
            content: {
              type: 'doc',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'noteReference', attrs: { noteId: 'target', fallbackTitle: 'target' } },
                  ],
                },
              ],
            },
          },
    ),
  )
  t.saveNote.mockRejectedValueOnce(Error('disk full'))
  await expect(store.flush()).rejects.toThrow('disk full')
  expect(t.saveNote.mock.calls.map((c) => c[0].id)).toEqual(['target'])
  await store.flush()
  expect(t.saveNote.mock.calls.map((c) => c[0].id)).toEqual(['target', 'target', 'source'])
  expect(t.saveNote.mock.calls[2][0].content).toEqual(store.getSnapshot().notes[0].content)
})

it('restores workspace preferences without loading bodies and saves pending tabs before quit', async () => {
  const saved = { tabs: [{ id: 'one', noteId: 'a' }], activeTabId: 'one' }
  const t = transport([{ ...note('a'), revision: 1, documentVersion: 1 }])
  const originalOpen = t.open
  const store = new LibraryStore({
    ...t,
    open: async () => ({
      ...(await originalOpen()),
      appearance: defaultAppearance,
      workspace: saved,
    }),
  })
  await store.open()
  expect(store.getSnapshot().workspace).toEqual({ ...saved, recentNoteIds: [] })
  expect(t.load).not.toHaveBeenCalled()
  store.setWorkspace({ tabs: [], activeTabId: null })
  await store.requestQuit()
  expect(t.savePreferences).toHaveBeenCalledWith(
    expect.objectContaining({ workspace: { tabs: [], activeTabId: null, recentNoteIds: [] } }),
  )
  expect(t.quit).toHaveBeenCalledOnce()
})
it('retries a failed tab save with its original identity before saving newer tabs', async () => {
  const t = transport()
  const store = new LibraryStore(t)
  await store.open()
  await store.flush()
  t.savePreferences.mockClear()
  t.savePreferences.mockRejectedValueOnce(Error('disk full'))
  store.setWorkspace({ tabs: [{ id: 'a-tab', noteId: 'a' }], activeTabId: 'a-tab' })
  await expect(store.flush()).rejects.toThrow('disk full')
  const failed = t.savePreferences.mock.calls[0][0]
  store.setWorkspace({ tabs: [], activeTabId: null })
  await store.requestQuit()
  expect(t.savePreferences.mock.calls[1][0]).toEqual(failed)
  expect(t.savePreferences.mock.calls[2][0]).toMatchObject({
    workspace: { tabs: [], activeTabId: null },
  })
  expect(t.quit).toHaveBeenCalledOnce()
})

it('loads older appearance preferences with spacing defaults', async () => {
  const t = transport()
  t.open.mockResolvedValue({
    notes: [],
    notebooks: [],
    preferencesRevision: 1,
    path: 'test-library',
    appearance: {
      dark: false,
      theme: 'zen',
      uiFont: 'system',
      noteFont: 'palatino',
      codeFont: 'menlo',
      size: 20,
      width: 90,
    },
  })
  const store = new LibraryStore(t)
  await store.open()
  expect(store.getSnapshot().appearance.lineSpacing).toBe(1.5)
  expect(store.getSnapshot().appearance.titleFont).toBe('palatino')
  expect(store.getSnapshot().appearance).toMatchObject({
    cursorStyle: 'line',
    cursorBlinking: 'blinking',
    cursorSmoothCaretAnimation: 'off',
  })
  expect(store.getSnapshot().appearance).toEqual({
    ...defaultAppearance,
    dark: false,
    theme: 'zen',
    titleFont: 'palatino',
    noteFont: 'palatino',
    size: 20,
    width: 90,
  })
})

it('persists and reloads a title font without changing the note-body font', async () => {
  const t = transport()
  const store = new LibraryStore(t)
  await store.open()
  await store.flush()
  t.savePreferences.mockClear()
  const appearance = { ...defaultAppearance, titleFont: 'palatino' }
  store.setAppearance(appearance)
  await store.flush()
  const saved = t.savePreferences.mock.calls[0][0]
  const savedAppearance = saved.appearance as typeof appearance
  expect(savedAppearance).toEqual(appearance)
  expect(savedAppearance.noteFont).toBe(defaultAppearance.noteFont)
  expect(t.saveNote).not.toHaveBeenCalled()
  t.open.mockResolvedValue({
    notes: [],
    notebooks: [],
    appearance: savedAppearance,
    preferencesRevision: 2,
    path: 'test-library',
  })
  const reopened = new LibraryStore(t)
  await reopened.open()
  expect(reopened.getSnapshot().appearance).toEqual(appearance)
})

it.each([
  [0.5, 0, -8, 0],
  [1.5, 0, 0, 0],
  [1.8, 0, 16, 112],
  [2.5, 32, 32, 400],
])(
  'persists and reloads spacing %s / %s / %s / %s without saving notes',
  async (lineSpacing, paragraphSpacing, listItemSpacing, editorBottomSpace) => {
    const t = transport()
    const store = new LibraryStore(t)
    await store.open()
    await store.flush()
    t.savePreferences.mockClear()
    const appearance = {
      ...defaultAppearance,
      lineSpacing,
      paragraphSpacing,
      listItemSpacing,
      editorBottomSpace,
    }
    store.setAppearance(appearance)
    expect(store.getSnapshot().appearance).toEqual(appearance)
    await store.flush()
    const saved = t.savePreferences.mock.calls[0][0]
    expect(saved.appearance).toEqual(appearance)
    expect(t.saveNote).not.toHaveBeenCalled()
    t.open.mockResolvedValue({
      notes: [],
      notebooks: [],
      appearance: saved.appearance as typeof appearance,
      preferencesRevision: 2,
      path: 'test-library',
    })
    const reopened = new LibraryStore(t)
    await reopened.open()
    expect(reopened.getSnapshot().appearance).toEqual(appearance)
  },
)

it('persists and reloads cursor preferences without saving notes', async () => {
  const t = transport()
  const store = new LibraryStore(t)
  await store.open()
  await store.flush()
  t.savePreferences.mockClear()
  const appearance = {
    ...defaultAppearance,
    cursorStyle: 'block-outline' as const,
    cursorBlinking: 'phase' as const,
    cursorSmoothCaretAnimation: 'on' as const,
  }
  store.setAppearance(appearance)
  await store.flush()
  const saved = t.savePreferences.mock.calls[0][0]
  expect(saved.appearance).toEqual(appearance)
  expect(t.saveNote).not.toHaveBeenCalled()
  t.open.mockResolvedValue({
    notes: [],
    notebooks: [],
    appearance: saved.appearance as typeof appearance,
    preferencesRevision: 2,
    path: 'test-library',
  })
  const reopened = new LibraryStore(t)
  await reopened.open()
  expect(reopened.getSnapshot().appearance).toEqual(appearance)
})

it('duplicates an unopened body with latest metadata without rolling back saved revisions', async () => {
  const saved = {
    ...note('a'),
    notebookIds: ['work'],
    pinned: true,
    quickAccess: true,
    revision: 1,
    documentVersion: 1,
  }
  const t = transport([saved])
  const gate = deferred<SavedNote>()
  t.load.mockReturnValueOnce(gate.promise)
  const store = new LibraryStore(t)
  await store.open()
  const copying = store.duplicate('a')
  store.setNotes((old) =>
    old.map((n) => ({
      ...n,
      title: 'Latest title',
      notebookIds: ['work', 'personal'],
      tags: ['new'],
    })),
  )
  await store.flush()
  gate.resolve(saved)
  const id = await copying
  const copy = store.getSnapshot().notes.find((n) => n.id === id)!
  expect(copy).toMatchObject({
    title: 'Latest title copy',
    notebookIds: ['work', 'personal'],
    tags: [],
    pinned: false,
    quickAccess: false,
    content: saved.content,
  })
  store.setNotes((old) => old.map((n) => (n.id === 'a' ? { ...n, pinned: false } : n)))
  await store.flush()
  expect(
    t.saveNote.mock.calls.filter(([n]) => n.id === 'a').map(([n]) => n.expectedRevision),
  ).toEqual([1, 2])
  expect(t.saveNote.mock.calls.find(([n]) => n.id === id)?.[0].content).toEqual(saved.content)
})

it('does not create an empty duplicate on load failure and can retry', async () => {
  const t = transport([{ ...note('a'), revision: 1, documentVersion: 1 }])
  t.load.mockRejectedValueOnce(Error('Disk unavailable'))
  const store = new LibraryStore(t)
  await store.open()
  await expect(store.duplicate('a')).rejects.toThrow('Disk unavailable')
  expect(store.getSnapshot().notes).toHaveLength(1)
  expect(await store.duplicate('a')).toBeTruthy()
  expect(store.getSnapshot().notes).toHaveLength(2)
  await store.flush()
})

it('defaults missing appearance preferences and retains saved values on reopening', async () => {
  const t = transport()
  const { animationsEnabled: _, listItemSpacing: __, ...legacy } = defaultAppearance
  t.open.mockResolvedValue({
    notes: [],
    notebooks: [],
    appearance: legacy,
    preferencesRevision: 0,
    path: 'test-library',
  })
  const store = new LibraryStore(t)
  await store.open()
  expect(store.getSnapshot().appearance.animationsEnabled).toBe(true)
  expect(store.getSnapshot().appearance.listItemSpacing).toBe(0)
  expect(store.getSnapshot().appearance.headingStyles).toEqual(defaultAppearance.headingStyles)
  store.setAppearance({
    ...store.getSnapshot().appearance,
    animationsEnabled: false,
    headingStyles: {
      ...store.getSnapshot().appearance.headingStyles,
      h2: { font: 'palatino', weight: 700, italic: true, color: '#216f9c' },
    },
  })
  await store.flush()
  const saved = t.savePreferences.mock.calls.at(-1)![0].appearance as typeof defaultAppearance
  t.open.mockResolvedValue({
    notes: [],
    notebooks: [],
    appearance: saved,
    preferencesRevision: 1,
    path: 'test-library',
  })
  const reopened = new LibraryStore(t)
  await reopened.open()
  expect(reopened.getSnapshot().appearance.animationsEnabled).toBe(false)
  expect(reopened.getSnapshot().appearance.headingStyles.h2).toEqual({
    font: 'palatino',
    weight: 700,
    italic: true,
    color: '#216f9c',
  })
})

it.each([undefined, null, 'unknown', 12])(
  'uses Default for missing or invalid app style %s',
  async (appStyle) => {
    const t = transport()
    t.open.mockResolvedValue({
      notes: [],
      notebooks: [],
      appearance: { ...defaultAppearance, appStyle } as unknown as LibraryData['appearance'],
      preferencesRevision: 0,
      path: 'test-library',
    })
    const store = new LibraryStore(t)
    await store.open()
    expect(store.getSnapshot().appearance.appStyle).toBe('default')
  },
)

it('persists card style and other appearance settings across reopening and switching back', async () => {
  const t = transport()
  const store = new LibraryStore(t)
  await store.open()
  const appearance = {
    ...defaultAppearance,
    appStyle: 'cards' as const,
    theme: 'zen' as const,
    dark: false,
    width: 93,
  }
  store.setAppearance(appearance)
  await store.flush()
  const saved = t.savePreferences.mock.calls.at(-1)![0].appearance as typeof defaultAppearance
  t.open.mockResolvedValue({
    notes: [],
    notebooks: [],
    appearance: saved,
    preferencesRevision: 1,
    path: 'test-library',
  })
  const reopened = new LibraryStore(t)
  await reopened.open()
  expect(reopened.getSnapshot().appearance).toEqual(appearance)
  reopened.setAppearance({ ...reopened.getSnapshot().appearance, appStyle: 'default' })
  await reopened.flush()
  expect(t.savePreferences.mock.calls.at(-1)![0].appearance).toEqual({
    ...appearance,
    appStyle: 'default',
  })
})

it('persists shortcut overrides and explicit clearing through the existing preferences queue', async () => {
  const t = transport()
  const store = new LibraryStore(t)
  await store.open()
  expect(store.getSnapshot().appearance.shortcuts).toBeUndefined()
  const appearance = {
    ...store.getSnapshot().appearance,
    shortcuts: { bold: 'Mod+Alt+b', search: null },
  }
  store.setAppearance(appearance)
  await store.flush()
  const saved = t.savePreferences.mock.calls.at(-1)![0].appearance as typeof appearance
  t.open.mockResolvedValue({
    notes: [],
    notebooks: [],
    appearance: saved,
    preferencesRevision: 1,
    path: 'test',
  })
  const reopened = new LibraryStore(t)
  await reopened.open()
  expect(reopened.getSnapshot().appearance).toEqual(appearance)
  expect(t.saveNote).not.toHaveBeenCalled()
})

it('deletes a notebook in preview while promoting children and preserving shared notes', async () => {
  const store = new LibraryStore(null)
  const books = [
    { id: 'work', name: 'Work', color: '#899ab4', icon: 'briefcase' as const },
    {
      id: 'child',
      name: 'Child',
      color: '#82936f',
      icon: 'notebook' as const,
      parentId: 'work',
    },
    { id: 'personal', name: 'Personal', color: '#ba9775', icon: 'home' as const },
  ]
  store.setNotebooks(books)
  store.setNotes([
    { ...note('direct'), notebookIds: ['work'] },
    { ...note('nested'), notebookIds: ['child'] },
    { ...note('shared'), notebookIds: ['work', 'personal'] },
  ])

  await store.deleteNotebook('work', false, false)
  expect(store.getSnapshot().notebooks.find((book) => book.id === 'work')).toBeUndefined()
  expect(store.getSnapshot().notebooks.find((book) => book.id === 'child')?.parentId).toBeNull()
  expect(store.getSnapshot().notes.find((item) => item.id === 'direct')?.notebookIds).toEqual([])
  expect(store.getSnapshot().notes.find((item) => item.id === 'nested')?.notebookIds).toEqual([
    'child',
  ])
  expect(store.getSnapshot().notes.find((item) => item.id === 'shared')?.notebookIds).toEqual([
    'personal',
  ])
})

it('saves independent list orders, preserves them during tab changes, and retries without note writes', async () => {
  const t = transport()
  const store = new LibraryStore(t)
  await store.open()
  await store.flush()
  store.setNoteList('all', { mode: 'custom', order: ['b', 'a'] })
  store.setNoteList('book:one', { mode: 'title', order: ['a', 'b'] })
  store.setWorkspace({ tabs: [], activeTabId: null })
  const lists = store.getSnapshot().workspace!.noteLists
  expect(lists).toEqual({
    all: { mode: 'custom', order: ['b', 'a'] },
    'book:one': { mode: 'title', order: ['a', 'b'] },
  })
  t.savePreferences.mockRejectedValueOnce(Error('disk full'))
  await expect(store.flush()).rejects.toThrow('disk full')
  await store.flush()
  expect(t.savePreferences.mock.calls.at(-1)![0]).toMatchObject({ workspace: { noteLists: lists } })
  expect(t.saveNote).not.toHaveBeenCalled()
  const saved = store.getSnapshot().workspace
  const reopened = new LibraryStore({
    ...t,
    open: async () => ({ ...(await t.open()), workspace: saved }),
  })
  await reopened.open()
  expect(reopened.getSnapshot().workspace?.noteLists).toEqual(lists)
})

it('persists pane widths across tab-only workspace updates and reopening', async () => {
  const t = transport()
  const store = new LibraryStore(t)
  await store.open()
  await store.flush()

  store.setPaneWidths({ sidebar: 248, noteList: 336 })
  store.setWorkspace({ tabs: [], activeTabId: null })
  expect(store.getSnapshot().workspace?.paneWidths).toEqual({ sidebar: 248, noteList: 336 })

  await store.flush()
  const saved = store.getSnapshot().workspace
  expect(t.savePreferences.mock.calls.at(-1)![0]).toMatchObject({
    workspace: { paneWidths: { sidebar: 248, noteList: 336 } },
  })

  const reopened = new LibraryStore({
    ...t,
    open: async () => ({ ...(await t.open()), workspace: saved }),
  })
  await reopened.open()
  expect(reopened.getSnapshot().workspace?.paneWidths).toEqual({ sidebar: 248, noteList: 336 })
})

it('persists sidebar selection across tab updates, preference saves, and reopening', async () => {
  const t = transport()
  const store = new LibraryStore(t)
  await store.open()
  await store.flush()
  store.setSidebarView('book:empty')
  store.setWorkspace({ tabs: [], activeTabId: null })
  store.setNoteList('book:empty', { mode: 'title', order: [] })
  await store.flush()
  const saved = store.getSnapshot().workspace
  expect(t.savePreferences.mock.calls.at(-1)![0]).toMatchObject({
    workspace: { sidebarView: 'book:empty' },
  })
  const reopened = new LibraryStore({
    ...t,
    open: async () => ({ ...(await t.open()), workspace: saved }),
  })
  await reopened.open()
  expect(reopened.getSnapshot().workspace?.sidebarView).toBe('book:empty')
  reopened.setSidebarView('all')
  expect(reopened.getSnapshot().workspace?.sidebarView).toBe('all')
})

it('reads unloaded search documents without activating notes, mounting editors, or changing edit times', async () => {
  const original = note('a', 'fix twice fix')
  const t = transport([{ ...original, revision: 1, documentVersion: 1 }])
  const store = new LibraryStore(t)
  await store.open()
  const before = store.getSnapshot()
  const result = await store.readSearchNote('a')
  expect(result.content).toEqual(original.content)
  expect(result.updated).toBe(original.updated)
  expect(store.getSnapshot()).toBe(before)
  expect(store.getSnapshot().loaded.has('a')).toBe(false)
  expect(t.saveNote).not.toHaveBeenCalled()
  await store.load('a')
  const loaded = store.getSnapshot().notes[0]
  t.load.mockClear()
  expect(await store.readSearchNote('a')).toBe(loaded)
  expect(t.load).not.toHaveBeenCalled()
})
it('preserves recent notes through workspace updates and reopening, pruning unavailable notes', async () => {
  const t = transport(['a', 'b'].map((id) => ({ ...note(id), revision: 1, documentVersion: 1 })))
  const store = new LibraryStore(t)
  await store.open()
  store.setRecentNotes(['a', 'b', 'a', 'missing'])
  store.setWorkspace({ tabs: [], activeTabId: null })
  expect(store.getSnapshot().workspace?.recentNoteIds).toEqual(['a', 'b'])
  await store.flush()
  const saved = store.getSnapshot().workspace
  const reopened = new LibraryStore({
    ...t,
    open: async () => ({ ...(await t.open()), workspace: saved }),
  })
  await reopened.open()
  expect(reopened.getSnapshot().workspace?.recentNoteIds).toEqual(['a', 'b'])
  reopened.setNotes((notes) => notes.map((note) => ({ ...note, trashed: note.id === 'a' })))
  reopened.setRecentNotes(['a', 'b'])
  expect(reopened.getSnapshot().workspace?.recentNoteIds).toEqual(['b'])
  expect(reopened.getSnapshot().notes.map((note) => note.updated)).toEqual([1, 1])
})
