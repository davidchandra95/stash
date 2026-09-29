// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import App from './App'
import { library } from './storage/useLibrary'
import { defaultAppearance } from './storage/library'
import { clearSessions } from './editor/session'
import type { Note, Notebook } from './model'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
Element.prototype.scrollIntoView = vi.fn()
Range.prototype.getClientRects = () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () =>
  ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }) as DOMRect

const notebooks: Notebook[] = [
  { id: 'work', name: 'Work', color: '#899ab4', icon: 'briefcase' },
  { id: 'personal', name: 'Personal', color: '#82936f', icon: 'notebook' },
]
const makeNote = (id: string, notebookIds: string[]): Note => ({
  id,
  title: id,
  notebookIds,
  quickAccess: false,
  tags: [],
  content: { type: 'doc', content: [{ type: 'paragraph' }] },
  text: '',
  pinned: false,
  trashed: false,
  updated: 1,
})

let host: HTMLDivElement | undefined
let root: ReturnType<typeof createRoot> | undefined
afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  host?.remove()
  host = undefined
  root = undefined
  clearSessions()
  vi.restoreAllMocks()
})

async function mount() {
  library.setAppearance(defaultAppearance)
  library.setNotebooks(notebooks)
  library.setNotes([makeNote('work-note', ['work']), makeNote('personal-note', ['personal'])])
  library.setWorkspace({ tabs: [{ id: 'work-tab', noteId: 'work-note' }], activeTabId: 'work-tab' })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(<App />))
}

function row(name: string) {
  return [...host!.querySelectorAll<HTMLElement>('.notebook-tree-row')].find((item) =>
    item.textContent?.includes(name),
  )!
}

it('shows direct active note counts beside notebook titles and omits empty badges', async () => {
  await mount()
  await act(async () => {
    library.setNotebooks([
      ...notebooks,
      { id: 'child', name: 'Child', color: '#899ab4', icon: 'folder', parentId: 'work' },
      { id: 'empty', name: 'Empty', color: '#82936f', icon: 'folder' },
    ])
    library.setNotes([
      makeNote('work-note', ['work']),
      makeNote('personal-note', ['personal']),
      makeNote('shared-note', ['work', 'personal']),
      makeNote('child-note', ['child']),
      { ...makeNote('trashed-note', ['work']), trashed: true },
    ])
  })

  for (const [name, count] of [
    ['Work', '2'],
    ['Personal', '2'],
    ['Child', '1'],
  ]) {
    const button = row(name).querySelector<HTMLButtonElement>('.notebook-nav-item')!
    expect(button.querySelector('span')?.textContent).toBe(name)
    expect(button.querySelector('.notebook-count')?.textContent).toBe(count)
  }
  expect(row('Empty').querySelector('.notebook-count')).toBeNull()
  const allNotes = [...host!.querySelectorAll<HTMLButtonElement>('.nav-item')].find((button) =>
    button.textContent?.startsWith('All notes'),
  )!
  expect(allNotes.querySelector('.notebook-count')?.textContent).toBe('4')
})

it('shows nonzero desktop navigation counts in badges and updates them with notes', async () => {
  await mount()
  const today = new Date().setHours(12, 0, 0, 0)
  const yesterdayDate = new Date(today)
  yesterdayDate.setDate(yesterdayDate.getDate() - 1)
  const yesterday = yesterdayDate.getTime()
  const kept = { ...makeNote('kept', ['work']), updated: yesterday }
  await act(async () => {
    library.setNotes([
      { ...makeNote('first', []), updated: today, hasTasks: true, pinned: true, quickAccess: true },
      kept,
      { ...makeNote('third', []), updated: yesterday, hasTasks: true, pinned: true },
      {
        ...makeNote('trashed', []),
        updated: today,
        hasTasks: true,
        pinned: true,
        quickAccess: true,
        trashed: true,
      },
    ])
  })

  const countFor = (label: string) =>
    [...host!.querySelectorAll<HTMLButtonElement>('.nav-item:not(.notebook-nav-item)')]
      .find((button) => button.querySelector('span')?.textContent === label)
      ?.querySelector('.notebook-count')?.textContent
  expect([
    countFor('All notes'),
    countFor('Today'),
    countFor('To-do'),
    countFor('Uncategorized'),
    countFor('Pinned notes'),
    countFor('Quick Access'),
  ]).toEqual(['3', '1', '2', '2', '2', '1'])

  await act(async () => library.setNotes([kept]))
  expect(countFor('All notes')).toBe('1')
  for (const label of ['Today', 'To-do', 'Uncategorized', 'Pinned notes', 'Quick Access']) {
    expect(countFor(label)).toBeUndefined()
  }
})

