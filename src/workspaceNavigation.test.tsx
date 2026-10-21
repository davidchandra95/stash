// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import App from './App'
import { hoverTooltip, tooltipLabel, tooltipShortcut } from './components/tooltipTestUtils'
import { library } from './storage/useLibrary'
import { clearSessions, getEditor } from './editor/session'
import type { Note, Notebook } from './model'
import type { WorkspacePreferences } from './workspace'
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
  savedWorkspace?: WorkspacePreferences,
) {
  library.setNotebooks(testNotebooks)
  library.setNotes(testNotes)
  library.setWorkspace(
    savedWorkspace ?? {
      tabs: [{ id: 'initial', noteId: 'alpha' }],
      activeTabId: 'initial',
      sidebarView: 'all',
    },
  )
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
const menuItem = (label: string) =>
  [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (element) => element.querySelector('.menu-text')?.textContent === label,
  )!
async function openMenu(label: string) {
  await act(async () =>
    button(label).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })),
  )
}
async function hideNotesList() {
  await openMenu('Sort and view options')
  await act(async () => menuItem('Hide notes list').click())
}
const noteList = () => host.querySelector<HTMLElement>('#note-list')!
const notesListHidden = () => noteList().hasAttribute('inert')
const appWindow = () => host.querySelector('.window')!
async function openPalette(bodies = false) {
  const search = [...host.querySelectorAll<HTMLButtonElement>('.sidebar button')].find(
    (element) => element.querySelector('.side-label')?.textContent === 'Search',
  )!
  await act(async () => search.click())
  if (bodies)
    await act(async () => {
      document
        .querySelector('.palette input')!
        .dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
        )
    })
}
const row = (title: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('.note-row')].find(
    (el) => el.querySelector('.note-row-title')?.textContent === title,
  )!
const title = () => host.querySelector<HTMLInputElement>('input[aria-label="Note title"]')?.value
const selectedSection = () => host.querySelector('.list-title .truncate')?.textContent
const navItem = (label: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('.sidebar button')].find(
    (element) => element.querySelector(':scope > .side-label')?.textContent === label,
  )!
