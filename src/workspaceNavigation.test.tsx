// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import App from './App'
import { hoverTooltip, tooltipLabel, tooltipShortcut } from './components/tooltipTestUtils'
import { library } from './storage/useLibrary'
import { clearSessions, getEditor } from './editor/session'
import type { Note, Notebook } from './model'
import { searchDocument } from './search'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
Element.prototype.scrollIntoView = vi.fn()
Range.prototype.getClientRects = () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () =>
  ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }) as DOMRect
const notes: Note[] = ['Alpha', 'Beta', 'Gamma'].map((title, i) => ({
  id: title.toLowerCase(),
  title,
  notebookIds: [],
  quickAccess: false,
  tags: [],
  pinned: false,
  trashed: false,
  updated: 3 - i,
  text: 'Same Heading same heading',
  content: {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Same Heading' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'same heading' }] },
    ],
  },
}))
let host: HTMLDivElement, root: ReturnType<typeof createRoot>
async function mount(
  testNotes = notes,
  testNotebooks: Notebook[] = [],
  stateOverrides?: Partial<ReturnType<typeof library.getSnapshot>>,
) {
  library.setNotebooks(testNotebooks)
  library.setNotes(testNotes)
  library.setWorkspace({ tabs: [{ id: 'initial', noteId: 'alpha' }], activeTabId: 'initial' })
  if (stateOverrides)
    vi.spyOn(library, 'getSnapshot').mockReturnValue({
      ...library.getSnapshot(),
      ...stateOverrides,
    })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(<App />))
}
afterEach(async () => {
  if (root) await act(async () => root.unmount())
  host?.remove()
  clearSessions()
  vi.restoreAllMocks()
})
const button = (label: string) =>
  document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!
const row = (title: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('.note-row')].find(
    (el) => el.querySelector('.note-row-title')?.textContent === title,
  )!
const title = () => host.querySelector<HTMLInputElement>('.note-title')?.value
const selectedSection = () => host.querySelector('.list-heading-title')?.textContent
const navItem = (label: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('.nav-item')].find(
    (element) => element.querySelector('span')?.textContent === label,
  )!
