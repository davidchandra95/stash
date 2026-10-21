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
const trigger = (host: HTMLElement) =>
  host.querySelector<HTMLButtonElement>('[aria-label="Search notes or run a command"]')!
const palette = () => document.querySelector<HTMLInputElement>('.command-palette input')!
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
it('opens the palette on title lookup, shows recent notes, excludes bodies, and supports keyboard selection and reset', async () => {
  const { host, onSelect } = await mount()
  expect(host.querySelector('[aria-label="Back to previous note"]')).not.toBeNull()
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  await press('p')
  const input = palette()
  expect(document.querySelector('[role="dialog"]')).toBeTruthy()
  expect(input.getAttribute('aria-label')).toBe('Find note titles')
  expect(document.activeElement).toBe(input)
  expect(
    [...document.querySelectorAll('.palette-result strong')].map((node) => node.textContent),
  ).toEqual(['Beta', 'ALPHA'])
  expect(document.querySelector('.palette-match')).toBeNull()
  await type(input, 'ap')
  expect([...document.querySelectorAll('.palette-match')].map((node) => node.textContent)).toEqual([
    'A',
    'P',
  ])
  expect(document.querySelector('.palette-result')?.getAttribute('aria-label')).toBe(
    'ALPHA, Uncategorized',
  )
  await hoverTooltip(document.querySelector('.palette-result small')!, 'mouse', 700)
  expect(tooltipLabel()).toBe('Uncategorized')
  await type(input, 'alpha')
  await press('Enter', {}, input)
  expect(onSelect).toHaveBeenCalledWith('a', undefined)
  await settle()
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  await press('p')
  expect(palette().value).toBe('')
  await press('ArrowDown', {}, palette())
  await press('Enter', { ctrlKey: true }, palette())
  expect(onSelect).toHaveBeenLastCalledWith('a', true)
})
it('keeps full notebook context accessible without searching or highlighting it', async () => {
  const { host, onSelect } = await mount({}, [
    { id: 'one', name: 'Personal notebook with a long name', color: '', icon: 'notebook' },
    { id: 'extra', name: 'Second notebook', color: '', icon: 'notebook' },
  ])
  await act(async () => trigger(host).click())
  await type(palette(), 'ap')
  const row = document.querySelector<HTMLElement>('.palette-result')!
  const context = 'Personal notebook with a long name, Second notebook'
  expect(row.getAttribute('aria-label')).toBe(`ALPHA, ${context}`)
  await hoverTooltip(row.querySelector('small')!, 'mouse', 700)
  expect(tooltipLabel()).toBe(context)
  expect(row.querySelector('small .palette-match')).toBeNull()
  await act(() => row.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true })))
  expect(onSelect).toHaveBeenCalledWith('a', true)
  await settle()
  await press('p')
  await type(palette(), 'Personal')
  expect(document.querySelector('.palette-result')).toBeNull()
})
it('switches to note bodies with Tab, groups occurrences, and returns the selected match', async () => {
  const { onSelectMatch } = await mount()
  await press('p')
  await type(palette(), 'alpha')
  await press('Tab', { ctrlKey: false }, palette())
  const input = palette()
  expect(input.getAttribute('aria-label')).toBe('Search note bodies')
  expect(input.value).toBe('alpha')
  expect(document.activeElement).toBe(input)
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50))
  })
  expect(document.querySelectorAll('.content-search-group')).toHaveLength(1)
  expect(document.querySelector('.content-search-heading strong')?.textContent).toBe('Beta')
  expect(document.querySelector('mark.target-match')?.textContent).toBe('alpha')
  await press('Enter', {}, input)
  expect(onSelectMatch).toHaveBeenCalledWith(
    expect.objectContaining({ noteId: 'b', query: 'alpha' }),
    false,
  )
  await settle()
  await press('f', { shiftKey: true })
  expect(palette().getAttribute('aria-label')).toBe('Search note bodies')
  expect(palette().value).toBe('')
  await press('Tab', { ctrlKey: false }, palette())
  expect(palette().getAttribute('aria-label')).toBe('Find note titles')
  await press('Escape', {}, palette())
})
it('runs commands after a > prefix and filters them', async () => {
  const run = vi.fn(),
    disabledRun = vi.fn()
  const { host } = await mount({}, [], {
    commands: [
      { id: 'settings', label: 'Open Settings', shortcut: '⌘,', run },
      {
        id: 'theme-aster',
        label: 'Theme: Aster',
        keywords: 'palette',
        checked: true,
        run: vi.fn(),
      },
      { id: 'off', label: 'Open PDF', disabled: true, run: disabledRun },
    ],
  })
  await press('p')
  await type(palette(), '>')
  expect(palette().getAttribute('aria-label')).toBe('Run a command')
  expect(document.querySelectorAll('.palette-result')).toHaveLength(3)
  expect(document.querySelector('[aria-checked="true"]')?.textContent).toContain('Current')
  await type(palette(), '>sett')
  expect(document.querySelectorAll('.palette-result')).toHaveLength(1)
  await type(palette(), '>palette')
  expect(document.querySelector('.palette-result')?.textContent).toContain('Theme: Aster')
  await press('Tab', { ctrlKey: false }, palette())
  expect(palette().getAttribute('aria-label')).toBe('Run a command')
  await type(palette(), '>pdf')
  await press('Enter', {}, palette())
  expect(disabledRun).not.toHaveBeenCalled()
  await type(palette(), '>sett')
  await press('Enter', {}, palette())
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5))
  })
  expect(run).toHaveBeenCalledOnce()
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(trigger(host)).toBeTruthy()
})
it('respects custom bindings and switches scope while open', async () => {
  await mount({ 'quick-open': 'Mod+Alt+p', search: 'Mod+Alt+f' })
  await press('p')
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  await press('p', { altKey: true })
  expect(palette().getAttribute('aria-label')).toBe('Find note titles')
  await press('f', { altKey: true }, palette())
  expect(palette().getAttribute('aria-label')).toBe('Search note bodies')
  await press('p', { altKey: true }, palette())
  expect(palette().getAttribute('aria-label')).toBe('Find note titles')
  await press('Escape', {}, palette())
})
it('orders app-bar navigation before the single palette trigger and retains the sidebar toggle', async () => {
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
    [...host.querySelectorAll('.title-bar-controls button')].map((node) =>
      node.getAttribute('aria-label'),
    ),
  ).toEqual(['Back to previous note', 'Forward to next note', 'Search notes or run a command'])
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
