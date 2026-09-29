// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import TitleBar, { searchNotes } from './TitleBar'
import { defaultAppearance } from '../storage/library'
import type { Note } from '../model'

const notes: Note[] = [
  {
    id: 'a',
    title: 'ALPHA',
    text: 'first body #garden',
    tags: ['garden'],
    notebookIds: ['one'],
    quickAccess: false,
    updated: 1,
    trashed: false,
    pinned: true,
  },
  {
    id: 'b',
    title: 'Beta',
    text: 'alpha in unloaded body',
    tags: [],
    notebookIds: ['two'],
    quickAccess: false,
    updated: 3,
    trashed: false,
    pinned: false,
  },
  {
    id: 'c',
    title: 'Alpha deleted',
    text: '',
    tags: [],
    notebookIds: ['one'],
    quickAccess: false,
    updated: 9,
    trashed: true,
    pinned: false,
  },
].map((note) => ({ ...note, content: { type: 'doc', content: [] } }))
it('searches all notebooks and summary text without loaded documents, excludes Trash, and sorts by edited time', () => {
  expect(searchNotes(notes, ' ALpHa ').map((n) => n.id)).toEqual(['b', 'a'])
  expect(searchNotes(notes, 'GARDEN').map((n) => n.id)).toEqual(['a'])
  expect(searchNotes(notes, 'missing')).toEqual([])
  expect(searchNotes(notes, '  ')).toEqual([])
  expect(notes.map((n) => n.id)).toEqual(['a', 'b', 'c'])
})
const containers: { host: HTMLDivElement; root: ReturnType<typeof createRoot> }[] = []
afterEach(async () => {
  for (const { host, root } of containers.splice(0)) {
    await act(() => root.unmount())
    host.remove()
  }
})
it('opens with shortcut, focuses input, selects with arrows/Enter, and restores trigger focus', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  Element.prototype.scrollIntoView = vi.fn()
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  containers.push({ host, root })
  const onSelect = vi.fn(),
    onNewNote = vi.fn(),
    onToggleSidebar = vi.fn()
  await act(() =>
    root.render(
      <TitleBar
        notes={notes}
        notebooks={[]}
        appearance={defaultAppearance}
        sidebarVisible
        disabled={false}
        onSelect={onSelect}
        onNewNote={onNewNote}
        onToggleSidebar={onToggleSidebar}
      />,
    ),
  )
  const trigger = host.querySelector('.global-search-trigger') as HTMLButtonElement
  trigger.focus()
  await act(() =>
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, shiftKey: true, bubbles: true }),
    ),
  )
  const input = document.querySelector('[role="combobox"]') as HTMLInputElement
  expect(document.activeElement).toBe(input)
  expect(input.classList.contains('text-field')).toBe(true)
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'alpha')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(document.querySelectorAll('[role="option"]')).toHaveLength(2)
  await act(() =>
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })),
  )
  await act(() =>
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })),
  )
  expect(onSelect).toHaveBeenCalledWith('a')
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  expect(document.activeElement).toBe(trigger)
  await act(() => trigger.click())
  expect((document.querySelector('[role="combobox"]') as HTMLInputElement).value).toBe('')
  await act(() =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
  )
  expect(onSelect).toHaveBeenCalledTimes(1)
  await act(() => (host.querySelector('[aria-label="New note"]') as HTMLButtonElement).click())
  await act(() => (host.querySelector('[aria-label="Hide sidebar"]') as HTMLButtonElement).click())
  expect(onNewNote).toHaveBeenCalledTimes(1)
  expect(onToggleSidebar).toHaveBeenCalledTimes(1)
})