const headingCount = () => host.querySelector('.list-heading .notebook-count')?.textContent
async function type(label: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
it('keeps note actions in the note header and preserves toggle shortcuts and states', async () => {
  await mount()
  const strip = host.querySelector('[role="tablist"]')!
  expect(strip.parentElement).toBe(host.querySelector('.writing-pane'))
  expect(host.querySelector('.writing-pane')?.firstElementChild).toBe(strip)
  expect(strip.closest('.title-bar')).toBeNull()
  expect(
    [...host.querySelectorAll('.editor-header .header-actions button')].map((element) =>
      element.getAttribute('aria-label'),
    ),
  ).toEqual(['Focus mode', 'Pin note', 'Table of contents', 'Find in note', 'Note actions'])
  for (const label of ['Table of contents', 'Find in note', 'Note actions']) {
    expect(button(label).closest('.editor-header')).not.toBeNull()
    expect(button(label).closest('.title-bar')).toBeNull()
    expect(button(label).disabled).toBe(false)
  }
  await hoverTooltip(button('Table of contents'))
  expect(tooltipLabel()).toBe('Table of contents')
  expect(tooltipShortcut()).toBe('Ctrl+Alt+O')
  await hoverTooltip(button('Find in note'))
  expect(tooltipLabel()).toBe('Find in note')
  expect(tooltipShortcut()).toBe('Ctrl+F')
  await act(async () => button('Table of contents').click())
  expect(button('Table of contents').getAttribute('aria-pressed')).toBe('true')
  expect(host.querySelector('.note-outline')).not.toBeNull()
  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'o',
        ctrlKey: true,
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    ),
  )
  expect(button('Table of contents').getAttribute('aria-pressed')).toBe('false')
  await act(async () => button('Find in note').click())
  expect(button('Find in note').getAttribute('aria-pressed')).toBe('true')
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Find in current note')
  const header = host.querySelector('.editor-header')!
  const findSlot = host.querySelector('#note-find-slot')!
  const workspace = host.querySelector('.editor-workspace')!
  expect(header.nextElementSibling).toBe(findSlot)
  expect(findSlot.nextElementSibling).toBe(workspace)
  expect(findSlot.querySelector('.note-find-bar')).not.toBeNull()
  await act(async () => button('Show replacement').click())
  expect(findSlot.querySelector('.note-replace-row')).not.toBeNull()
  expect(header.nextElementSibling).toBe(findSlot)
  await act(async () => button('Close find').click())
  expect(button('Find in note').getAttribute('aria-pressed')).toBe('false')
  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true }),
    ),
  )
  expect(button('Find in note').getAttribute('aria-pressed')).toBe('true')
})
it('opens note actions from the header by keyboard and returns focus on Escape', async () => {
  await mount()
  const launcher = button('Note actions')
  launcher.focus()
  await act(async () =>
    launcher.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
    ),
  )
  const menu = document.querySelector<HTMLElement>('.note-actions-menu')!
  expect(menu).not.toBeNull()
  expect(launcher.getAttribute('aria-expanded')).toBe('true')
  await act(async () => {
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  expect(launcher.getAttribute('aria-expanded')).toBe('false')
  expect(document.activeElement).toBe(launcher)
})
it.each(['empty', 'loading', 'quitting', 'syncing', 'converting'] as const)(
  'disables the relocated note controls while %s',
  async (state) => {
    await mount(
      state === 'empty' ? [] : notes,
      [],
      state === 'loading'
        ? { loaded: new Set() }
        : state === 'empty'
          ? undefined
          : { [state]: true },
    )
    for (const label of ['Table of contents', 'Find in note', 'Note actions']) {
      expect(button(label).closest('.editor-header')).not.toBeNull()
      expect(button(label).disabled).toBe(true)
    }
    expect(button('New note').disabled).toBe(['quitting', 'syncing', 'converting'].includes(state))
    if (state === 'loading') expect(host.querySelector('.note-opening')).not.toBeNull()
  },
)
it('shows the filtered note count beside the desktop heading and hides zero', async () => {
  await mount()
  expect(selectedSection()).toBe('All notes')
  expect(headingCount()).toBe('3')
  await act(async () => navItem('Pinned notes').click())
  expect(selectedSection()).toBe('Pinned notes')
  expect(headingCount()).toBeUndefined()
  await act(async () =>
    library.setNotes(notes.map((note, index) => ({ ...note, pinned: index === 0 }))),
  )
  expect(headingCount()).toBe('1')
  await type('Search notes', 'no matching note')
  expect(headingCount()).toBeUndefined()
  await type('Search notes', '')
  expect(headingCount()).toBe('1')
})
it('collapses sidebar sections independently and keeps their actions available', async () => {
  await mount(
    [{ ...notes[0], pinned: true, quickAccess: true, tags: ['design'] }],
    [{ id: 'work', name: 'Work', color: '#888888', icon: 'briefcase' }],
  )
  const toggle = (name: string) =>
    [...host.querySelectorAll<HTMLButtonElement>('.section-toggle')].find(
      (element) => element.textContent === name,
    )!
  const content = (name: string) =>
    document.getElementById(toggle(name).getAttribute('aria-controls')!)!

  for (const name of ['Quick access', 'Notebooks', 'Tags']) {
    expect(toggle(name).getAttribute('aria-expanded')).toBe('true')
    expect(content(name).hidden).toBe(false)
  }

  await act(async () => navItem('Pinned notes').click())
  await act(async () => toggle('Quick access').click())
  expect(content('Quick access').hidden).toBe(true)
  expect(toggle('Quick access').getAttribute('aria-expanded')).toBe('false')
  expect(selectedSection()).toBe('Pinned notes')
  expect(content('Notebooks').hidden).toBe(false)
  expect(content('Tags').hidden).toBe(false)

  await act(async () => toggle('Notebooks').click())
  await act(async () => toggle('Tags').click())
  expect(content('Notebooks').hidden).toBe(true)
  expect(content('Tags').hidden).toBe(true)
  await act(async () => button('New notebook').click())
  expect(document.querySelector('[role="dialog"]')).toBeTruthy()

  await act(async () => toggle('Quick access').click())
  expect(content('Quick access').hidden).toBe(false)
  expect(navItem('Pinned notes').getAttribute('aria-current')).toBe('page')
})
it('toggles Notes independently and preserves its mounted search, scroll and preferred width', async () => {
  await mount()
  const preferredWidths = library.getSnapshot().workspace?.paneWidths
  await type('Search notes', 'Alpha')
  const list = host.querySelector<HTMLElement>('.note-list')!
  const rows = host.querySelector<HTMLElement>('.note-rows')!
  rows.scrollTop = 87
  await act(() => button('Hide notes list').click())
  expect(host.querySelector('.note-list')).toBe(list)
  expect(list.hasAttribute('inert')).toBe(true)
  expect(list.getAttribute('aria-hidden')).toBe('true')
  expect(button('Show notes list').getAttribute('aria-expanded')).toBe('false')
  expect(host.querySelector('.pane-resizer--noteList')).toBeNull()
  expect(host.querySelector('.pane-resizer--sidebar')).not.toBeNull()
  await act(() => button('Hide sidebar').click())
  expect(host.querySelector('.app')?.classList.contains('no-note-list')).toBe(true)
  expect(host.querySelector('.app')?.classList.contains('no-sidebar')).toBe(true)
  await act(() => button('Show notes list').click())
  expect(list.hasAttribute('inert')).toBe(false)
  expect(host.querySelector('.app')?.classList.contains('no-sidebar')).toBe(true)
  expect(host.querySelector('.note-rows')).toBe(rows)
  expect(rows.scrollTop).toBe(87)
  expect(host.querySelector<HTMLInputElement>('[aria-label="Search notes"]')?.value).toBe('Alpha')
  expect(library.getSnapshot().workspace?.paneWidths).toEqual(preferredWidths)
  await act(() => button('Show sidebar').click())
  expect(button('Hide notes list').getAttribute('aria-expanded')).toBe('true')
})

it('reopens Notes for every sidebar note view, including repeated and empty notebook selections', async () => {
  await mount(
    [
      {
        ...notes[0],
        notebookIds: ['work'],
        tags: ['design'],
        quickAccess: true,
        text: '#design',
        content: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '#design' }] }],
        },
      },
    ],
    [
      { id: 'work', name: 'Work', color: '', icon: 'notebook' },
      { id: 'empty', name: 'Empty', color: '', icon: 'notebook' },
    ],
  )
  const design = [...host.querySelectorAll<HTMLButtonElement>('.tag-list button')].find(
    (element) => element.textContent === '#design',
  )!
  for (const target of [
    ...[
      'All notes',
      'Today',
      'To-do',
      'Uncategorized',
      'Pinned notes',
      'Quick Access',
      'Work',
      'Work',
      'Empty',
    ].map(navItem),
    design,
  ]) {
    await act(() => button('Hide notes list').click())
    await act(() => target.click())
    expect(button('Hide notes list').getAttribute('aria-expanded')).toBe('true')
    expect(host.querySelector('.note-list')?.hasAttribute('inert')).toBe(false)
  }
  await act(() => button('Hide notes list').click())
  await act(() =>
    button('Account menu').dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 0 }),
    ),
  )
  await act(() =>
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .find((element) => element.textContent?.startsWith('Trash'))!
      .click(),
  )
  expect(button('Hide notes list')).not.toBeNull()
  expect(selectedSection()).toBe('Trash')
})

