// @vitest-environment jsdom
import { act, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { it, expect, vi } from 'vitest'
import NoteTools from '../components/NoteTools'
import NoteEditor from '../components/NoteEditor'
import type { Note } from '../model'
import { LibraryStore, defaultAppearance, type SavedNote, type Transport } from '../storage/library'
import { clearSessions, resetSession } from './session'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
Element.prototype.scrollIntoView = vi.fn()
Range.prototype.getClientRects = () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () =>
  ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }) as DOMRect
it('replaces a mounted linked editor when the disk version changes', async () => {
  const initial: SavedNote = {
    id: 'a',
    title: 'a',
    notebookIds: ['root'],
    quickAccess: false,
    tags: [],
    text: 'initial',
    pinned: false,
    trashed: false,
    updated: 1,
    revision: 1,
    documentVersion: 1,
    source: {
      rootId: 'root',
      relativePath: 'a.md',
      fingerprint: 'one',
      markdown: '# Initial\n\nBody',
    },
  }
  let disk = initial
  const transport: Transport = {
    open: async () => ({
      notes: [initial],
      notebooks: [
        {
          id: 'root',
          name: 'Root',
          color: '#abc',
          icon: 'folder',
          rootId: 'root',
          relativePath: '',
        },
      ],
      appearance: defaultAppearance,
      preferencesRevision: 1,
      path: '/test',
    }),
    load: async () => disk,
    saveNote: async () => ({ revision: 2, updated: 2 }),
    savePreferences: async () => ({ revision: 2, updated: 2 }),
    quit: async () => {},
  }
  const library = new LibraryStore(transport)
  await library.open()
  await library.load('a')
  function View() {
    const state = useSyncExternalStore(library.subscribe, library.getSnapshot)
    return (
      <>
        <NoteTools
          note={state.notes[0]}
          contentsOpen={true}
          findOpen={false}
          onFindOpenChange={() => {}}
          disabled={false}
        />
        <NoteEditor
          note={state.notes[0]}
          cursorSettings={defaultAppearance}
          onOpenTag={() => {}}
          onChange={() => {}}
          noteLinks={{ notes: () => [], create: () => undefined, open: () => {} }}
        />
      </>
    )
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<View />))
    expect(host.textContent).toContain('Initial')
    disk = {
      ...initial,
      revision: 2,
      source: { ...initial.source!, fingerprint: 'two', markdown: '# External\n\nUpdated' },
    }
    await act(async () => library.activate('a'))
    expect(host.textContent).toContain('External')
  } finally {
    await act(async () => root.unmount())
    clearSessions()
    host.remove()
  }
})

it('cleans up a mounted native editor after its session is destroyed', async () => {
  const note: Note = {
    id: 'native-destroyed-before-unmount',
    title: 'Native',
    notebookIds: [],
    quickAccess: false,
    tags: [],
    text: 'Body',
    pinned: false,
    trashed: false,
    updated: 1,
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body' }] }],
    },
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () =>
      root.render(
        <NoteEditor
          note={note}
          cursorSettings={defaultAppearance}
          onOpenTag={() => {}}
          onChange={() => {}}
          noteLinks={{ notes: () => [], create: () => undefined, open: () => {} }}
        />,
      ),
    )
    await act(async () => {
      resetSession(note.id)
      root.unmount()
    })
  } finally {
    clearSessions()
    host.remove()
  }
})
