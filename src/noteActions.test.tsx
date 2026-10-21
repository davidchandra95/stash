// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import App from './App'
import { library } from './storage/useLibrary'
import { clearSessions } from './editor/session'
import { matchesView, type Note } from './model'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
Element.prototype.scrollIntoView = vi.fn()
Range.prototype.getClientRects = () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () =>
  ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }) as DOMRect
const note = (id: string): Note => ({
  id,
  title: id,
  notebookIds: ['work'],
  quickAccess: false,
  tags: ['existing'],
  pinned: false,
  trashed: false,
  updated: 1,
  text: 'Body #existing',
  content: {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Body ' },
          {
            type: 'text',
            text: '#existing',
            marks: [{ type: 'bodyTag', attrs: { tag: 'existing' } }],
          },
        ],
      },
    ],
  },
})
let cleanup: (() => Promise<void>) | undefined
afterEach(async () => {
  await cleanup?.()
  clearSessions()
  vi.restoreAllMocks()
})
async function mount(withReference = false) {
  const active = note('a')
  if (withReference) {
    active.content = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'noteReference',
              attrs: { noteId: 'b', fallbackTitle: 'b' },
            },
          ],
        },
      ],
    }
    active.text = 'b'
  }
  library.setNotes([active, note('b')])
  library.setNotebooks([
    { id: 'work', name: 'Work', color: '#abc', icon: 'briefcase' },
    { id: 'personal', name: 'Personal', color: '#def', icon: 'notebook' },
  ])
  library.setWorkspace({
    tabs: [{ id: 'a-tab', noteId: 'a' }],
    activeTabId: 'a-tab',
    sidebarView: 'all',
  })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  cleanup = async () => {
    await act(async () => root.unmount())
    host.remove()
  }
  await act(async () => root.render(<App />))
  return host
}
const find = (label: string, role = 'button') =>
  [
    ...(document.querySelector('[role="dialog"]') ?? document).querySelectorAll<HTMLElement>(
      role === 'button' ? 'button' : `[role="${role}"]`,
    ),
  ].find((el) => (el.getAttribute('aria-label') ?? el.textContent?.trim()) === label)!
async function click(label: string, role = 'button') {
  const el = find(label, role)
  expect(el, label).toBeTruthy()
  await act(async () => el.click())
}
async function context(id = 'b', keyboard = false) {
  const row = document.querySelector<HTMLElement>(`.note-row[data-note-id="${id}"]`)!
  await act(async () => {
    row.focus()
    row.dispatchEvent(
      keyboard
        ? new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true })
        : new MouseEvent('contextmenu', { bubbles: true, clientX: 200, clientY: 100 }),
    )
  })
}
async function closeMenu() {
  await act(async () =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
  )
}
async function openNoteActions() {
  const trigger = find('Note actions')
  await act(async () =>
    trigger.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, button: 0, ctrlKey: false }),
    ),
  )
}
const notebooksTrigger = () => document.querySelector<HTMLElement>('.note-chips .chip-add')!
async function notebooksMenu(item: 'Add to notebooks' | 'Move to another notebook') {
  const trigger = notebooksTrigger()
  expect(trigger, 'Notebooks').toBeTruthy()
  await act(async () =>
    trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 })),
  )
  const menuItem = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (el) => el.textContent?.trim() === item,
  )
  expect(menuItem, item).toBeTruthy()
  await act(async () => menuItem!.click())
}
async function input(label: string, text: string) {
  const el = document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, text)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function check(label: string) {
  const el = [...document.querySelectorAll('label')]
    .find((el) => el.textContent?.includes(label))!
    .querySelector<HTMLInputElement>('input')!
  await act(async () => el.click())
}
const target = () => library.getSnapshot().notes.find((n) => n.id === 'b')!
it('marks only the note whose context menu is open, including keyboard opening', async () => {
  await mount()
  const activeRow = document.querySelector<HTMLElement>('.note-row[data-note-id="a"]')!
  const targetRow = document.querySelector<HTMLElement>('.note-row[data-note-id="b"]')!

  await context('b')
  expect(targetRow.dataset.state).toBe('open')
  expect(activeRow.dataset.state).toBe('closed')
  await closeMenu()
  expect(targetRow.dataset.state).toBe('closed')

  await context('a', true)
  expect(activeRow.dataset.state).toBe('open')
  expect(activeRow.classList.contains('is-selected')).toBe(true)
  await closeMenu()
  expect(activeRow.dataset.state).toBe('closed')
})