it('keeps Notes hidden for disclosure controls and notebook row actions', async () => {
  await mount(notes, [
    { id: 'work', name: 'Work', color: '', icon: 'notebook' },
    { id: 'child', parentId: 'work', name: 'Child', color: '', icon: 'notebook' },
  ])
  await act(() => button('Hide notes list').click())
  await act(() => host.querySelector<HTMLButtonElement>('.notebook-disclosure')!.click())
  expect(button('Show notes list')).not.toBeNull()
  await act(() => host.querySelector<HTMLButtonElement>('.notebook-row-action')!.click())
  expect(button('Show notes list')).not.toBeNull()
  for (const section of host.querySelectorAll<HTMLButtonElement>('.section-toggle')) {
    await act(() => section.click())
    expect(button('Show notes list')).not.toBeNull()
  }
})

it('restores chosen pane visibility after focus mode and reveals Notes explicitly from focus mode', async () => {
  await mount()
  await act(() => button('Hide sidebar').click())
  await act(() => button('Hide notes list').click())
  await act(() => button('Focus mode').click())
  await act(() => button('Exit focus mode').click())
  expect(button('Show sidebar')).not.toBeNull()
  expect(button('Show notes list')).not.toBeNull()
  await act(() => button('Focus mode').click())
  await act(() => button('Show notes list').click())
  expect(host.querySelector('.app')?.classList.contains('focus-mode')).toBe(false)
  expect(button('Show sidebar')).not.toBeNull()
  expect(button('Hide notes list')).not.toBeNull()
})

