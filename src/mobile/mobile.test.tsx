// @vitest-environment jsdom
import * as tauriCore from '@tauri-apps/api/core'
import { onBackButtonPress } from '@tauri-apps/api/app'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import MobileApp from './MobileApp'
import { library } from '../storage/useLibrary'
import { clearSessions, getEditor } from '../editor/session'
import { platform } from '../platform'
import type { Note } from '../model'
import { initialNavigation, mobileNavigation, projectRoute } from './navigation'
import { projectStore } from '../projects/store'
vi.mock('@tauri-apps/api/core', async (importOriginal) => ({
  ...(await importOriginal<typeof tauriCore>()),
  isTauri: vi.fn(() => false),
  invoke: vi.fn(async () => undefined),
}))
vi.mock('@tauri-apps/api/app', () => ({
  onBackButtonPress: vi.fn(async () => ({ unregister: vi.fn() })),
}))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
Element.prototype.scrollIntoView = vi.fn()
Element.prototype.scrollBy = vi.fn()
window.scrollBy = vi.fn()
Range.prototype.getClientRects = () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () =>
  ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }) as DOMRect
let root: ReturnType<typeof createRoot>
let host: HTMLDivElement
const makeNote = (id: string, book: string): Note => ({
  id,
  title: id,
  notebookIds: [book],
  quickAccess: false,
  tags: [],
  pinned: false,
  trashed: false,
  updated: 1,
  text: `Body ${id}`,
  content: {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: `Body ${id}` }] }],
  },
})
beforeEach(async () => {
  platform.mobile = true
  library.setNotebooks([
    { id: 'parent', name: 'Parent', icon: 'book', color: '#82936f' },
    { id: 'child', name: 'Child', parentId: 'parent', icon: 'book', color: '#82936f' },
  ])
  library.setNotes([makeNote('Direct note', 'parent'), makeNote('Nested note', 'child')])
  library.setNoteListMode('compact')
  vi.mocked(tauriCore.isTauri).mockReturnValue(true)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(<MobileApp />))
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  clearSessions()
  vi.mocked(tauriCore.isTauri).mockReturnValue(false)
  platform.mobile = false
  vi.restoreAllMocks()
  delete document.documentElement.dataset.platform
})
const find = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.getAttribute('aria-label') === label || b.textContent?.trim() === label,
  )!