it('targets inactive notes, separates Quick Access and pinning, copies links and restores trash', async () => {
  await mount()
  const writeText = vi.fn(async () => {})
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  await context()
  expect(document.querySelector<HTMLInputElement>('.note-title')?.value).toBe('a')
  expect(
    [...document.querySelectorAll('[role="menuitem"]')].map(
      (el) => el.getAttribute('aria-label') ?? el.textContent,
    ),
  ).toEqual([
    'Open in new tab',
    'Pin to top',
    'Add to Quick Access',
    'Duplicate',
    'Copy link to note',
    'Move to another notebook',
    'Add to notebooks',
    'Move to trash',
    'Move up',
    'Move down',
  ])
  const items = [...document.querySelectorAll<HTMLElement>('.menu [role="menuitem"]')]
  expect(items).toHaveLength(10)
  expect(
    items.every(
      (item) =>
        !!item.querySelector('svg.menu-icon[aria-hidden="true"]') &&
        !!item.querySelector('.menu-text'),
    ),
  ).toBe(true)
  await click('Pin to top', 'menuitem')
  expect(target().pinned).toBe(true)
  expect(matchesView(target(), 'quickAccess')).toBe(false)
  await context()
  await click('Add to Quick Access', 'menuitem')
  expect(matchesView(target(), 'quickAccess')).toBe(true)
  await context()
  await click('Unpin', 'menuitem')
  expect(target().pinned).toBe(false)
  expect(target().quickAccess).toBe(true)
  await context()
  await click('Copy link to note', 'menuitem')
  expect(writeText).toHaveBeenCalledWith('upnote2://note/b')
  await context()
  await click('Move to trash', 'menuitem')
  expect(target().trashed).toBe(true)
  expect(matchesView(target(), 'quickAccess')).toBe(false)
  await act(async () =>
    document.querySelector<HTMLButtonElement>('.sidebar-footer [aria-label="Trash"]')!.click(),
  )
  await context()
  expect(
    [...document.querySelectorAll('[role="menuitem"]')].map(
      (el) => el.getAttribute('aria-label') ?? el.textContent,
    ),
  ).toEqual(['Open in new tab', 'Restore note', 'Move up', 'Move down'])
  await click('Restore note', 'menuitem')
  expect(target().trashed).toBe(false)
})
it('supports keyboard opening and Escape without navigating the editor', async () => {
  await mount()
  await context('b', true)
  expect(find('Duplicate', 'menuitem')).toBeTruthy()
  await act(async () =>
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    ),
  )
  expect(document.querySelector('[role="menu"]')).toBeNull()
  expect(document.querySelector<HTMLInputElement>('.note-title')?.value).toBe('a')
})
it('uses the shared compact menu shell for note list, editor, and note-link actions', async () => {
  await mount(true)

  await context()
  expect(document.querySelector('[role="menu"].menu')).toBeTruthy()
  await closeMenu()
  expect(document.querySelector('[role="menu"]')).toBeNull()

  await openNoteActions()
  const menu = document.querySelector<HTMLElement>('[role="menu"].menu')
  expect(menu).toBeTruthy()
  const items = [...menu!.querySelectorAll<HTMLElement>('[role="menuitem"]')]
  expect(items.length).toBeGreaterThan(0)
  expect(
    items.every(
      (item) =>
        !!item.querySelector('svg.menu-icon[aria-hidden="true"]') &&
        !!item.querySelector('.menu-text'),
    ),
  ).toBe(true)
  await closeMenu()

  const reference = document.querySelector<HTMLElement>('.note-reference')!
  expect(reference).toBeTruthy()
  await act(async () =>
    reference.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 200,
        clientY: 100,
      }),
    ),
  )
  const linkMenu = document.querySelector<HTMLElement>('.menu.note-link-context[role="menu"]')
  expect(linkMenu).toBeTruthy()
  expect(linkMenu!.querySelector('.menu-item[role="menuitem"]')?.textContent).toBe(
    'Open in new tab',
  )
})
it('uses an inline picker to add memberships immediately, creates notebooks, and moves notes', async () => {
  await mount()
  await context()
  await click('Add to notebooks', 'menuitem')
  expect(document.querySelector('.add-notebooks-popover')).toBeTruthy()
  expect(document.querySelector('.dialog-overlay')).toBeNull()
  expect(
    document
      .querySelector('[aria-label="Search notebooks"]')
      ?.parentElement?.classList.contains('field-shell'),
  ).toBe(true)
  await input('Search notebooks', 'personal')
  expect(
    [...document.querySelectorAll('label')].some((label) => label.textContent?.includes('Work')),
  ).toBe(false)
  await input('Search notebooks', '')
  expect(
    [...document.querySelectorAll('label')]
      .find((el) => el.textContent?.includes('Work'))!
      .querySelector('input')!.disabled,
  ).toBe(true)
  await check('Personal')
  expect(target().notebookIds).toEqual(['work', 'personal'])
  expect(document.querySelector('.add-notebooks-popover')).toBeTruthy()
  expect(
    [...document.querySelectorAll('button')].some((button) => button.textContent === 'Apply'),
  ).toBe(false)
  await click('New notebook')
  expect(
    document.querySelector('[aria-label="New notebook name"]')?.classList.contains('field'),
  ).toBe(true)
  await input('New notebook name', 'New collection')
  await click('Create')
  expect(library.getSnapshot().notebooks.some((b) => b.name === 'New collection')).toBe(true)
  expect(target().notebookIds).toHaveLength(3)
  await act(async () =>
    document
      .querySelector<HTMLInputElement>('[aria-label="Search notebooks"]')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
  )
  expect(document.querySelector('.add-notebooks-popover')).toBeNull()
  const metadataAdd = notebooksTrigger()
  await notebooksMenu('Add to notebooks')
  expect(document.querySelector('.add-notebooks-popover')).toBeTruthy()
  expect(document.activeElement).toBe(document.querySelector('[aria-label="Search notebooks"]'))
  await act(async () =>
    document
      .querySelector<HTMLInputElement>('[aria-label="Search notebooks"]')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
  )
  expect(document.querySelector('.add-notebooks-popover')).toBeNull()
  expect(document.activeElement).toBe(metadataAdd)
  await context()
  await click('Move to another notebook', 'menuitem')
  await check('Personal')
  expect(find('Move').hasAttribute('disabled')).toBe(true)
  await act(async () =>
    document.querySelector<HTMLInputElement>('[aria-label="Move from Work"]')!.click(),
  )
  await click('Move')
  const createdId = library.getSnapshot().notebooks.find((b) => b.name === 'New collection')!.id
  expect(target().notebookIds).toEqual(['personal', createdId])
  await context()
  await click('Move to another notebook', 'menuitem')
  await check('Uncategorized')
  await act(async () =>
    document.querySelector<HTMLInputElement>('[aria-label="Move from New collection"]')!.click(),
  )
  await click('Move')
  expect(target().notebookIds).toEqual(['personal'])
  await context()
  await click('Move to another notebook', 'menuitem')
  await check('Uncategorized')
  await click('Move')
  expect(matchesView(target(), 'uncategorized')).toBe(true)
})
it('derives sidebar tags from confirmed content and seeds a new note created in a tag view', async () => {
  await mount()
  const tag = [...document.querySelectorAll<HTMLButtonElement>('.side-tags button.chip')].find(
    (button) => button.textContent === '#existing',
  )!
  await act(async () => tag.click())
  expect(tag.classList.contains('is-selected')).toBe(true)
  expect(tag.getAttribute('aria-current')).toBe('page')
  await act(async () =>
    document.querySelector<HTMLButtonElement>('[aria-label="New note"]')!.click(),
  )
  const created = library.getSnapshot().notes.find((note) => note.id !== 'a' && note.id !== 'b')!
  expect(created.text).toBe('Tags: #existing')
  expect(created.tags).toEqual(['existing'])

  library.setNotes((notes) =>
    notes.map((note) =>
      note.id === created.id
        ? {
            ...note,
            text: 'A changed body #fresh',
            content: {
              type: 'doc',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'A changed body #fresh' }] },
              ],
            },
          }
        : note,
    ),
  )
  expect(library.getSnapshot().notes.find((note) => note.id === created.id)?.tags).toEqual([])
})
it('duplicates full content and exposes retry for clipboard failures', async () => {
  await mount()
  await context()
  await click('Duplicate', 'menuitem')
  expect(library.getSnapshot().notes.find((n) => n.title === 'b copy')?.content).toEqual(
    note('b').content,
  )
  const writeText = vi
    .fn()
    .mockRejectedValueOnce(Error('Clipboard denied'))
    .mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  await context()
  await click('Copy link to note', 'menuitem')
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('Clipboard denied')
  await click('Retry')
  expect(writeText).toHaveBeenCalledTimes(2)
})