it('does not reopen Notes when switching tabs or navigating history and resets visibility on remount', async () => {
  await mount()
  await act(() =>
    row('Beta').dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true })),
  )
  await act(() => row('Gamma').click())
  await act(() => button('Hide notes list').click())
  await act(() => button('Back to previous note').click())
  expect(button('Show notes list')).not.toBeNull()
  await act(() => button('Forward to next note').click())
  expect(button('Show notes list')).not.toBeNull()
  await act(() => host.querySelector<HTMLButtonElement>('[role="tab"]')!.click())
  expect(button('Show notes list')).not.toBeNull()
  await act(() => root.unmount())
  host.remove()
  await mount()
  expect(button('Hide notes list')).not.toBeNull()
  expect(button('Hide sidebar')).not.toBeNull()
})
it('shows only local update date and 24-hour time in desktop note rows', async () => {
  const today = new Date()
  const updatedToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 21, 18)
  const scopedNotes = [
    { ...notes[0], notebookIds: ['work'], updated: updatedToday.getTime() },
    {
      ...notes[1],
      notebookIds: ['work', 'personal'],
      updated: new Date(2026, 8, 9, 21, 18).getTime(),
    },
    { ...notes[2], notebookIds: [], updated: new Date(2026, 8, 12, 0, 5).getTime() },
  ]
  await mount(scopedNotes, [
    { id: 'work', name: 'Work', color: '#888888', icon: 'briefcase' },
    { id: 'personal', name: 'Personal', color: '#999999', icon: 'notebook' },
  ])

  const todayDate = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(updatedToday)
  expect(row('Alpha').querySelector('.note-row-meta')?.textContent).toBe(`${todayDate}, 21:18`)
  expect(row('Beta').querySelector('.note-row-meta')?.textContent).toBe('Sep 9, 21:18')
  expect(row('Gamma').querySelector('.note-row-meta')?.textContent).toBe('Sep 12, 00:05')
  expect(host.querySelector('.breadcrumb')?.textContent).toContain('Work')
})
it('keeps edited tabs, editor state, and filters while previewing and closing notes', async () => {
  await mount()
  expect(
    document.querySelector('[aria-label="Search notes"]')?.classList.contains('text-field'),
  ).toBe(true)
  expect(document.querySelector('.search-box')?.classList.contains('text-field-shell')).toBe(true)
  expect(host.querySelector('.note-title')?.classList.contains('text-field')).toBe(false)
  const editor = getEditor('alpha', notes[0].content)
  await act(async () => {
    editor.commands.insertContent('Edited ')
    host.querySelector('.note-scroll')!.scrollTop = 123
  })
  const selection = editor.state.selection.toJSON()
  await act(async () => row('Beta').click())
  expect(host.querySelectorAll('[role="tab"]')).toHaveLength(2)
  expect(host.querySelector('.note-tab.preview')?.textContent).toContain('Beta')
  await act(async () => (host.querySelector('[role="tab"]') as HTMLButtonElement).click())
  expect(title()).toBe('Alpha')
  expect(host.querySelector('.note-scroll')?.scrollTop).toBe(123)
  expect(editor.state.selection.toJSON()).toEqual(selection)
  expect(editor.can().undo()).toBe(true)
  await act(async () =>
    row('Gamma').dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true })),
  )
  expect(host.querySelectorAll('[role="tab"]')).toHaveLength(3)
  await type('Search notes', 'not found')
  expect(title()).toBe('Gamma')
  await act(async () => button('Close Gamma').click())
  expect(title()).toBe('Beta')
  await act(async () => button('Close Beta').click())
  expect(title()).toBe('Alpha')
  await act(async () => button('Close Alpha').click())
  expect(host.querySelectorAll('[role="tab"]')).toHaveLength(0)
  expect(title()).toBeUndefined()
  expect(library.getSnapshot().workspace).toEqual({
    tabs: [],
    activeTabId: null,
    recentNoteIds: ['alpha', 'beta', 'gamma'],
  })
})
it('replaces one preview, keeps metadata changes replaceable, and promotes double-clicked rows', async () => {
  await mount()
  await act(async () => row('Beta').click())
  expect(host.querySelectorAll('.note-tab')).toHaveLength(2)
  expect(host.querySelector('.note-tab.preview')?.textContent).toContain('Beta')
  expect(library.getSnapshot().workspace?.tabs[1].preview).toBe(true)
  await act(async () => button('Pin note').click())
  expect(host.querySelector('.note-tab.preview')?.textContent).toContain('Beta')
  await act(async () => row('Gamma').click())
  expect(host.querySelectorAll('.note-tab')).toHaveLength(2)
  expect(host.querySelector('.note-tab.preview')?.textContent).toContain('Gamma')
  await act(async () => row('Gamma').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
  expect(host.querySelector('.note-tab.preview')).toBeNull()
  await act(async () => row('Beta').click())
  expect(host.querySelectorAll('.note-tab')).toHaveLength(3)
  expect(host.querySelector('.note-tab.preview')?.textContent).toContain('Beta')
})
it('promotes previews from the tab, keyboard, title, and body edits', async () => {
  await mount()
  await act(async () => row('Beta').click())
  const betaTab = host.querySelector('.note-tab.preview [role="tab"]') as HTMLButtonElement
  await act(async () => betaTab.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
  expect(host.querySelector('.note-tab.preview')).toBeNull()
  await act(async () => row('Gamma').click())
  const gammaTab = host.querySelector('.note-tab.preview [role="tab"]') as HTMLButtonElement
  await act(async () =>
    gammaTab.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    ),
  )
  expect(host.querySelector('.note-tab.preview')).toBeNull()
  await act(async () => row('Alpha').click())
  expect(host.querySelectorAll('.note-tab')).toHaveLength(3)
  await act(async () => button('Close Beta').click())
  await act(async () => row('Beta').click())
  expect(host.querySelector('.note-tab.preview')).toBeTruthy()
  await type('Note title', 'Beta edited')
  expect(host.querySelector('.note-tab.preview')).toBeNull()
  await act(async () => button('Close Gamma').click())
  await act(async () => row('Gamma').click())
  expect(host.querySelector('.note-tab.preview')).toBeTruthy()
  await act(async () => getEditor('gamma', notes[2].content).commands.insertContent('Edited '))
  expect(host.querySelector('.note-tab.preview')).toBeNull()
})
it('keeps the current section when activating a note tab opened from another section', async () => {
  const scopedNotes = [
    { ...notes[0], notebookIds: [], updated: 4 },
    { ...notes[1], notebookIds: ['work'], updated: 2 },
    { ...notes[2], notebookIds: ['work'], updated: 3 },
    { ...notes[2], id: 'delta', title: 'Delta', notebookIds: ['work'], updated: 1 },
  ]
  await mount(scopedNotes, [{ id: 'work', name: 'Work', color: '#888888', icon: 'briefcase' }])

  await act(async () =>
    row('Beta').dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true })),
  )
  await act(async () =>
    row('Gamma').dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true })),
  )
  await act(async () => navItem('Work').click())
  expect(selectedSection()).toBe('Work')

  await act(async () => row('Beta').click())
  expect(selectedSection()).toBe('Work')

  await act(async () =>
    row('Delta').dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true })),
  )
  await act(async () => navItem('All notes').click())
  expect(selectedSection()).toBe('All notes')

  await act(async () => row('Delta').click())
  expect(selectedSection()).toBe('All notes')
})
it('finds title and body, wraps matches, updates outlines, and keeps find open across tabs', async () => {
  await mount()
  await act(async () => button('Table of contents').click())
  expect(host.querySelector('.note-outline')?.textContent).toContain('Same Heading')
  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true }),
    ),
  )
  await type('Find in current note', 'heading')
  expect(
    host
      .querySelector('input[aria-label="Find in current note"]')
      ?.classList.contains('text-field'),
  ).toBe(true)
  expect(host.querySelector('.note-find-bar [role="status"]')?.textContent).toBe('1 of 2')
  expect(host.querySelectorAll('.note-find-match')).toHaveLength(2)
  await act(async () => button('Previous match').click())
  expect(host.querySelector('.note-find-bar [role="status"]')?.textContent).toBe('2 of 2')
  await type('Find in current note', 'alpha')
  expect(host.querySelector('.note-title-highlights mark')?.textContent).toBe('Alpha')
  await act(async () => row('Beta').click())
  expect(
    document.querySelector<HTMLInputElement>('input[aria-label="Find in current note"]')?.value,
  ).toBe('alpha')
  expect(host.querySelector('.note-find-bar [role="status"]')?.textContent).toBe('No matches')
  await act(async () => button('Close find').click())
  expect(host.querySelectorAll('.note-find-match')).toHaveLength(0)
  const editor = getEditor('beta', notes[1].content)
  await act(async () => editor.commands.insertContent('<h3>New child</h3>'))
  expect(host.querySelector('.note-outline')?.textContent).toContain('New child')
})
it('creates new tabs from the labeled notes-panel button and handles keyboard switching/closing', async () => {
  await mount()
  const launcher = button('New note')
  expect(launcher.closest('.list-heading')).not.toBeNull()
  expect(launcher.textContent).toBe('New note')
  await hoverTooltip(launcher, 'mouse', 700)
  expect(tooltipLabel()).toBe('New note')
  expect(tooltipShortcut()).toBe('Ctrl+N')
  expect(host.querySelector('.title-bar [aria-label="New note"]')).toBeNull()
  const count = library.getSnapshot().notes.length
  await act(async () => launcher.click())
  expect(library.getSnapshot().notes).toHaveLength(count + 1)
  expect(title()).toBe('')
  expect(host.querySelectorAll('[role="tab"]')).toHaveLength(2)
  const newTitle = host.querySelector<HTMLInputElement>('.note-title')!
  expect(document.activeElement).toBe(newTitle)
  for (const key of ['Enter', 'ArrowDown']) {
    newTitle.focus()
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
    await act(async () => {
      newTitle.dispatchEvent(event)
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
    expect(event.defaultPrevented).toBe(true)
    expect(document.activeElement?.classList.contains('tiptap')).toBe(true)
  }
  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', ctrlKey: true, bubbles: true, cancelable: true }),
    ),
  )
  expect(title()).toBe('Alpha')
  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'w', ctrlKey: true, bubbles: true, cancelable: true }),
    ),
  )
  expect(title()).toBe('')
})

