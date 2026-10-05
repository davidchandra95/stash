// @vitest-environment jsdom
import { act, type ComponentProps } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import TitleBar from './TitleBar'
import { hoverTooltip, tooltipLabel } from './tooltipTestUtils'
import { ShortcutContext } from '../useShortcuts'
import { defaultAppearance } from '../storage/library'
import type { Note, Notebook } from '../model'

const notes: Note[] = [
  {
    id: 'a',
    title: 'ALPHA',
    text: 'first body #garden',
    tags: ['garden'],
    notebookIds: ['one', 'extra'],
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
].map((note) => ({
  ...note,
  content: {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: note.text || 'Empty' }] }],
  },
}))
const containers: { host: HTMLDivElement; root: ReturnType<typeof createRoot> }[] = []
afterEach(async () => {
  for (const { host, root } of containers.splice(0)) {
    await act(() => root.unmount())
    host.remove()
  }
})

const readSearchNote = vi.fn(async (id: string) => notes.find((note) => note.id === id)!)
async function mount(
  overrides = {},
  notebooks: Notebook[] = [],
  props: Partial<ComponentProps<typeof TitleBar>> = {},
) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  Element.prototype.scrollIntoView = vi.fn()
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  containers.push({ host, root })
  const onSelect = vi.fn(),
    onSelectMatch = vi.fn()
  await act(() =>
    root.render(
      <ShortcutContext.Provider value={overrides}>
        <TitleBar
          notes={notes}
          notebooks={notebooks}
          appearance={defaultAppearance}
          sidebarVisible
          noteListVisible
          noteListAvailable
          disabled={false}
          onSelect={onSelect}
          onSelectMatch={onSelectMatch}
          readSearchNote={readSearchNote}
          recentNoteIds={['b', 'a']}
          onToggleSidebar={vi.fn()}
          onToggleNoteList={vi.fn()}
          {...props}
        />
      </ShortcutContext.Provider>,
    ),
  )
  return { host, onSelect, onSelectMatch }
}
const press = async (key: string, extra: KeyboardEventInit = {}, target: EventTarget = document) =>
  act(async () => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', {
        key,
        ctrlKey: key.length === 1,
        bubbles: true,
        cancelable: true,
        ...extra,
      }),
    )
  })
async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
it('opens title lookup inline, shows recent notes, excludes bodies, and supports keyboard selection and reset', async () => {
  const { host, onSelect } = await mount()
  expect(host.querySelector('[aria-label="New note"]')).toBeNull()
  expect(host.querySelector('[role="tablist"]')).toBeNull()
  expect(host.querySelector('[aria-label="Back to previous note"]')).not.toBeNull()
  expect(host.querySelector('[aria-label="Forward to next note"]')).not.toBeNull()
  await press('p')
  const input = host.querySelector<HTMLInputElement>('[aria-label="Find notes"]')!
  expect(document.activeElement).toBe(input)
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(
    [...document.querySelectorAll('.quick-open-result strong')].map((node) => node.textContent),
  ).toEqual(['Beta', 'ALPHA'])
  expect(document.querySelector('.quick-open-match')).toBeNull()
  await type(input, 'alpha')
  expect(document.querySelectorAll('.quick-open-result')).toHaveLength(1)
  expect(document.querySelector('.quick-open-match')?.textContent).toBe('ALPHA')
  await type(input, 'ap')
  expect(
    [...document.querySelectorAll('.quick-open-match')].map((node) => node.textContent),
  ).toEqual(['A', 'P'])
  expect(document.querySelector('.quick-open-result strong')?.textContent).toBe('ALPHA')
  expect(document.querySelector('.quick-open-result')?.getAttribute('aria-label')).toBe(
    'ALPHA, Uncategorized',
  )
  await hoverTooltip(document.querySelector('.quick-open-result small')!, 'mouse', 700)
  expect(tooltipLabel()).toBe('Uncategorized')
  expect(document.querySelector('.quick-open-result small')?.hasAttribute('title')).toBe(false)
  await type(input, 'alpha')
  await press('Enter', {}, input)
  expect(onSelect).toHaveBeenCalledWith('a', undefined)
  expect(document.querySelector('.quick-open-popup')).toBeNull()
  await press('p')
  expect(input.value).toBe('')
  await press('ArrowDown', {}, input)
  await press('Enter', { ctrlKey: true }, input)
  expect(onSelect).toHaveBeenLastCalledWith('a', true)
})
it('keeps full notebook context accessible without searching or highlighting it', async () => {
  const { host, onSelect } = await mount({}, [
    { id: 'one', name: 'Personal notebook with a long name', color: '', icon: 'notebook' },
    { id: 'extra', name: 'Second notebook', color: '', icon: 'notebook' },
  ])
  await press('p')
  const input = host.querySelector<HTMLInputElement>('[aria-label="Find notes"]')!
  await type(input, 'ap')
  const row = document.querySelector<HTMLElement>('.quick-open-result')!
  const context = 'Personal notebook with a long name, Second notebook'
  expect(row.getAttribute('aria-label')).toBe(`ALPHA, ${context}`)
  await hoverTooltip(row.querySelector('strong')!, 'mouse', 700)
  expect(tooltipLabel()).toBe('ALPHA')
  await hoverTooltip(row.querySelector('small')!, 'mouse', 700)
  expect(tooltipLabel()).toBe(context)
  expect(row.querySelector('small .quick-open-match')).toBeNull()
  await act(() => row.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true })))
  expect(onSelect).toHaveBeenCalledWith('a', true)
  await press('p')
  await type(input, 'Personal')
  expect(document.querySelector('.quick-open-result')).toBeNull()
})
it('opens body search separately, highlights grouped occurrences, and returns the selected match', async () => {
  const { host, onSelectMatch } = await mount()
  await press('f', { shiftKey: true })
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Search note content"]')!
  expect(document.activeElement).toBe(input)
  expect(document.querySelector('[role="dialog"]')).toBeTruthy()
  await type(input, 'alpha')
  expect(document.querySelectorAll('.content-search-group')).toHaveLength(1)
  expect(document.querySelector('.content-search-heading strong')?.textContent).toBe('Beta')
  expect(document.querySelector('mark.target-match')?.textContent).toBe('alpha')
  await press('Enter', {}, input)
  expect(onSelectMatch).toHaveBeenCalledWith(
    expect.objectContaining({
      noteId: 'b',
      query: 'alpha',
      match: expect.objectContaining({ offset: 0 }),
    }),
    false,
  )
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="Search note content"]')!.click(),
  )
  expect(
    document.querySelector<HTMLInputElement>('input[aria-label="Search note content"]')!.value,
  ).toBe('')
  await press('Escape')
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  expect(document.activeElement).toBe(host.querySelector('[aria-label="Search note content"]'))
})
it('switches between surfaces and respects custom bindings', async () => {
  const { host } = await mount({ 'quick-open': 'Mod+Alt+p', search: 'Mod+Alt+f' })
  await press('p')
  expect(document.querySelector('.quick-open-popup')).toBeNull()
  await press('p', { altKey: true })
  expect(document.querySelector('.quick-open-popup')).toBeTruthy()
  await press('f', { altKey: true })
  expect(document.querySelector('.quick-open-popup')).toBeNull()
  const content = document.querySelector<HTMLInputElement>(
    'input[aria-label="Search note content"]',
  )!
  await press('p', { altKey: true }, content)
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(document.querySelector('.quick-open-popup')).toBeTruthy()
  expect(document.activeElement).toBe(host.querySelector('[aria-label="Find notes"]'))
  await press('Escape', {}, document.activeElement!)
  expect(document.querySelector('.quick-open-popup')).toBeNull()
})