it('moves by keyboard menu without changing the editor and restores custom order after automatic sorting', async () => {
  library.setWorkspace({ tabs: [], activeTabId: null, noteLists: {} })
  await mount()
  const order = () =>
    [...document.querySelectorAll<HTMLElement>('.note-row[data-note-id]')].map(
      (row) => row.dataset.noteId,
    )
  const openListMenu = async () =>
    act(async () =>
      find('Sort and view options').dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, button: 0 }),
      ),
    )
  const changeSort = async (mode: string) => {
    await openListMenu()
    await click(mode, 'menuitemradio')
  }
  const currentSort = async () => {
    await openListMenu()
    const checked = document
      .querySelector('[role="group"][aria-label="Change note sorting"]')
      ?.querySelector('[role="menuitemradio"][aria-checked="true"]')
      ?.textContent?.trim()
    await closeMenu()
    return checked
  }
  await changeSort('Title')
  expect(order()).toEqual(['a', 'b'])
  await context('b', true)
  await click('Move up', 'menuitem')
  expect(order()).toEqual(['b', 'a'])
  expect(await currentSort()).toBe('Custom')
  expect(document.querySelector<HTMLInputElement>('.note-title')?.value).toBe('a')
  await changeSort('Title')
  expect(order()).toEqual(['a', 'b'])
  await changeSort('Custom')
  expect(order()).toEqual(['b', 'a'])
  await changeSort('Last edited')
  await context('b', true)
  await click('Move up', 'menuitem')
  expect(order()).toEqual(['b', 'a'])
  expect(await currentSort()).toBe('Custom')
})