const headingCount = () => host.querySelector('.list-title .count')?.textContent
async function type(label: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function waitForBodySearch() {
  const results = () => document.querySelector('.content-search-results')
  const deadline = performance.now() + 2000
  while (results()?.getAttribute('aria-busy') !== 'false' && performance.now() < deadline)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
    })
  expect(results()?.getAttribute('aria-busy')).toBe('false')
}
async function openSearchResult(method: string, noteTitle: string, ctrlKey = false) {
  if (method === 'body click') {
    await openPalette(true)
    await type('Search note bodies', 'heading')
    await waitForBodySearch()
    const result = [...document.querySelectorAll<HTMLElement>('.content-search-match')].find(
      (element) =>
        element.closest('.content-search-group')?.querySelector('strong')?.textContent ===
        noteTitle,
    )
    expect(result).toBeTruthy()
    await act(async () =>
      result!.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey })),
    )
  } else {
    await openPalette()
    await type('Find note titles', noteTitle)
    if (method === 'title click')
      await act(async () =>
        document
          .querySelector<HTMLElement>('[aria-label="Matching note titles"] [role="option"]')!
          .dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey })),
      )
    else
      await act(async () =>
        document.querySelector<HTMLInputElement>('[aria-label="Find note titles"]')!.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Enter',
            bubbles: true,
            cancelable: true,
            ctrlKey,
          }),
        ),
      )
  }
}
it.each(['title click', 'title Enter', 'body click'])(
  'keeps a restored permanent tab when opening a search result with %s',
  async (method) => {
    await mount()
    host.querySelector('.note-scroll')!.scrollTop = 123
    await openSearchResult(method, 'Beta')
    expect(title()).toBe('Beta')
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(2)
    expect(library.getSnapshot().workspace?.tabs[0]).toEqual({ id: 'initial', noteId: 'alpha' })
    const previewId = library.getSnapshot().workspace?.activeTabId
    await openSearchResult(method, 'Alpha')
    expect(title()).toBe('Alpha')
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(2)
    expect(host.querySelector('.note-scroll')?.scrollTop).toBe(123)
    await openSearchResult(method, 'Gamma')
    expect(title()).toBe('Gamma')
    expect(library.getSnapshot().workspace?.activeTabId).toBe(previewId)
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(2)
    await openSearchResult(method, 'Gamma', true)
    expect(host.querySelector('.tab.is-preview')).toBeNull()
    await openSearchResult(method, 'Beta')
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(3)
    expect(library.getSnapshot().workspace?.tabs.map((tab) => tab.noteId)).toEqual([
      'alpha',
      'gamma',
      'beta',
    ])
    await openSearchResult(method, 'Beta', true)
    expect(host.querySelector('.tab.is-preview')).toBeNull()
    await openSearchResult(method, 'Gamma', true)
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(3)
  },
)
it('widens an empty view filter to all notes without losing the query or opening a note', async () => {
  const books: Notebook[] = [
    { id: 'work', name: 'Work', color: '', icon: 'briefcase' },
    { id: 'learning', name: 'Learning', color: '', icon: 'notebook' },
  ]
  const testNotes = notes.map((note, i) => ({
    ...note,
    title: i === 1 ? 'A garden journal' : note.title,
    notebookIds: [i === 1 ? 'learning' : 'work'],
  }))
  await mount(testNotes, books)
  await act(async () => navItem('Work').click())
  await type('Filter this view', 'garden')
  expect(host.querySelectorAll('.note-row')).toHaveLength(0)
  expect(host.querySelector('.list-empty')?.textContent).toContain('No matches in this view')
  const openTitle = title()
  const searchAll = host.querySelector<HTMLButtonElement>('.list-empty button')!
  expect(searchAll.textContent).toContain('Search all notes')
  await act(async () => searchAll.click())
  expect(selectedSection()).toBe('All notes')
  expect(row('A garden journal')).toBeTruthy()
  expect(host.querySelectorAll('.note-row')).toHaveLength(1)
  const filter = host.querySelector<HTMLInputElement>('[aria-label="Filter this view"]')!
  expect(filter.value).toBe('garden')
  expect(document.activeElement).toBe(filter)
  expect(title()).toBe(openTitle)
  expect(library.getSnapshot().workspace?.sidebarView).toBe('all')
  await type('Filter this view', 'no matching title')
  expect(host.querySelector('.list-empty button')).toBeNull()
  await type('Filter this view', '')
  expect(host.querySelectorAll('.note-row')).toHaveLength(3)
})
it.each(['book:work', 'book:empty', 'tag:project', 'pinned', 'trash'] as const)(
  'restores the selected sidebar view %s independently of open tabs',
  async (view) => {
    const testNotes = notes.map((note) => ({
      ...note,
      text: `${note.text} #project`,
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: `${note.text} ` },
              {
                type: 'text',
                text: '#project',
                marks: [{ type: 'bodyTag', attrs: { tag: 'project' } }],
              },
            ],
          },
        ],
      },
    }))
    const books: Notebook[] = [
      { id: 'work', name: 'Work', color: '#888888', icon: 'briefcase' },
      { id: 'empty', name: 'Empty', color: '#888888', icon: 'briefcase' },
    ]
    const labels = {
      'book:work': 'Work',
      'book:empty': 'Empty',
      'tag:project': '#project',
      pinned: 'Pinned notes',
      trash: 'Trash',
    }
    await mount(testNotes, books, undefined, {
      tabs: [{ id: 'initial', noteId: 'alpha' }],
      activeTabId: 'initial',
      sidebarView: view,
    })
    expect(selectedSection()).toBe(labels[view])
    expect(title()).toBe('Alpha')
    expect(library.getSnapshot().workspace?.sidebarView).toBe(view)
  },
)
it('saves an empty notebook selection and restores it with no open tabs', async () => {
  const books: Notebook[] = [{ id: 'empty', name: 'Empty', color: '#888888', icon: 'briefcase' }]
  await mount(notes, books)
  await act(async () => navItem('Empty').click())
  expect(library.getSnapshot().workspace?.sidebarView).toBe('book:empty')
  await act(async () => button('Close Alpha').click())
  const saved = library.getSnapshot().workspace!
  expect(saved.tabs).toEqual([])
  expect(saved.sidebarView).toBe('book:empty')
  await act(async () => root.unmount())
  host.remove()
  await mount(notes, books, undefined, saved)
  expect(selectedSection()).toBe('Empty')
  expect(host.querySelectorAll('[role="tab"]')).toHaveLength(0)
})
it('waits for library loading before restoring or saving the sidebar view', async () => {
  await mount(notes, [], { ready: false })
  const snapshot = library.getSnapshot()
  const save = vi.spyOn(library, 'setSidebarView')
  expect(save).not.toHaveBeenCalled()
  vi.mocked(library.getSnapshot).mockReturnValue({
    ...snapshot,
    ready: true,
    workspace: { tabs: [], activeTabId: null, sidebarView: 'pinned' },
  })
  await act(async () => root.render(<App />))
  expect(selectedSection()).toBe('Pinned notes')
  expect(save).toHaveBeenCalledWith('pinned')
})
it('keeps note actions at the end of the tab strip and preserves toggle shortcuts and states', async () => {
  await mount()
  const strip = host.querySelector('[role="tablist"]')!
  const editorPane = host.querySelector('main')!
  const bar = editorPane.firstElementChild!
  expect(bar.contains(strip)).toBe(true)
  expect(host.querySelector('.companion-bar')).toBeNull()
  const controls = bar.lastElementChild!
  expect(controls.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
  expect(
    [...controls.querySelectorAll('button')].map((element) => element.getAttribute('aria-label')),
  ).toEqual(['Focus mode', 'Table of contents', 'Find in note', 'Note actions'])
  for (const label of ['Table of contents', 'Find in note', 'Note actions']) {
    expect(controls.contains(button(label))).toBe(true)
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
  const findSlot = host.querySelector('#note-find-slot')!
  const workspace = host.querySelector('.editor-workspace')!
  expect(findSlot.nextElementSibling).toBe(workspace)
  expect(findSlot.querySelector('[role="search"]')).not.toBeNull()
  await act(async () => button('Show replacement').click())
  expect(findSlot.querySelector('input[aria-label="Replace with"]')).not.toBeNull()
  expect(findSlot.nextElementSibling).toBe(workspace)
  await act(async () => button('Close find').click())
  expect(button('Find in note').getAttribute('aria-pressed')).toBe('false')
  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true }),
    ),
  )
  expect(button('Find in note').getAttribute('aria-pressed')).toBe('true')
})
it('opens note actions from the tab strip by keyboard and returns focus on Escape', async () => {
  await mount()
  const launcher = button('Note actions')
  launcher.focus()
  await act(async () =>
    launcher.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
    ),
  )
  const menu = document.querySelector<HTMLElement>('[role="menu"]')!
  expect(menu).not.toBeNull()
  expect(launcher.getAttribute('aria-expanded')).toBe('true')
  await act(async () => {
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    // Radix restores focus on a timer after the menu unmounts.
    for (let tick = 0; tick < 5 && document.activeElement !== launcher; tick++)
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
      expect(button(label).closest('main')).not.toBeNull()
      expect(button(label).disabled).toBe(true)
    }
    expect(button('New note').disabled).toBe(['quitting', 'syncing', 'converting'].includes(state))
    if (state === 'loading')
      expect(
        [...host.querySelectorAll('main [role="status"]')].some(
          (element) => element.textContent === 'Opening note…',
        ),
      ).toBe(true)
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
  await type('Filter this view', 'no matching note')
  expect(headingCount()).toBeUndefined()
  await type('Filter this view', '')
  expect(headingCount()).toBe('1')
})
it('collapses sidebar sections independently and keeps their actions available', async () => {
  await mount(
    [
      {
        ...notes[0],
        pinned: true,
        quickAccess: true,
        tags: ['design'],
        text: '#design',
        content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: '#design',
                  marks: [{ type: 'bodyTag', attrs: { tag: 'design' } }],
                },
              ],
            },
          ],
        },
      },
    ],
    [{ id: 'work', name: 'Work', color: '#888888', icon: 'briefcase' }],
  )
  // The Tags section only renders while some note has a tag.
  const toggle = (name: string) =>
    [...host.querySelectorAll<HTMLButtonElement>('.sidebar button[aria-controls]')].find(
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
  await type('Filter this view', 'Alpha')
  const list = noteList()
  const rows = host.querySelector<HTMLElement>('.note-rows')!
  rows.scrollTop = 87
  await hideNotesList()
  expect(noteList()).toBe(list)
  expect(list.hasAttribute('inert')).toBe(true)
  expect(host.querySelector('[role="separator"][aria-controls="note-list"]')).toBeNull()
  expect(host.querySelector('[role="separator"][aria-controls="notebook-sidebar"]')).not.toBeNull()
  await act(() => button('Hide sidebar').click())
  expect(appWindow().classList.contains('no-note-list')).toBe(true)
  expect(appWindow().classList.contains('no-sidebar')).toBe(true)
  expect(button('Show notes list').getAttribute('aria-expanded')).toBe('false')
  expect(button('Show notes list').getAttribute('aria-controls')).toBe('note-list')
  await act(() => button('Show notes list').click())
  expect(list.hasAttribute('inert')).toBe(false)
  expect(appWindow().classList.contains('no-sidebar')).toBe(true)
  expect(host.querySelector('.note-rows')).toBe(rows)
  expect(rows.scrollTop).toBe(87)
  expect(host.querySelector<HTMLInputElement>('[aria-label="Filter this view"]')?.value).toBe(
    'Alpha',
  )
  expect(library.getSnapshot().workspace?.paneWidths).toEqual(preferredWidths)
  await act(() => button('Show sidebar').click())
  expect(appWindow().classList.contains('no-note-list')).toBe(false)
  expect(button('Show notes list')).toBeNull()
})
// The Sort menu's modal aria-hiding cleanup (Radix hideOthers) runs inside the list it hides.
it('marks Notes aria-hidden after hiding it from the Sort and view options menu', async () => {
  await mount()
  await hideNotesList()
  expect(noteList().hasAttribute('inert')).toBe(true)
  expect(noteList().getAttribute('aria-hidden')).toBe('true')
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
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: '#design',
                  marks: [{ type: 'bodyTag', attrs: { tag: 'design' } }],
                },
              ],
            },
          ],
        },
      },
    ],
    [
      { id: 'work', name: 'Work', color: '', icon: 'notebook' },
      { id: 'empty', name: 'Empty', color: '', icon: 'notebook' },
    ],
  )
  const design = [...host.querySelectorAll<HTMLButtonElement>('.sidebar button')].find(
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
    await hideNotesList()
    expect(notesListHidden()).toBe(true)
    await act(() => target.click())
    expect(notesListHidden()).toBe(false)
    expect(appWindow().classList.contains('no-note-list')).toBe(false)
  }
  await hideNotesList()
  await act(() => button('Trash').click())
  expect(notesListHidden()).toBe(false)
  expect(button('Trash').getAttribute('aria-pressed')).toBe('true')
  expect(selectedSection()).toBe('Trash')
})