async function openMenu(name: string) {
  const trigger = row(name).querySelector<HTMLButtonElement>('.notebook-options')!
  await act(async () =>
    trigger.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, button: 0, ctrlKey: false }),
    ),
  )
}

async function selectMenu(label: string) {
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (candidate) => candidate.textContent?.trim() === label,
  )!
  expect(item).toBeTruthy()
  await act(async () => item.click())
}

async function setText(label: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

it('creates a note in the clicked notebook even when another notebook is selected', async () => {
  await mount()
  await act(async () => row('Personal').querySelector<HTMLButtonElement>('.nav-item')!.click())
  await openMenu('Work')
  await selectMenu('New note')

  const created = library.getSnapshot().notes.find((note) => note.title === '')!
  expect(created.notebookIds).toEqual(['work'])
  expect(
    [...host!.querySelectorAll<HTMLButtonElement>('.nav-item')]
      .find((button) => button.textContent?.startsWith('Work'))
      ?.getAttribute('aria-current'),
  ).toBe('page')
})

it('creates a note from the notebook hover shortcut even when another notebook is selected', async () => {
  await mount()
  await act(async () => row('Personal').querySelector<HTMLButtonElement>('.nav-item')!.click())
  const shortcut = row('Work').querySelector<HTMLButtonElement>('.notebook-new-note')!
  await act(async () => shortcut.click())

  const created = library.getSnapshot().notes.find((note) => note.title === '')!
  expect(created.notebookIds).toEqual(['work'])
  expect(row('Work').querySelector('.nav-item')?.getAttribute('aria-current')).toBe('page')
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Note title')
})

it('edits a notebook name, built-in icon, and color from its menu', async () => {
  await mount()
  await openMenu('Work')
  await selectMenu('Edit')
  expect(document.querySelector<HTMLInputElement>('[aria-label="Notebook name"]')?.value).toBe(
    'Work',
  )
  await act(async () =>
    document.querySelector<HTMLButtonElement>('[aria-label="Palette"]')!.click(),
  )
  await setText('Notebook name', 'Projects')
  const color = document.querySelector<HTMLInputElement>('[aria-label="Notebook color"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      color,
      '#c56a5d',
    )
    color.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await act(async () => document.querySelector<HTMLButtonElement>('button[type="submit"]')!.click())

  expect(library.getSnapshot().notebooks.find((book) => book.id === 'work')).toMatchObject({
    name: 'Projects',
    icon: 'palette',
    color: '#c56a5d',
  })
})

it('opens the new-notebook dialog from the aligned sidebar control', async () => {
  await mount()
  const trigger = document.querySelector<HTMLButtonElement>('[aria-label="New notebook"]')!
  expect(trigger.classList.contains('new-notebook-button')).toBe(true)
  await act(async () => trigger.click())
  expect(document.querySelector('[role="dialog"]')).toBeTruthy()
  expect(document.querySelector('[aria-label="Notebook name"]')).toBeTruthy()
})

it('deletes the selected notebook, moves its notes to Trash, and navigates away', async () => {
  await mount()
  await act(async () => row('Work').querySelector<HTMLButtonElement>('.nav-item')!.click())
  await openMenu('Work')
  await selectMenu('Delete notebook')

  const scope = [
    ...document.querySelectorAll<HTMLInputElement>('input[name="notebook-delete-scope"]'),
  ]
  const noteChoices = [
    ...document.querySelectorAll<HTMLInputElement>('input[name="notebook-delete-notes"]'),
  ]
  expect(scope[0].checked).toBe(true)
  expect(noteChoices[0].checked).toBe(true)
  await act(async () => {
    noteChoices[1].click()
    document.querySelector<HTMLButtonElement>('button[type="submit"]')!.click()
  })

  expect(library.getSnapshot().notebooks.find((book) => book.id === 'work')).toBeUndefined()
  expect(library.getSnapshot().notes.find((note) => note.id === 'work-note')).toMatchObject({
    trashed: true,
    notebookIds: [],
  })
  expect(
    [...host!.querySelectorAll<HTMLButtonElement>('.nav-item')]
      .find((button) => button.textContent?.startsWith('All notes'))
      ?.getAttribute('aria-current'),
  ).toBe('page')
})