async function click(label: string) {
  const b = find(label)
  expect(b, label).toBeTruthy()
  await act(async () => b.click())
}
async function androidBack() {
  const callback = vi.mocked(onBackButtonPress).mock.calls.at(-1)![0]
  await act(async () => callback({ canGoBack: false }))
}
async function input(label: string, value: string) {
  const el = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
it('keeps expansion separate from navigation and lists only direct notes below children', async () => {
  await click('Open navigation')
  await click('Collapse Parent')
  expect(document.querySelector('[aria-label="Expand Parent"]')).toBeTruthy()
  expect(document.querySelector('.mobile-header h1')?.textContent).toBe('All notes')
  expect(document.querySelector('.mobile-heading-icon')).toBeNull()
  const parent = document.querySelector<HTMLButtonElement>('.mobile-book-label')!
  await act(async () => parent.click())
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(document.querySelector('.mobile-header h1')?.textContent).toBe('Parent')
  const headingIcon = document.querySelector<SVGElement>('.mobile-heading-icon')
  expect(headingIcon?.getAttribute('aria-hidden')).toBe('true')
  expect(headingIcon?.style.color).toBe('var(--notebook-sage)')
  expect(document.querySelector('.mobile-subnotebooks')?.textContent).toContain('Child')
  expect(document.querySelector('section[aria-label="Notes"]')?.textContent).toContain(
    'Direct note',
  )
  expect(document.querySelector('section[aria-label="Notes"]')?.textContent).not.toContain(
    'Nested note',
  )
  expect(
    document.querySelector('.mobile-list')?.firstElementChild?.getAttribute('aria-label'),
  ).toBe('Sub-notebooks')
})
it('shows only the drawer and note actions in the note header', async () => {
  await click('Direct note')
  const header = document.querySelector('.mobile-note-header')!
  expect([...header.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))).toEqual([
    'Open navigation',
    'Note actions',
  ])
  expect(header.textContent).toBe('')
  expect(document.querySelector('.mobile-save-status')).toBeNull()
  await click('Open navigation')
  expect(document.querySelector('[role="dialog"]')).toBeTruthy()
  await androidBack()
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(document.querySelector('.note-title')).toBeTruthy()
  await click('Note actions')
  expect(document.querySelector('[role="dialog"]')).toBeTruthy()
  await androidBack()
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(document.querySelector('.note-title')).toBeTruthy()
})
it('returns to the search and scroll position without opening the keyboard on an existing note', async () => {
  await click('Search notes')
  await input('Search notes', 'Direct')
  document.querySelector<HTMLElement>('.mobile-list')!.scrollTop = 125
  await click('Direct note')
  expect(document.activeElement?.getAttribute('aria-label')).not.toBe('Note title')
  expect(document.querySelector('.writing-cursor-layer')).toBeNull()
  await androidBack()
  expect(document.querySelector<HTMLInputElement>('input[aria-label="Search notes"]')!.value).toBe(
    'Direct',
  )
  expect(document.querySelector('.mobile-list')!.scrollTop).toBe(125)
})
it('blocks navigation when saving fails and preserves the note for retry', async () => {
  await click('Direct note')
  const flush = vi.spyOn(library, 'flush').mockRejectedValueOnce(Error('Disk full'))
  await androidBack()
  expect(document.querySelector('.note-title')).toBeTruthy()
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('Disk full')
  flush.mockResolvedValue(undefined)
  await click('Retry')
  await androidBack()
  expect(document.querySelector('.mobile-list')).toBeTruthy()
})
it('focuses a new title after the navigation guard unlocks editing, and title keys enter the body', async () => {
  await click('New note')
  const title = document.querySelector<HTMLTextAreaElement>('.note-title')!
  expect(title.disabled).toBe(false)
  expect(document.activeElement).toBe(title)
  for (const key of ['Enter', 'ArrowDown']) {
    title.focus()
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
    await act(async () => {
      title.dispatchEvent(event)
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
    expect(event.defaultPrevented).toBe(true)
    expect(document.activeElement?.classList.contains('tiptap')).toBe(true)
  }
})
it('opens settings categories as pages, preserves values, and hides desktop-only settings', async () => {
  await click('Open navigation')
  await click('Settings')
  expect(document.querySelector('[aria-label="Theme"]')).toBeNull()
  await click('Typography')
  const picker = document.querySelector<HTMLSelectElement>('[aria-label="Note font"]')!
  expect([...picker.options].map((o) => o.textContent)).toEqual([
    'System sans',
    'System serif',
    'System monospace',
  ])
  await act(async () => {
    picker.value = 'system'
    picker.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await click('Back')
  await click('Typography')
  expect(document.querySelector<HTMLSelectElement>('[aria-label="Note font"]')!.value).toBe(
    'system',
  )
  await click('Back')
  await click('Editor')
  expect(document.querySelector('[aria-label="Cursor style"]')).toBeNull()
  expect(document.querySelector('[aria-label="Writing width"]')).toBeNull()
  expect(document.querySelector('[aria-label="Line spacing"]')).toBeTruthy()
  expect(document.querySelector('[aria-label="List item spacing"]')).toBeTruthy()
})
it('applies formatting to the selected text with undo and redo using the shared editor', async () => {
  await click('Direct note')
  const editor = getEditor('Direct note', library.getSnapshot().notes[0].content)
  await act(async () => {
    editor.commands.setTextSelection({ from: 1, to: 5 })
  })
  await click('Bold')
  expect(editor.getJSON().content?.[0].content?.[0].marks?.[0].type).toBe('bold')
  await click('Undo')
  expect(editor.getJSON().content?.[0].content?.[0].marks).toBeUndefined()
  await click('Redo')
  expect(editor.getJSON().content?.[0].content?.[0].marks?.[0].type).toBe('bold')
})
it('keeps settings and nested notebook history typed and bounded at the library root', () => {
  const initial = initialNavigation()
  expect(mobileNavigation(initial, { type: 'back' })).toBe(initial)
  const nested = mobileNavigation(initial, {
    type: 'push',
    route: { kind: 'settings', category: 'sync' },
  })
  expect(mobileNavigation(nested, { type: 'back' })).toEqual(initial)
})

it('switches saved list views while preserving search and scroll and showing context only in All notes', async () => {
  await act(async () => library.setNoteListMode('compact'))
  expect(host.querySelectorAll('.note-list-preview')).toHaveLength(0)
  expect(host.querySelector('.note-list-notebook')?.textContent).toBe('Parent')
  await click('Search notes')
  await input('Search notes', 'Direct')
  const list = host.querySelector<HTMLElement>('.mobile-list')!
  list.scrollTop = 37
  await click('Page actions')
  const preview = document.querySelector<HTMLInputElement>(
    'input[name="note-list-mode"][value="preview"]',
  )!
  expect(preview).toBeTruthy()
  await act(async () => preview.click())
  expect(library.getSnapshot().workspace?.noteListMode).toBe('preview')
  expect(host.querySelector('.note-list-preview')?.textContent).toBe('Body Direct note')
  expect(host.querySelector<HTMLInputElement>('input[aria-label="Search notes"]')?.value).toBe(
    'Direct',
  )
  expect(list.scrollTop).toBe(37)
  await click('Direct note')
  await androidBack()
  expect(host.querySelector('.note-list-preview')?.textContent).toBe('Body Direct note')
  await click('Open navigation')
  await act(async () =>
    document.querySelector<HTMLButtonElement>('.mobile-drawer .mobile-book-label')!.click(),
  )
  expect(host.querySelector('.note-list-notebook')).toBeNull()
  expect(host.querySelector('.note-list-preview')?.textContent).toBe('Body Direct note')
  await click('Page actions')
  await act(async () =>
    document
      .querySelector<HTMLInputElement>('input[name="note-list-mode"][value="compact"]')!
      .click(),
  )
  expect(host.querySelector('.note-list-preview')).toBeNull()
})

it('restores an offscreen virtual list and its focusable note after Android Back', async () => {
  const notes = Array.from({ length: 1000 }, (_, index) => ({
    ...makeNote(`Large ${String(index).padStart(5, '0')}`, 'parent'),
    updated: 1000 - index,
  }))
  await act(async () => library.setNotes(notes))
  const pane = document.querySelector<HTMLElement>('.mobile-list')!
  const offset = 500 * 57
  await act(async () => {
    pane.scrollTop = offset
    pane.dispatchEvent(new Event('scroll'))
  })
  expect(pane.querySelectorAll('.mobile-note-row').length).toBeLessThan(50)
  await click('Large 00500')
  expect(document.querySelector('.mobile-note-scroll')).toBeTruthy()
  await androidBack()
  const restored = document.querySelector<HTMLElement>('.mobile-list')!
  expect(restored.scrollTop).toBe(offset)
  expect(restored.querySelectorAll('.mobile-note-row').length).toBeLessThan(50)
  expect(document.querySelector('[aria-label="Large 00500"]')).toBeTruthy()
})

it('takes color mode from the document root and mirrors the desktop sidebar in the drawer', async () => {
  const appearance = library.getSnapshot().appearance
  expect(document.documentElement.dataset.palette).toBeUndefined()
  expect(document.documentElement.dataset.theme).toMatch(/^(light|dark)$/)
  expect(document.querySelector('.mobile-app')!.hasAttribute('data-theme')).toBe(false)
  await click('Open navigation')
  const drawer = document.querySelector<HTMLElement>('.mobile-drawer')!
  expect(drawer.hasAttribute('data-theme')).toBe(false)
  expect(drawer.querySelector('[aria-current="page"]')?.textContent).toBe('All notes2')
  expect(drawer.querySelector('nav[aria-label="Trash"]')?.textContent).toBe('Trash')
  await act(async () => library.setAppearance({ ...appearance, sidebarCounts: false }))
  expect(drawer.querySelector('[aria-current="page"]')?.textContent).toBe('All notes')
  expect(drawer.querySelector('.mobile-book-label .count')?.textContent).toBe('')
  await act(async () => library.setAppearance(appearance))
})

it('closes the table of contents from its own header', async () => {
  await click('Direct note')
  await click('Note actions')
  await click('Table of contents')
  expect(document.querySelector('.note-outline')?.getAttribute('data-mode')).toBe('overlay')
  await click('Close table of contents')
  await androidBack()
  expect(document.querySelector('.mobile-list')).toBeTruthy()
})

const page = () => document.querySelector('.mobile-app')!
const taskRow = (title: string) =>
  [...document.querySelectorAll<HTMLElement>('.mobile-task-row')].find((row) =>
    row.textContent?.includes(title),
  )!
const storedTask = (title: string) =>
  projectStore.getSnapshot().tasks.find((t) => t.title === title && t.deletedAt === null)!
async function drawerProject(name: string) {
  await click('Open navigation')
  const nav = document.querySelector('nav[aria-label="Projects"]')!
  const row = [...nav.querySelectorAll('button')].find((b) => b.textContent?.startsWith(name))!
  expect(row, name).toBeTruthy()
  await act(async () => row.click())
}
async function openTaskRow(title: string) {
  await act(async () => taskRow(title).querySelector<HTMLElement>('.mobile-task-label')!.click())
}
async function openProp(key: string) {
  const row = [...document.querySelectorAll<HTMLElement>('.mobile-task-props button')].find(
    (b) => b.querySelector('.mobile-prop-key')?.textContent === key,
  )!
  await act(async () => row.click())
}
async function setText(el: HTMLTextAreaElement | HTMLInputElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto.prototype, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

it('seeds the project stack from the drawer so Back walks to the project list', () => {
  const list = mobileNavigation(initialNavigation(), { type: 'projects' })
  expect(list.routes.map((r) => r.kind)).toEqual(['projects'])
  const seeded = mobileNavigation(list, { type: 'projects', project: 'p1' })
  expect(seeded.routes).toEqual([{ kind: 'projects', scroll: 0 }, projectRoute('p1')])
  const task = mobileNavigation(seeded, {
    type: 'push',
    route: { kind: 'task', id: 't1', scroll: 0 },
  })
  expect(mobileNavigation(mobileNavigation(task, { type: 'back' }), { type: 'back' })).toEqual(list)
  expect(mobileNavigation(list, { type: 'back' })).toBe(list)
  expect(mobileNavigation(task, { type: 'library', view: 'all' }).routes).toHaveLength(1)
})

it('opens the project store and waits for task saves when the library flushes', async () => {
  expect(projectStore.getSnapshot().ready).toBe(true)
  const register = vi.spyOn(library, 'registerFlush')
  await act(async () => root.render(<MobileApp key="again" />))
  expect(register).toHaveBeenCalledWith(projectStore.flush)
})

it('walks drawer, project, task and back with Android Back', async () => {
  await click('Open navigation')
  await click('All projects')
  expect(document.querySelector('.mobile-header h1')?.textContent).toBe('Projects')
  expect(page().textContent).toContain('Website relaunch')
  await click('Open navigation')
  const nav = document.querySelector('nav[aria-label="Projects"]')!
  expect(nav.textContent).toContain('Inbox')
  expect(nav.textContent).toContain('Garden redesign')
  await act(async () => document.querySelector<HTMLElement>('.mobile-scrim')?.click())
  await androidBack()
  await drawerProject('Website relaunch')
  expect(document.querySelector('.mobile-project-head h1')?.textContent).toBe('Website relaunch')
  expect(document.querySelector('[aria-label="Open navigation"]')).toBeTruthy()
  await openTaskRow('Write homepage copy')
  expect(document.querySelector<HTMLTextAreaElement>('[aria-label="Task title"]')?.value).toBe(
    'Write homepage copy',
  )
  expect(document.querySelector('.mobile-header-context')?.textContent).toBe('Website relaunch')
  await click('Task actions')
  expect(document.querySelector('.mobile-sheet')).toBeTruthy()
  await androidBack()
  expect(document.querySelector('.mobile-sheet')).toBeNull()
  expect(document.querySelector('[aria-label="Task title"]')).toBeTruthy()
  await androidBack()
  expect(document.querySelector('.mobile-project-head h1')?.textContent).toBe('Website relaunch')
  await androidBack()
  expect(document.querySelector('.mobile-header h1')?.textContent).toBe('Projects')
  vi.mocked(tauriCore.invoke).mockClear()
  await androidBack()
  expect(tauriCore.invoke).toHaveBeenCalledWith('mobile_background')
})

it('creates, edits, completes and deletes a task, with undo', async () => {
  await drawerProject('Inbox')
  const field = document.querySelector<HTMLInputElement>('input[aria-label="New task"]')!
  await setText(field, 'Water the ferns')
  await act(async () =>
    field.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  )
  expect(field.value).toBe('')
  expect(taskRow('Water the ferns')).toBeTruthy()

  await openTaskRow('Water the ferns')
  // Android Back can leave a focused field without a blur; the edit must still save.
  await setText(
    document.querySelector<HTMLTextAreaElement>('[aria-label="Task title"]')!,
    'Water the big ferns',
  )
  await androidBack()
  expect(storedTask('Water the big ferns')).toBeTruthy()

  await openTaskRow('Water the big ferns')
  await openProp('Status')
  await click('Doing')
  expect(storedTask('Water the big ferns').status).toBe('doing')
  await openProp('Priority')
  await click('High')
  expect(storedTask('Water the big ferns').priority).toBe(3)
  await androidBack()

  await act(async () =>
    taskRow('Water the big ferns').querySelector<HTMLElement>('[role="checkbox"]')!.click(),
  )
  expect(storedTask('Water the big ferns').status).toBe('done')
  // Done is collapsed by default.
  expect(document.querySelector('section[aria-label="Done"]')?.textContent).not.toContain('ferns')
  await act(async () =>
    document.querySelector<HTMLElement>('section[aria-label="Done"] button')!.click(),
  )
  await act(async () =>
    taskRow('Water the big ferns')
      .querySelector<HTMLElement>('[aria-label="Actions for Water the big ferns"]')!
      .click(),
  )
  await click('Delete task')
  expect(storedTask('Water the big ferns')).toBeUndefined()
  await click('Undo')
  expect(storedTask('Water the big ferns')).toBeTruthy()
})

it('leaves a deleted task page, and creates and deletes projects', async () => {
  await click('Open navigation')
  await click('New project')
  await setText(document.querySelector<HTMLInputElement>('#project-name')!, 'Move house')
  await click('Create project')
  expect(document.querySelector('.mobile-project-head h1')?.textContent).toBe('Move house')
  const field = document.querySelector<HTMLInputElement>('input[aria-label="New task"]')!
  await setText(field, 'Pack books')
  await act(async () =>
    field.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  )
  await openTaskRow('Pack books')
  await click('Task actions')
  await click('Delete task')
  expect(document.querySelector('.mobile-project-head h1')?.textContent).toBe('Move house')
  await click('Project actions')
  await click('Delete project')
  await act(async () =>
    document
      .querySelector('.dialog form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  )
  expect(document.querySelector('.mobile-header h1')?.textContent).toBe('Projects')
  expect(document.querySelector('.mobile-project-scroll')?.textContent).not.toContain('Move house')
  expect(document.querySelector('.notice')?.textContent).toContain('Deleted “Move house”')
})

it('renders, toggles and opens task mentions in the mobile editor', async () => {
  const task = storedTask('Book the dentist')
  const note = makeNote('Mention note', 'parent')
  note.content = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'taskReference', attrs: { taskId: task.id, fallbackTitle: 'Old title' } },
        ],
      },
    ],
  }
  await act(async () => library.setNotes([note]))
  await click('Mention note')
  const chip = document.querySelector<HTMLElement>('.task-ref')!
  expect(chip.querySelector('.task-ref-title')?.textContent).toBe('Book the dentist')
  const before = library.getSnapshot().notes[0].updated
  await act(async () => chip.querySelector<HTMLElement>('[role="checkbox"]')!.click())
  expect(storedTask('Book the dentist').status).toBe('done')
  expect(chip.dataset.status).toBe('done')
  expect(library.getSnapshot().notes[0].updated).toBe(before)
  await act(async () => chip.querySelector<HTMLElement>('[role="checkbox"]')!.click())
  expect(storedTask('Book the dentist').status).toBe('todo')
  await act(async () => chip.querySelector<HTMLElement>('.task-ref-title')!.click())
  expect(document.querySelector<HTMLTextAreaElement>('[aria-label="Task title"]')?.value).toBe(
    'Book the dentist',
  )
  await androidBack()
  expect(document.querySelector('.task-ref')).toBeTruthy()
})