it('keeps Notes hidden for disclosure controls and notebook row actions', async () => {
  await mount(notes, [
    { id: 'work', name: 'Work', color: '', icon: 'notebook' },
    { id: 'child', parentId: 'work', name: 'Child', color: '', icon: 'notebook' },
  ])
  await hideNotesList()
  await act(() => button('Collapse Work').click())
  expect(notesListHidden()).toBe(true)
  await act(() => button('New note in Work').click())
  expect(notesListHidden()).toBe(true)
  for (const section of host.querySelectorAll<HTMLButtonElement>(
    '.sidebar section button[aria-controls]',
  )) {
    await act(() => section.click())
    expect(notesListHidden()).toBe(true)
  }
})

it('restores chosen pane visibility after focus mode and reveals Notes explicitly from focus mode', async () => {
  await mount()
  await act(() => button('Hide sidebar').click())
  await hideNotesList()
  await act(() => button('Focus mode').click())
  await act(() => button('Exit focus mode').click())
  expect(button('Show sidebar')).not.toBeNull()
  expect(button('Show notes list')).not.toBeNull()
  await act(() => button('Focus mode').click())
  await act(() => button('Show notes list').click())
  expect(appWindow().classList.contains('focus-mode')).toBe(false)
  expect(button('Show sidebar')).not.toBeNull()
  expect(button('Show notes list')).toBeNull()
  expect(notesListHidden()).toBe(false)
})

