// @vitest-environment jsdom
import * as tauriCore from '@tauri-apps/api/core'
import { onBackButtonPress } from '@tauri-apps/api/app'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import MobileApp from './MobileApp'
import { library } from '../storage/useLibrary'
import { clearSessions, getEditor } from '../editor/session'
import { platform } from '../platform'
import type { Note } from '../model'
import { initialNavigation, mobileNavigation } from './navigation'
vi.mock('@tauri-apps/api/core', async (importOriginal) => ({
  ...(await importOriginal<typeof tauriCore>()),
  isTauri: vi.fn(() => false),
  invoke: vi.fn(async () => undefined),
}))
vi.mock('@tauri-apps/api/app', () => ({
  onBackButtonPress: vi.fn(async () => ({ unregister: vi.fn() })),
}))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
Element.prototype.scrollIntoView = vi.fn()
Element.prototype.scrollBy = vi.fn()
window.scrollBy = vi.fn()
Range.prototype.getClientRects = () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () =>
  ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }) as DOMRect
let root: ReturnType<typeof createRoot>
let host: HTMLDivElement
const makeNote = (id: string, book: string): Note => ({
  id,
  title: id,
  notebookIds: [book],
  quickAccess: false,
  tags: [],
  pinned: false,
  trashed: false,
  updated: 1,
  text: `Body ${id}`,
  content: {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: `Body ${id}` }] }],
  },
})
beforeEach(async () => {
  platform.mobile = true
  library.setNotebooks([
    { id: 'parent', name: 'Parent', icon: 'book', color: '#82936f' },
    { id: 'child', name: 'Child', parentId: 'parent', icon: 'book', color: '#82936f' },
  ])
  library.setNotes([makeNote('Direct note', 'parent'), makeNote('Nested note', 'child')])
  vi.mocked(tauriCore.isTauri).mockReturnValue(true)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(<MobileApp />))
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  clearSessions()
  vi.mocked(tauriCore.isTauri).mockReturnValue(false)
  platform.mobile = false
  vi.restoreAllMocks()
  delete document.documentElement.dataset.platform
})
const find = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.getAttribute('aria-label') === label || b.textContent?.trim() === label,
  )!
