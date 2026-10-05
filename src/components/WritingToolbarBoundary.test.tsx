// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import NoteEditor from './NoteEditor'
import { defaultAppearance } from '../storage/library'
import { clearSessions } from '../editor/session'
import { platform } from '../platform'
import type { Note } from '../model'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
Element.prototype.scrollIntoView = vi.fn()
let root: ReturnType<typeof createRoot>
let host: HTMLDivElement
afterEach(async () => {
  await act(async () => root.unmount())
  clearSessions()
  host.remove()
  platform.mobile = false
})
async function mount(source?: Note['source']) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const note: Note = {
    id: 'toolbar-boundary',
    title: 'Test',
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
    text: '',
    notebookIds: [],
    quickAccess: false,
    tags: [],
    pinned: false,
    trashed: false,
    updated: 1,
    source,
  }
  await act(async () =>
    root.render(
      <NoteEditor
        note={note}
        cursorSettings={defaultAppearance}
        onChange={vi.fn()}
        onOpenTag={vi.fn()}
        noteLinks={{ notes: () => [], create: () => undefined, open: vi.fn() }}
      />,
    ),
  )
}
it('retains the existing mobile toolbar and writing panel entry points', async () => {
  platform.mobile = true
  await mount()
  expect(host.querySelector('.desktop-writing-toolbar')).toBeNull()
  expect(host.querySelector('[aria-label="Text and highlight colors"]')).not.toBeNull()
  expect(host.querySelector('[aria-label="Insert checkbox"]')).not.toBeNull()
})
it('retains the existing linked Markdown controls and formatting restrictions', async () => {
  await mount({ rootId: 'root', relativePath: 'test.md', fingerprint: 'test', markdown: 'Text' })
  expect(host.querySelector('.desktop-writing-toolbar')).toBeNull()
  expect(host.querySelector('[aria-label="Insert link or image"]')).not.toBeNull()
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Highlight"]')!.disabled).toBe(true)
})
