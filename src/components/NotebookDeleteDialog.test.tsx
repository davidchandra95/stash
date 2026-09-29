// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import NotebookDeleteDialog from './NotebookDeleteDialog'
import { defaultAppearance } from '../storage/library'
import type { Note, Notebook } from '../model'

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

const note: Note = {
  id: 'note',
  title: 'Note',
  notebookIds: ['work'],
  quickAccess: false,
  tags: [],
  content: { type: 'doc', content: [{ type: 'paragraph' }] },
  text: '',
  pinned: false,
  trashed: false,
  updated: 1,
}

const parent: Notebook = {
  id: 'work',
  name: 'Work',
  color: '#899ab4',
  icon: 'briefcase',
}

async function mount(notebooks: Notebook[], onConfirm = vi.fn()) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () =>
    root!.render(
      <NotebookDeleteDialog
        open
        notebook={parent}
        notebooks={notebooks}
        notes={[note]}
        appearance={{ ...defaultAppearance, dark: false, theme: 'classic' }}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    ),
  )
  return onConfirm
}

it('defaults to promoting children and keeping notes, and protects linked descendants', async () => {
  await mount([
    parent,
    {
      id: 'linked',
      name: 'Linked',
      color: '#82936f',
      icon: 'folder',
      parentId: 'work',
      rootId: 'linked',
    },
  ])
  const scope = [
    ...document.querySelectorAll<HTMLInputElement>('input[name="notebook-delete-scope"]'),
  ]
  const notes = [
    ...document.querySelectorAll<HTMLInputElement>('input[name="notebook-delete-notes"]'),
  ]
  expect(scope[0].checked).toBe(true)
  expect(scope[1].disabled).toBe(true)
  expect(notes[0].checked).toBe(true)
  expect(document.body.textContent).toContain('linked to a folder on disk')
})

it('sends the requested subtree and Trash choices', async () => {
  const onConfirm = await mount([
    parent,
    { id: 'child', name: 'Child', color: '#82936f', icon: 'notebook', parentId: 'work' },
  ])
  const scope = [
    ...document.querySelectorAll<HTMLInputElement>('input[name="notebook-delete-scope"]'),
  ]
  const notes = [
    ...document.querySelectorAll<HTMLInputElement>('input[name="notebook-delete-notes"]'),
  ]
  await act(async () => {
    scope[1].click()
    notes[1].click()
    document.querySelector<HTMLButtonElement>('button[type="submit"]')!.click()
  })
  expect(onConfirm).toHaveBeenCalledWith({ includeChildren: true, deleteNotes: true })
})