async function click(label: string) {
  const b = find(label)
  expect(b, label).toBeTruthy()
  await act(async () => b.click())
}
async function androidBack() {
  const callback = vi.mocked(onBackButtonPress).mock.calls.at(-1)![0]
  await act(async () => callback({ canGoBack: false }))
}
async function input(label: string, value: string) {
  const el = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
it('keeps expansion separate from navigation and lists only direct notes below children', async () => {
  await click('Open navigation')
  await click('Collapse Parent')
  expect(document.querySelector('[aria-label="Expand Parent"]')).toBeTruthy()
  expect(document.querySelector('.mobile-header h1')?.textContent).toBe('All notes')
  expect(document.querySelector('.mobile-heading-icon')).toBeNull()
  const parent = document.querySelector<HTMLButtonElement>('.mobile-book-label')!
  await act(async () => parent.click())
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(document.querySelector('.mobile-header h1')?.textContent).toBe('Parent')
  const headingIcon = document.querySelector<SVGElement>('.mobile-heading-icon')
  expect(headingIcon?.getAttribute('aria-hidden')).toBe('true')
  expect(headingIcon?.style.color).toBe('rgb(130, 147, 111)')
  expect(document.querySelector('.mobile-subnotebooks')?.textContent).toContain('Child')
  expect(document.querySelector('section[aria-label="Notes"]')?.textContent).toContain(
    'Direct note',
  )
  expect(document.querySelector('section[aria-label="Notes"]')?.textContent).not.toContain(
    'Nested note',
  )
  expect(
    document.querySelector('.mobile-list')?.firstElementChild?.getAttribute('aria-label'),
  ).toBe('Sub-notebooks')
})
it('shows only the drawer and note actions in the note header', async () => {
  await click('Direct note')
  const header = document.querySelector('.mobile-note-header')!
  expect([...header.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))).toEqual([
    'Open navigation',
    'Note actions',
  ])
  expect(header.textContent).toBe('')
  expect(document.querySelector('.mobile-save-status')).toBeNull()
  await click('Open navigation')
  expect(document.querySelector('[role="dialog"]')).toBeTruthy()
  await androidBack()
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(document.querySelector('.note-title')).toBeTruthy()
  await click('Note actions')
  expect(document.querySelector('[role="dialog"]')).toBeTruthy()
  await androidBack()
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(document.querySelector('.note-title')).toBeTruthy()
})
it('returns to the search and scroll position without opening the keyboard on an existing note', async () => {
  await click('Search notes')
  await input('Search notes', 'Direct')
  document.querySelector<HTMLElement>('.mobile-list')!.scrollTop = 125
  await click('Direct note')
  expect(document.activeElement?.getAttribute('aria-label')).not.toBe('Note title')
  expect(document.querySelector('.writing-cursor-layer')).toBeNull()
  await androidBack()
  expect(document.querySelector<HTMLInputElement>('input[aria-label="Search notes"]')!.value).toBe(
    'Direct',
  )
  expect(document.querySelector('.mobile-list')!.scrollTop).toBe(125)
})
it('blocks navigation when saving fails and preserves the note for retry', async () => {
  await click('Direct note')
  const flush = vi.spyOn(library, 'flush').mockRejectedValueOnce(Error('Disk full'))
  await androidBack()
  expect(document.querySelector('.note-title')).toBeTruthy()
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('Disk full')
  flush.mockResolvedValue(undefined)
  await click('Retry')
  await androidBack()
  expect(document.querySelector('.mobile-list')).toBeTruthy()
})
it('focuses a new title after the navigation guard unlocks editing, and title keys enter the body', async () => {
  await click('New note')
  const title = document.querySelector<HTMLTextAreaElement>('.note-title')!
  expect(title.disabled).toBe(false)
  expect(document.activeElement).toBe(title)
  for (const key of ['Enter', 'ArrowDown']) {
    title.focus()
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
    await act(async () => {
      title.dispatchEvent(event)
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
    expect(event.defaultPrevented).toBe(true)
    expect(document.activeElement?.classList.contains('tiptap')).toBe(true)
  }
})
it('opens settings categories as pages, preserves values, and hides desktop-only settings', async () => {
  await click('Open navigation')
  await click('Settings')
  expect(document.querySelector('[aria-label="Theme"]')).toBeNull()
  await click('Typography')
  const picker = document.querySelector<HTMLSelectElement>('[aria-label="Note font"]')!
  expect([...picker.options].map((o) => o.textContent)).toEqual([
    'System sans',
    'System serif',
    'System monospace',
  ])
  await act(async () => {
    picker.value = 'system'
    picker.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await click('Back')
  await click('Typography')
  expect(document.querySelector<HTMLSelectElement>('[aria-label="Note font"]')!.value).toBe(
    'system',
  )
  await click('Back')
  await click('Editor')
  expect(document.querySelector('[aria-label="Cursor style"]')).toBeNull()
  expect(document.querySelector('[aria-label="Writing width"]')).toBeNull()
  expect(document.querySelector('[aria-label="Line spacing"]')).toBeTruthy()
  expect(document.querySelector('[aria-label="List item spacing"]')).toBeTruthy()
})
it('applies formatting to the selected text with undo and redo using the shared editor', async () => {
  await click('Direct note')
  const editor = getEditor('Direct note', library.getSnapshot().notes[0].content)
  await act(async () => {
    editor.commands.setTextSelection({ from: 1, to: 5 })
  })
  await click('Bold')
  expect(editor.getJSON().content?.[0].content?.[0].marks?.[0].type).toBe('bold')
  await click('Undo')
  expect(editor.getJSON().content?.[0].content?.[0].marks).toBeUndefined()
  await click('Redo')
  expect(editor.getJSON().content?.[0].content?.[0].marks?.[0].type).toBe('bold')
})
it('keeps settings and nested notebook history typed and bounded at the library root', () => {
  const initial = initialNavigation()
  expect(mobileNavigation(initial, { type: 'back' })).toBe(initial)
  const nested = mobileNavigation(initial, {
    type: 'push',
    route: { kind: 'settings', category: 'sync' },
  })
  expect(mobileNavigation(nested, { type: 'back' })).toEqual(initial)
})