it('orders app-bar navigation before search and retains the sidebar toggle', async () => {
  const onBack = vi.fn(),
    onForward = vi.fn(),
    onToggleSidebar = vi.fn()
  const { host } = await mount({}, [], {
    canBack: true,
    canForward: true,
    onBack,
    onForward,
    onToggleSidebar,
  })
  expect(
    [...host.querySelectorAll('.title-bar-controls button, .title-bar-controls input')].map(
      (node) => node.getAttribute('aria-label'),
    ),
  ).toEqual(['Back to previous note', 'Forward to next note', 'Find notes', 'Search note content'])
  await act(() => {
    host.querySelector<HTMLButtonElement>('[aria-label="Back to previous note"]')!.click()
    host.querySelector<HTMLButtonElement>('[aria-label="Forward to next note"]')!.click()
    host.querySelector<HTMLButtonElement>('.title-bar-left button')!.click()
  })
  expect(onBack).toHaveBeenCalledOnce()
  expect(onForward).toHaveBeenCalledOnce()
  expect(onToggleSidebar).toHaveBeenCalledOnce()
  expect(host.querySelector('.title-bar')?.hasAttribute('data-tauri-drag-region')).toBe(true)
})

it.each([true, false])(
  'labels and exposes Notes visibility %s with an instant tooltip',
  async (visible) => {
    const onToggleNoteList = vi.fn()
    const { host } = await mount({}, [], { noteListVisible: visible, onToggleNoteList })
    const label = visible ? 'Hide notes list' : 'Show notes list'
    const toggle = host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!
    expect(toggle.getAttribute('aria-expanded')).toBe(String(visible))
    expect(toggle.getAttribute('aria-controls')).toBe('note-list')
    expect(toggle.previousElementSibling?.getAttribute('aria-label')).toBe('Hide sidebar')
    await hoverTooltip(toggle, 'mouse', 0)
    expect(tooltipLabel()).toBe(label)
    await act(() => toggle.click())
    expect(onToggleNoteList).toHaveBeenCalledOnce()
  },
)

it.each([{ disabled: true }, { noteListAvailable: false }])(
  'disables Notes when unavailable: %j',
  async (props) => {
    const onToggleNoteList = vi.fn()
    const { host } = await mount({}, [], { ...props, noteListVisible: false, onToggleNoteList })
    const toggle = host.querySelector<HTMLButtonElement>('[aria-label="Show notes list"]')!
    expect(toggle.disabled).toBe(true)
    await act(() => toggle.click())
    expect(onToggleNoteList).not.toHaveBeenCalled()
  },
)