it('creates in the selected notebook while preserving the list search', async () => {
  await mount(
    notes.map((note) => ({ ...note, notebookIds: ['work'] })),
    [{ id: 'work', name: 'Work', color: '#888888', icon: 'briefcase' }],
  )
  await act(async () => navItem('Work').click())
  await type('Search notes', 'Alpha')
  const count = library.getSnapshot().notes.length
  await act(async () => button('New note').click())
  const created = library.getSnapshot().notes[0]
  expect(library.getSnapshot().notes).toHaveLength(count + 1)
  expect(created.notebookIds).toEqual(['work'])
  expect(created.title).toBe('')
  expect(selectedSection()).toBe('Work')
  expect(button('New note').closest('.list-heading')).not.toBeNull()
  expect(document.querySelector<HTMLInputElement>('[aria-label="Search notes"]')?.value).toBe(
    'Alpha',
  )
  expect(host.querySelectorAll('.note-row')).toHaveLength(1)
  expect(host.querySelectorAll('[role="tab"]')).toHaveLength(2)
  expect(document.activeElement).toBe(host.querySelector('.note-title'))
})

it('keeps the configured creation shortcut available when Focus mode hides the notes panel', async () => {
  const saved = library.getSnapshot().appearance
  library.setAppearance({ ...saved, shortcuts: { ...saved.shortcuts, 'new-note': 'Mod+Shift+n' } })
  try {
    await mount()
    await hoverTooltip(button('New note'), 'mouse', 700)
    expect(tooltipLabel()).toBe('New note')
    expect(tooltipShortcut()).toBe('Ctrl+Shift+N')
    await act(async () => button('Focus mode').click())
    expect(host.querySelector('.note-list')?.getAttribute('aria-hidden')).toBe('true')
    expect(button('New note').closest('[inert]')).not.toBeNull()
    const count = library.getSnapshot().notes.length
    await act(async () =>
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'n',
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    )
    expect(library.getSnapshot().notes).toHaveLength(count + 1)
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(2)
    expect(title()).toBe('')
    expect(document.activeElement).toBe(host.querySelector('.note-title'))
    expect(host.querySelector('.note-list')?.getAttribute('aria-hidden')).toBe('true')
  } finally {
    await act(async () => library.setAppearance(saved))
  }
})