it.each([true, false])(
  'dismisses notebook pickers after switching; initial Add=%s',
  async (initialAdd) => {
    await mount()
    const errors = vi.spyOn(console, 'error')
    const outside = async () => {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
      })
      const title = document.querySelector<HTMLInputElement>('.note-title')!
      await act(async () => {
        title.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
        title.focus()
        title.click()
      })
      expect(document.querySelector('[role="dialog"]')).toBeNull()
      expect(document.activeElement).toBe(title)
    }
    if (initialAdd) {
      await notebooksMenu('Add to notebooks')
      await outside()
    }
    for (let i = 0; i < 2; i++) {
      await notebooksMenu('Move to another notebook')
      expect(document.querySelector('.move-notebooks-popover')).toBeTruthy()
      expect(document.querySelector('.dialog-overlay')).toBeNull()
      await outside()
      await notebooksMenu('Add to notebooks')
      await outside()
    }
    expect(errors.mock.calls.filter((args) => String(args[0]).includes('same key'))).toEqual([])
  },
)

it('switches directly between pickers and restores focus for Escape and Cancel', async () => {
  await mount()
  const trigger = notebooksTrigger()
  // One Notebooks menu replaces the separate Add to notebooks and Move buttons.
  expect(
    [...document.querySelectorAll('.note-chips .chip-add')].map((el) => el.textContent?.trim()),
  ).toEqual(['Notebook'])
  expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
  for (const item of [
    'Add to notebooks',
    'Move to another notebook',
    'Add to notebooks',
    'Move to another notebook',
  ] as const) {
    await notebooksMenu(item)
    expect(document.querySelectorAll('.notebook-popover')).toHaveLength(1)
    expect(document.activeElement).toBe(document.querySelector('[aria-label="Search notebooks"]'))
  }
  await closeMenu()
  expect(document.querySelector('.notebook-popover')).toBeNull()
  expect(document.activeElement).toBe(trigger)
  await notebooksMenu('Move to another notebook')
  await click('Cancel')
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
  expect(document.querySelector('.notebook-popover')).toBeNull()
  expect(document.activeElement).toBe(trigger)
})

it('searches Move destinations and creates a selected notebook without moving until confirmed', async () => {
  await mount()
  await notebooksMenu('Move to another notebook')
  expect(find('Move').hasAttribute('disabled')).toBe(true)
  await input('Search notebooks', 'missing')
  expect(document.querySelector('.move-notebooks-popover')?.textContent).toContain(
    'No notebooks found.',
  )
  await input('Search notebooks', 'Personal')
  await check('Personal')
  expect(library.getSnapshot().notes[0].notebookIds).toEqual(['work'])
  await click('New notebook')
  expect(document.activeElement).toBe(document.querySelector('[aria-label="New notebook name"]'))
  await input('New notebook name', 'Destination')
  await click('Create')
  const book = library.getSnapshot().notebooks.find((book) => book.name === 'Destination')!
  expect(book).toBeTruthy()
  expect(library.getSnapshot().notes[0].notebookIds).toEqual(['work'])
  const selected = document.querySelector<HTMLInputElement>(
    '.move-notebooks-popover .picker-list input:checked',
  )!
  expect(selected.closest('label')?.textContent).toContain('Destination')
  await click('Move')
  expect(library.getSnapshot().notes[0].notebookIds).toEqual([book.id])
  expect(document.querySelector('.notebook-popover')).toBeNull()
})

it.each(['context', 'toolbar'])('focuses Move search after the %s menu closes', async (menu) => {
  await mount()
  if (menu === 'context') await context()
  else await openNoteActions()
  await click('Move to another notebook', 'menuitem')
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30))
  })
  expect(document.querySelector('.move-notebooks-popover')).toBeTruthy()
  expect(document.activeElement).toBe(document.querySelector('[aria-label="Search notebooks"]'))
})