it('does not reopen Notes when switching tabs or navigating history and resets visibility on remount', async () => {
  await mount()
  await act(() =>
    row('Beta').dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true })),
  )
  await act(() => row('Gamma').click())
  await hideNotesList()
  expect(notesListHidden()).toBe(true)
  await act(() => button('Back to previous note').click())
  expect(notesListHidden()).toBe(true)
  await act(() => button('Forward to next note').click())
  expect(notesListHidden()).toBe(true)
  await act(() => host.querySelector<HTMLButtonElement>('[role="tab"]')!.click())
  expect(notesListHidden()).toBe(true)
  await act(() => root.unmount())
  host.remove()
  await mount()
  expect(notesListHidden()).toBe(false)
  expect(button('Show notes list')).toBeNull()
  expect(button('Hide sidebar')).not.toBeNull()
})
it('formats relative update dates in desktop note rows', async () => {
  const now = new Date()
  const at = (daysAgo: number) =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, 21, 18)
  const scopedNotes = [
    { ...notes[0], notebookIds: ['work'], updated: at(0).getTime() },
    { ...notes[1], notebookIds: ['work', 'personal'], updated: at(1).getTime() },
    { ...notes[2], notebookIds: [], updated: at(3).getTime() },
    {
      ...notes[2],
      id: 'delta',
      title: 'Delta',
      notebookIds: [],
      updated: new Date(2024, 8, 9, 0, 5).getTime(),
    },
  ]
  await mount(scopedNotes, [
    { id: 'work', name: 'Work', color: '#888888', icon: 'briefcase' },
    { id: 'personal', name: 'Personal', color: '#999999', icon: 'notebook' },
  ])
  const date = (title: string) => row(title).querySelector('.note-row-date')?.textContent

  expect(date('Alpha')).toBe(
    new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(at(0)),
  )
  expect(date('Beta')).toBe('Yesterday')
  expect(date('Gamma')).toBe(new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(at(3)))
  expect(date('Delta')).toBe(
    new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(
      new Date(2024, 8, 9),
    ),
  )
})
it('keeps edited tabs, editor state, and filters while previewing and closing notes', async () => {
  await mount()
  expect(
    document.querySelector('[aria-label="Filter this view"]')?.closest('.field-shell'),
  ).not.toBeNull()
  expect(host.querySelector('[aria-label="Note title"]')?.closest('.field-shell')).toBeNull()
  const editor = getEditor('alpha', notes[0].content)
  await act(async () => {
    editor.commands.insertContent('Edited ')
    host.querySelector('.note-scroll')!.scrollTop = 123
  })
  const selection = editor.state.selection.toJSON()
  await act(async () => row('Beta').click())
  expect(host.querySelectorAll('[role="tab"]')).toHaveLength(2)
  expect(host.querySelector('.tab.is-preview')?.textContent).toContain('Beta')
  await act(async () => (host.querySelector('[role="tab"]') as HTMLButtonElement).click())
  expect(title()).toBe('Alpha')
  expect(host.querySelector('.note-scroll')?.scrollTop).toBe(123)
  expect(editor.state.selection.toJSON()).toEqual(selection)
  expect(editor.can().undo()).toBe(true)
  await act(async () =>
    row('Gamma').dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true })),
  )
  expect(host.querySelectorAll('[role="tab"]')).toHaveLength(3)
  await type('Filter this view', 'not found')
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
    sidebarView: 'all',
  })
})
it('replaces one preview, keeps metadata changes replaceable, and promotes double-clicked rows', async () => {
  await mount()
  await act(async () => row('Beta').click())
  expect(host.querySelectorAll('.tab')).toHaveLength(2)
  expect(host.querySelector('.tab.is-preview')?.textContent).toContain('Beta')
  expect(library.getSnapshot().workspace?.tabs[1].preview).toBe(true)
  await openMenu('Note actions')
  await act(async () => menuItem('Pin to top').click())
  expect(library.getSnapshot().notes.find((note) => note.id === 'beta')?.pinned).toBe(true)
  expect(host.querySelector('.tab.is-preview')?.textContent).toContain('Beta')
  await act(async () => row('Gamma').click())
  expect(host.querySelectorAll('.tab')).toHaveLength(2)
  expect(host.querySelector('.tab.is-preview')?.textContent).toContain('Gamma')
  await act(async () => row('Gamma').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
  expect(host.querySelector('.tab.is-preview')).toBeNull()
  await act(async () => row('Beta').click())
  expect(host.querySelectorAll('.tab')).toHaveLength(3)
  expect(host.querySelector('.tab.is-preview')?.textContent).toContain('Beta')
})
it('promotes previews from the tab, keyboard, title, and body edits', async () => {
  await mount()
  await act(async () => row('Beta').click())
  const betaTab = host.querySelector('.tab.is-preview [role="tab"]') as HTMLButtonElement
  await act(async () => betaTab.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
  expect(host.querySelector('.tab.is-preview')).toBeNull()
  await act(async () => row('Gamma').click())
  const gammaTab = host.querySelector('.tab.is-preview [role="tab"]') as HTMLButtonElement
  await act(async () =>
    gammaTab.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    ),
  )
  expect(host.querySelector('.tab.is-preview')).toBeNull()
  await act(async () => row('Alpha').click())
  expect(host.querySelectorAll('.tab')).toHaveLength(3)
  await act(async () => button('Close Beta').click())
  await act(async () => row('Beta').click())
  expect(host.querySelector('.tab.is-preview')).toBeTruthy()
  await type('Note title', 'Beta edited')
  expect(host.querySelector('.tab.is-preview')).toBeNull()
  await act(async () => button('Close Gamma').click())
  await act(async () => row('Gamma').click())
  expect(host.querySelector('.tab.is-preview')).toBeTruthy()
  await act(async () => getEditor('gamma', notes[2].content).commands.insertContent('Edited '))
  expect(host.querySelector('.tab.is-preview')).toBeNull()
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
    host.querySelector('input[aria-label="Find in current note"]')?.closest('.field-shell'),
  ).not.toBeNull()
  expect(host.querySelector('.find-bar [role="status"]')?.textContent).toBe('1 of 2')
  expect(host.querySelectorAll('.note-find-match')).toHaveLength(2)
  await act(async () => button('Previous match').click())
  expect(host.querySelector('.find-bar [role="status"]')?.textContent).toBe('2 of 2')
  await type('Find in current note', 'alpha')
  expect(host.querySelector('.note-title-highlights mark')?.textContent).toBe('Alpha')
  await act(async () => row('Beta').click())
  expect(
    document.querySelector<HTMLInputElement>('input[aria-label="Find in current note"]')?.value,
  ).toBe('alpha')
  expect(host.querySelector('.find-bar [role="status"]')?.textContent).toBe('No matches')
  await act(async () => button('Close find').click())
  expect(host.querySelectorAll('.note-find-match')).toHaveLength(0)
  const editor = getEditor('beta', notes[1].content)
  await act(async () => editor.commands.insertContent('<h3>New child</h3>'))
  expect(host.querySelector('.note-outline')?.textContent).toContain('New child')
})
it('creates new tabs from the labeled notes-panel button and handles keyboard switching/closing', async () => {
  await mount()
  const launcher = button('New note')
  expect(launcher.closest('#note-list')).not.toBeNull()
  expect(document.querySelectorAll('button[aria-label="New note"]')).toHaveLength(1)
  await hoverTooltip(launcher, 'mouse', 700)
  expect(tooltipLabel()).toBe('New note')
  expect(tooltipShortcut()).toBe('Ctrl+N')
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
  await type('Filter this view', 'Alpha')
  const count = library.getSnapshot().notes.length
  await act(async () => button('New note').click())
  const created = library.getSnapshot().notes[0]
  expect(library.getSnapshot().notes).toHaveLength(count + 1)
  expect(created.notebookIds).toEqual(['work'])
  expect(created.title).toBe('')
  expect(selectedSection()).toBe('Work')
  expect(button('New note').closest('#note-list')).not.toBeNull()
  expect(document.querySelector<HTMLInputElement>('[aria-label="Filter this view"]')?.value).toBe(
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
  const click = (label: string) => () => act(() => button(label).click())
  for (const step of [
    click('Hide sidebar'),
    click('Show sidebar'),
    hideNotesList,
    // With the sidebar visible, Notes reopens from a sidebar view.
    () => act(() => navItem('All notes').click()),
    click('Focus mode'),
    click('Exit focus mode'),
    click('Table of contents'),
    click('Table of contents'),
  ]) {
    await step()
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
  await openPalette(true)
  await type('Search note bodies', 'fix')
  await waitForBodySearch()
  expect(document.querySelectorAll('.content-search-group')).toHaveLength(1)
  expect(document.querySelectorAll('.content-search-match')).toHaveLength(3)
  await act(async () => document.querySelectorAll<HTMLElement>('.content-search-match')[1].click())
  expect(title()).toBe('fix title')
  expect(
    host.querySelector<HTMLInputElement>('input[aria-label="Find in current note"]')?.value,
  ).toBe('fix')
  expect(host.querySelector('.find-bar [role="status"]')?.textContent).toBe('3 of 4')
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
  await act(async () => host.querySelector<HTMLButtonElement>('[role="tab"]')!.click())
  expect(library.getSnapshot().workspace?.recentNoteIds?.[0]).toBe('alpha')
})
it('pins the formatting toolbar from Settings › Editor and saves the choice', async () => {
  library.setAppearance({ ...library.getSnapshot().appearance, showFormattingToolbar: false })
  await mount()
  await act(async () => button('Settings').click())
  const editorCategory = [
    ...document.querySelectorAll<HTMLButtonElement>('.settings-category'),
  ].find((element) => element.textContent === 'Editor')!
  await act(async () => editorCategory.click())
  const toggle = () =>
    document.querySelector<HTMLButtonElement>(
      'button[role="switch"][aria-label="Always show formatting toolbar"]',
    )!
  expect(toggle().getAttribute('aria-checked')).toBe('false')
  await act(async () => toggle().click())
  expect(library.getSnapshot().appearance.showFormattingToolbar).toBe(true)
  expect(toggle().getAttribute('aria-checked')).toBe('true')
  const toolbar = host.querySelector('.desktop-writing-toolbar')
  expect(toolbar?.hasAttribute('data-collapsed')).toBe(false)
  expect(toolbar?.getAttribute('data-placement')).toBe('docked')
  await act(async () => toggle().click())
  expect(library.getSnapshot().appearance.showFormattingToolbar).toBe(false)
})