it('handles rapid navigation before React mounts an intermediate document', async () => {
  await mount()
  host.querySelector('.note-scroll')!.scrollTop = 123
  await act(async () => {
    row('Beta').click()
    row('Gamma').click()
  })
  expect(title()).toBe('Gamma')
  await act(async () => button('Back to previous note').click())
  expect(title()).toBe('Beta')
  expect(host.querySelector('.note-scroll')?.scrollTop).toBe(0)
  await act(async () => button('Forward to next note').click())
  expect(title()).toBe('Gamma')
  await act(async () => (host.querySelector('[role="tab"]') as HTMLButtonElement).click())
  expect(title()).toBe('Alpha')
  expect(host.querySelector('.note-scroll')?.scrollTop).toBe(123)
})

it('highlights consecutive visible sections without inheriting highlights for offscreen parents', async () => {
  await mount()
  const editor = getEditor('alpha', notes[0].content)
  await act(async () =>
    editor.commands.setContent(
      '<h1>Parent</h1><h2>First</h2><p>Body</p><h2>Second</h2><p>Body</p><h1>Next</h1>',
    ),
  )
  const scroll = host.querySelector('.note-scroll')!
  let offset = 0
  const rect = (top: number, bottom: number) =>
    ({ top, bottom, left: 0, right: 300, width: 300, height: bottom - top }) as DOMRect
  vi.spyOn(scroll, 'getBoundingClientRect').mockImplementation(() => rect(0, 200))
  vi.spyOn(editor.view.dom, 'getBoundingClientRect').mockImplementation(() =>
    rect(-offset, 600 - offset),
  )
  const elements = [...editor.view.dom.querySelectorAll('h1, h2')]
  elements.forEach((element, index) => {
    vi.spyOn(element, 'getClientRects').mockImplementation(
      () => [rect(index * 100 - offset, index * 100 + 20 - offset)] as unknown as DOMRectList,
    )
    vi.spyOn(element, 'getBoundingClientRect').mockImplementation(() =>
      rect(index * 100 - offset, index * 100 + 20 - offset),
    )
  })
  await act(async () => button('Table of contents').click())
  const visible = () =>
    [...host.querySelectorAll('.outline-row[data-visible] .outline-heading')].map(
      (element) => element.textContent,
    )
  expect(visible()).toEqual(['Parent', 'First'])
  offset = 150
  await act(async () => scroll.dispatchEvent(new Event('scroll')))
  expect(visible()).toEqual(['First', 'Second', 'Next'])
  offset = 300
  await act(async () => scroll.dispatchEvent(new Event('scroll')))
  expect(visible()).toEqual(['Next'])
})
it('keeps the editor, selection, undo history and scroll through animated layout changes', async () => {
  await mount()
  const editor = getEditor('alpha', notes[0].content)
  await act(() => editor.commands.insertContent('Keep '))
  const content = editor.getJSON()
  const selection = editor.state.selection.toJSON()
  const scroll = host.querySelector('.note-scroll')!
  scroll.scrollTop = 123
  for (const label of [
    'Hide sidebar',
    'Show sidebar',
    'Hide notes list',
    'Show notes list',
    'Focus mode',
    'Exit focus mode',
    'Table of contents',
    'Table of contents',
  ]) {
    await act(() => button(label).click())
    expect(getEditor('alpha', notes[0].content)).toBe(editor)
    expect(editor.getJSON()).toEqual(content)
    expect(editor.state.selection.toJSON()).toEqual(selection)
    expect(host.querySelector('.note-scroll')).toBe(scroll)
    expect(scroll.scrollTop).toBe(123)
  }
  await act(() => editor.commands.undo())
  expect(editor.getText()).not.toContain('Keep ')
})
it('suppresses cursor motion without changing saved preferences and restores it when re-enabled', async () => {
  const cursor = await import('./editor/cursor')
  const updateCursor = vi.spyOn(cursor, 'setCursorSettings')
  const saved = {
    ...library.getSnapshot().appearance,
    animationsEnabled: true,
    cursorBlinking: 'expand' as const,
    cursorSmoothCaretAnimation: 'on' as const,
  }
  library.setAppearance(saved)
  await mount()
  expect(updateCursor.mock.calls.at(-1)?.[1]).toMatchObject({
    cursorBlinking: 'expand',
    cursorSmoothCaretAnimation: 'on',
  })
  await act(() => library.setAppearance({ ...saved, animationsEnabled: false }))
  expect(updateCursor.mock.calls.at(-1)?.[1]).toMatchObject({
    cursorBlinking: 'solid',
    cursorSmoothCaretAnimation: 'off',
  })
  expect(library.getSnapshot().appearance).toMatchObject({
    cursorBlinking: 'expand',
    cursorSmoothCaretAnimation: 'on',
  })
  await act(() => library.setAppearance(saved))
  expect(updateCursor.mock.calls.at(-1)?.[1]).toMatchObject({
    cursorBlinking: 'expand',
    cursorSmoothCaretAnimation: 'on',
  })
  updateCursor.mockRestore()
})

