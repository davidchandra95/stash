// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import NotebookTree from './NotebookTree'
import type { Notebook } from '../model'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let host: HTMLDivElement | undefined
let root: ReturnType<typeof createRoot> | undefined

afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  host?.remove()
  host = undefined
  root = undefined
  vi.restoreAllMocks()
})

const books: Notebook[] = [
  { id: 'work', name: 'Work', color: '#899ab4', icon: 'briefcase' },
  {
    id: 'learning',
    name: 'Learning',
    color: '#ba9775',
    icon: 'folder',
    rootId: 'learning',
    relativePath: '',
  },
  { id: 'child', name: 'Child', color: '#82936f', icon: 'notebook', parentId: 'work' },
]

async function mount(active = 'book:work', disabled = false) {
  const createChild = vi.fn()
  const createNote = vi.fn()
  const edit = vi.fn()
  const deleteNotebook = vi.fn()
  const refresh = vi.fn()
  const reselect = vi.fn()
  const convert = vi.fn()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () =>
    root!.render(
      <NotebookTree
        books={books}
        active={active}
        dark={false}
        palette="classic"
        renderBook={(book) => (
          <button className={`nav-item ${active === `book:${book.id}` ? 'selected' : ''}`}>
            <span>{book.name}</span>
          </button>
        )}
        createNote={createNote}
        edit={edit}
        deleteNotebook={deleteNotebook}
        createChild={createChild}
        refresh={refresh}
        reselect={reselect}
        convert={convert}
        disabled={disabled}
      />,
    ),
  )
  return { createChild, createNote, edit, deleteNotebook, refresh, reselect, convert }
}

function row(name: string) {
  return [...host!.querySelectorAll<HTMLElement>('.notebook-tree-row')].find((element) =>
    element.textContent?.includes(name),
  )!
}

function menuItems() {
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].map((item) =>
    item.textContent?.trim(),
  )
}

async function selectMenuItem(label: string) {
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (element) => element.textContent?.trim() === label,
  )!
  expect(item).toBeTruthy()
  await act(async () => item.click())
}

async function rightClick(target: HTMLElement) {
  const event = new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: 80,
    clientY: 80,
  })
  await act(async () => target.dispatchEvent(event))
  return event
}

async function closeMenu() {
  await act(async () =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
  )
}

async function openFromOptions(target: HTMLElement) {
  const trigger = target.querySelector<HTMLButtonElement>('.notebook-options')!
  await act(async () =>
    trigger.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, button: 0, ctrlKey: false }),
    ),
  )
}

it('puts selected background ownership on the full row around the action button', async () => {
  await mount()
  const selected = row('Work')

  expect(selected.classList.contains('selected')).toBe(true)
  expect(selected.querySelector('button[aria-label="Actions for Work"]')).not.toBeNull()
})

it('places the new-note shortcut before the menu and targets its notebook', async () => {
  const { createNote } = await mount('book:child')
  const target = row('Learning')
  const shortcut = target.querySelector<HTMLButtonElement>('.notebook-new-note')!
  const options = target.querySelector<HTMLButtonElement>('.notebook-options')!

  expect(shortcut.getAttribute('aria-label')).toBe('New note in Learning')
  expect(shortcut.nextElementSibling).toBe(options)
  await act(async () => shortcut.click())
  expect(createNote).toHaveBeenCalledExactlyOnceWith(books[1])
})

it('disables the new-note shortcut when notebook actions are blocked', async () => {
  const { createNote } = await mount('book:work', true)
  const shortcut = row('Work').querySelector<HTMLButtonElement>('.notebook-new-note')!

  expect(shortcut.disabled).toBe(true)
  await act(async () => shortcut.click())
  expect(createNote).not.toHaveBeenCalled()
})

it('marks the notebook row while its menu is open and clears it on close', async () => {
  await mount()
  const selected = row('Work')
  const target = row('Learning')

  await rightClick(target)
  expect(target.classList.contains('menu-open')).toBe(true)
  expect(selected.classList.contains('menu-open')).toBe(false)
  await closeMenu()
  expect(target.classList.contains('menu-open')).toBe(false)

  await openFromOptions(selected)
  expect(selected.classList.contains('menu-open')).toBe(true)
  expect(selected.classList.contains('selected')).toBe(true)
  await closeMenu()
  expect(selected.classList.contains('menu-open')).toBe(false)
})

it('prevents the native menu and opens the linked notebook actions on right-click', async () => {
  const { refresh, reselect } = await mount()
  const event = await rightClick(row('Learning'))

  expect(event.defaultPrevented).toBe(true)
  expect(document.querySelector('.workspace-action-menu')).toBeTruthy()
  expect(menuItems()).toEqual([
    'New note',
    'Edit',
    'New sub-notebook',
    'Refresh folder',
    'Convert to Stash notebook…',
    'Locate linked folder…',
    'Delete notebook',
  ])
  expect(
    [...document.querySelectorAll<HTMLElement>('.workspace-action-menu [role="menuitem"]')].every(
      (item) =>
        !!item.querySelector('svg.menu-action-icon[aria-hidden="true"]') &&
        !!item.querySelector('.menu-action-label'),
    ),
  ).toBe(true)
  const deleteItem = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (item) => item.textContent?.trim() === 'Delete notebook',
  )!
  expect(
    deleteItem.hasAttribute('data-disabled') || deleteItem.getAttribute('aria-disabled') === 'true',
  ).toBe(true)
  expect(document.body.textContent).toContain('Folder-linked notebooks cannot be deleted.')
  await selectMenuItem('Refresh folder')
  expect(refresh).toHaveBeenCalledWith('learning')

  await rightClick(row('Learning'))
  await selectMenuItem('Locate linked folder…')
  expect(reselect).toHaveBeenCalledWith('learning')
})

it('uses the same menu for the ellipsis button and targets nested notebooks', async () => {
  const { createChild, createNote, edit, deleteNotebook } = await mount()
  await openFromOptions(row('Work'))
  const optionsMenu = menuItems()
  expect(optionsMenu).toEqual(['New note', 'Edit', 'New sub-notebook', 'Delete notebook'])
  await selectMenuItem('New note')
  expect(createNote).toHaveBeenCalledWith(books[0])

  await openFromOptions(row('Work'))
  await selectMenuItem('Edit')
  expect(edit).toHaveBeenCalledWith(books[0])

  await openFromOptions(row('Work'))
  await selectMenuItem('New sub-notebook')
  expect(createChild).toHaveBeenCalledWith(books[0])

  await openFromOptions(row('Work'))
  await selectMenuItem('Delete notebook')
  expect(deleteNotebook).toHaveBeenCalledWith(books[0])

  await rightClick(row('Work'))
  expect(menuItems()).toEqual(optionsMenu)
  await closeMenu()

  await rightClick(row('Child'))
  expect(menuItems()).toEqual(optionsMenu)
  await selectMenuItem('New sub-notebook')
  expect(createChild).toHaveBeenLastCalledWith(books[2])
})

it('offers conversion for the imported root notebook', async () => {
  const { convert } = await mount('book:learning')
  await act(async () =>
    row('Learning').dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    ),
  )
  expect(menuItems()).toContain('Convert to Stash notebook…')
  await selectMenuItem('Convert to Stash notebook…')
  expect(convert).toHaveBeenCalledWith(books[1])
})
