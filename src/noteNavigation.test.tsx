// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import App from './App'
import { library } from './storage/useLibrary'
import { clearSessions, getEditor } from './editor/session'
import type { Note } from './model'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
Element.prototype.scrollIntoView = vi.fn()
Range.prototype.getClientRects = () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () =>
  ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }) as DOMRect
it('opens links across filters, restores source selection and scroll, and explains trashed targets', async () => {
  const source: Note = {
    id: 'source',
    title: 'Source',
    notebookIds: ['work'],
    quickAccess: false,
    tags: [],
    pinned: true,
    trashed: false,
    updated: 1,
    text: 'Target',
    content: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'noteReference', attrs: { noteId: 'target', fallbackTitle: 'Target' } },
          ],
        },
      ],
    },
  }
  const target: Note = {
    ...source,
    id: 'target',
    title: 'Target',
    notebookIds: [],
    quickAccess: false,
    pinned: false,
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Target' }] }],
    },
  }
  library.setNotebooks([{ id: 'work', name: 'Work', color: '#888888', icon: 'briefcase' }])
  library.setNotes([source, target])
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const title = () => host.querySelector<HTMLInputElement>('[aria-label="Note title"]')?.value
  const selectedSection = () => host.querySelector('.list-heading-title')?.textContent
  const button = (label: string) =>
    host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!
  try {
    await act(async () => root.render(<App />))
    const notebook = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === 'Work1',
    )!
    expect(notebook).toBeTruthy()
    await act(async () => notebook.click())
    expect(selectedSection()).toBe('Work')
    const headingIcon = host.querySelector<SVGElement>('.list-heading-icon')
    expect(headingIcon?.getAttribute('aria-hidden')).toBe('true')
    expect(headingIcon?.style.color).toBe('rgb(136, 136, 136)')
    expect(title()).toBe('Source')
    const editor = getEditor(source.id, source.content)
    await act(async () => {
      editor.commands.setNodeSelection(1)
    })
    const selection = editor.state.selection.toJSON()
    host.querySelector('.note-scroll')!.scrollTop = 123
    await act(async () => host.querySelector<HTMLElement>('.note-reference')!.click())
    expect(selectedSection()).toBe('Work')
    expect(title()).toBe('Target')
    await act(async () => button('Search note content').click())
    const search = document.querySelector<HTMLInputElement>(
      'input[aria-label="Search note content"]',
    )!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        search,
        'Target',
      )
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const targetResult = [...document.querySelectorAll<HTMLElement>('.global-search-result')].find(
      (result) =>
        result.closest('.content-search-group')?.querySelector('strong')?.textContent === 'Target',
    )!
    await act(async () => targetResult.click())
    expect(selectedSection()).toBe('Work')
    await act(async () =>
      library.setNotes((old) =>
        old.map((n) => (n.id === 'target' ? { ...n, title: 'Renamed' } : n)),
      ),
    )
    await act(async () => button('Back to previous note').click())
    expect(title()).toBe('Source')
    expect(host.querySelector('.note-reference')?.textContent).toBe('Renamed')
    expect(editor.state.selection.toJSON()).toEqual(selection)
    expect(host.querySelector('.note-scroll')?.scrollTop).toBe(123)
    expect(host.querySelector('.note-list')?.textContent ?? host.textContent).toContain('Source')
    await act(async () =>
      library.setNotes((old) => old.map((n) => (n.id === 'target' ? { ...n, trashed: true } : n))),
    )
    await act(async () => host.querySelector<HTMLElement>('.note-reference')!.click())
    expect(title()).toBe('Source')
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('in Trash')
  } finally {
    await act(async () => root.unmount())
    host.remove()
    clearSessions()
  }
})