it('opens the exact repeated body occurrence, offsets title matches, and reveals collapsed content without edits', async () => {
  const target: Note = {
    ...notes[1],
    title: 'fix title',
    text: 'fix one fix two fix three',
    content: {
      type: 'doc',
      content: [
        {
          type: 'collapsible',
          attrs: { collapsed: true },
          content: [
            {
              type: 'collapsibleHeader',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Section' }] }],
            },
            {
              type: 'collapsibleBody',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'fix one fix two fix three' }],
                },
              ],
            },
          ],
        },
      ],
    },
  }
  await mount([notes[0], target])
  await act(async () => button('Search note content').click())
  await type('Search note content', 'fix')
  expect(document.querySelectorAll('.content-search-group')).toHaveLength(1)
  expect(document.querySelectorAll('.content-search-match')).toHaveLength(3)
  await act(async () => document.querySelectorAll<HTMLElement>('.content-search-match')[1].click())
  expect(title()).toBe('fix title')
  expect(
    host.querySelector<HTMLInputElement>('input[aria-label="Find in current note"]')?.value,
  ).toBe('fix')
  expect(host.querySelector('.note-find-bar [role="status"]')?.textContent).toBe('3 of 4')
  expect(host.querySelectorAll('.note-find-match')).toHaveLength(3)
  const editor = getEditor(target.id, target.content)
  const { findKey } = await import('./editor/noteTools')
  expect(findKey.getState(editor.state)?.active).toBe(1)
  expect(host.querySelector('.navigation-revealed')).toBeTruthy()
  expect(editor.getJSON()).toEqual(searchDocument(target).toJSON())
  expect(editor.can().undo()).toBe(false)
  expect(library.getSnapshot().notes.find((note) => note.id === target.id)?.updated).toBe(
    target.updated,
  )
  expect(library.getSnapshot().workspace?.recentNoteIds?.slice(0, 2)).toEqual(['beta', 'alpha'])
  await act(async () => button('Back to previous note').click())
  expect(library.getSnapshot().workspace?.recentNoteIds?.[0]).toBe('alpha')
})
