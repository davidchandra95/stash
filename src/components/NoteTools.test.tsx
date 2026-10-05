// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import NoteTools from './NoteTools'
import { getEditor, clearSessions } from '../editor/session'
import type { Note } from '../model'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
Element.prototype.scrollIntoView = vi.fn()
Range.prototype.getClientRects = () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () => new DOMRect()
let host: HTMLDivElement, root: ReturnType<typeof createRoot>
const note: Note = {
  id: 'replace-ui',
  title: 'cat title',
  content: {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'cat cat ' },
          { type: 'noteReference', attrs: { noteId: 'other', fallbackTitle: 'cat' } },
        ],
      },
    ],
  },
  text: 'cat cat cat',
  notebookIds: [],
  quickAccess: false,
  tags: [],
  pinned: false,
  trashed: false,
  updated: 1,
}
const editor = () => getEditor(note.id, note.content)
const render = (readOnly = false, disabled = false) =>
  root.render(
    <NoteTools
      note={note}
      contentsOpen={false}
      findOpen
      onFindOpenChange={vi.fn()}
      disabled={disabled}
      readOnly={readOnly}
    />,
  )
async function mount() {
  host = document.createElement('div')
  host.innerHTML = '<div id="note-find-slot"></div><div class="note-title-highlights"></div>'
  document.body.append(host)
  root = createRoot(host.appendChild(document.createElement('div')))
  await act(async () => render())
}
async function click(label: string) {
  const target = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.getAttribute('aria-label') === label || b.textContent === label,
  )!
  expect(target).toBeDefined()
  await act(async () => target.click())
}
async function input(label: string, value: string) {
  const field = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!
  await act(async () => {
    field.focus()
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
  return field
}
const button = (label: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label)!
afterEach(async () => {
  if (root) await act(async () => root.unmount())
  clearSessions()
  host?.remove()
})
it('keeps title/reference matches searchable and replaces only body text, refreshing counts and field focus', async () => {
  await mount()
  await input('Find in current note', 'cat')
  expect(host.querySelector('[role="status"]')!.textContent).toBe('1 of 4')
  await click('Show replacement')
  const field = await input('Replace with', 'dog')
  expect(button('Replace').disabled).toBe(true)
  expect(button('Replace all').disabled).toBe(false)
  await click('Replace all')
  expect(editor().state.doc.textContent).toBe('dog dog ')
  expect(host.querySelector('[role="status"]')!.textContent).toContain('of 2')
  expect(document.activeElement).toBe(field)
  expect(note.title).toBe('cat title')
  await click('Next match')
  expect(button('Replace').disabled).toBe(true)
  await act(async () => editor().commands.undo())
  expect(editor().state.doc.firstChild?.textContent).toBe('cat cat ')
  expect(host.querySelector('[role="status"]')!.textContent).toContain('of 4')
})
it('replaces current body matches individually and each action is one Undo step', async () => {
  await mount()
  await input('Find in current note', 'cat')
  await click('Show replacement')
  await input('Replace with', 'cat dog')
  await click('Next match')
  expect(button('Replace').disabled).toBe(false)
  await click('Replace')
  expect(editor().state.doc.textContent).toBe('cat dog cat ')
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Replace with')
  expect(host.querySelector('[role="status"]')!.textContent).toBe('3 of 4')
  await input('Replace with', '')
  await click('Replace')
  expect(editor().state.doc.textContent).toBe('cat dog  ')
  await act(async () => editor().commands.undo())
  expect(editor().state.doc.textContent).toBe('cat dog cat ')
  await act(async () => editor().commands.undo())
  expect(editor().state.doc.textContent).toBe('cat cat ')
})
it('allows searching a read-only note and revokes stale replacement actions when busy', async () => {
  await mount()
  await input('Find in current note', 'cat')
  await click('Show replacement')
  await input('Replace with', 'dog')
  const old = button('Replace all'),
    before = editor().getJSON()
  await act(async () => render(true))
  expect(
    host.querySelector<HTMLInputElement>('input[aria-label="Find in current note"]')!.disabled,
  ).toBe(false)
  expect(button('Replace all').disabled).toBe(true)
  await act(async () => old.click())
  expect(editor().getJSON()).toEqual(before)
  await act(async () => render(false, true))
  expect(button('Replace all').disabled).toBe(true)
  await act(async () => old.click())
  expect(editor().getJSON()).toEqual(before)
})
