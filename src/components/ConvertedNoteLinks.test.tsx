// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import NoteEditor from './NoteEditor'
import { defaultAppearance } from '../storage/library'
import { getEditor, clearSessions } from '../editor/session'
import { pendingFragments } from '../editor/fileNavigation'
import type { Note } from '../model'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
afterEach(async () => {
  await act(async () => root.unmount())
  clearSessions()
  pendingFragments.clear()
  host.remove()
})
it('opens native links with labels and reveals heading fragments in native notes', async () => {
  const note: Note = {
    id: 'converted-link-test',
    title: 'Native',
    notebookIds: [],
    quickAccess: false,
    tags: [],
    pinned: false,
    trashed: false,
    updated: 1,
    text: '',
    content: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Read more',
              marks: [{ type: 'link', attrs: { href: 'upnote2://note/target#section' } }],
            },
          ],
        },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Section' }] },
      ],
    },
  }
  pendingFragments.set(note.id, 'section')
  const open = vi.fn()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () =>
    root.render(
      <NoteEditor
        note={note}
        cursorSettings={defaultAppearance}
        onOpenTag={vi.fn()}
        onChange={vi.fn()}
        noteLinks={{ notes: () => [], create: () => undefined, open }}
      />,
    ),
  )
  const editor = getEditor(note.id, note.content)
  expect(editor.state.selection.$from.parent.type.name).toBe('heading')
  expect(pendingFragments.has(note.id)).toBe(false)
  const link = host.querySelector<HTMLAnchorElement>('a[href^="upnote2:"]')!
  expect(link.textContent).toBe('Read more')
  await act(async () =>
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })),
  )
  expect(open).toHaveBeenCalledWith('target', false)
  expect(pendingFragments.get('target')).toBe('section')
})
