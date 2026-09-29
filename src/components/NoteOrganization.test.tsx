// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import NoteOrganization from './NoteOrganization'
import { defaultAppearance } from '../storage/library'
import type { Note, Notebook } from '../model'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

it('keeps linked-file move rules and requires confirmation in the compact picker', async () => {
  const note: Note = {
    id: 'file',
    title: 'Linked note',
    notebookIds: ['folder-a', 'personal'],
    source: { rootId: 'root', relativePath: 'note.md', fingerprint: '' },
    content: { type: 'doc' },
    text: '',
    tags: [],
    pinned: false,
    trashed: false,
    quickAccess: false,
    updated: 1,
  }
  const notebooks: Notebook[] = [
    { id: 'personal', name: 'Personal', color: '', icon: 'notebook' },
    { id: 'folder-a', name: 'Folder A', rootId: 'root', color: '', icon: 'notebook' },
    { id: 'folder-b', name: 'Folder B', rootId: 'root', color: '', icon: 'notebook' },
  ]
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const update = vi.fn(),
    close = vi.fn()
  const render = async (disabled: boolean) => {
    await act(async () =>
      root.render(
        <NoteOrganization
          note={note}
          notes={[note]}
          notebooks={notebooks}
          appearance={defaultAppearance}
          anchor={{ left: 0, top: 0, width: 20, height: 20 }}
          launcher={null}
          update={update}
          close={close}
          disabled={disabled}
        />,
      ),
    )
  }
  try {
    await render(false)
    expect(document.querySelector('.move-notebooks-popover')).toBeTruthy()
    expect(document.querySelector('.dialog-overlay')).toBeNull()
    expect([...document.querySelectorAll('label')].map((el) => el.textContent?.trim())).toEqual([
      'Folder A 1',
      'Folder B 0',
    ])
    const move = [...document.querySelectorAll('button')].find((el) => el.textContent === 'Move')!
    expect(move.disabled).toBe(true)
    const destination = [...document.querySelectorAll('label')]
      .find((el) => el.textContent?.includes('Folder B'))!
      .querySelector('input')!
    await act(async () => destination.click())
    expect(update).not.toHaveBeenCalled()
    await render(true)
    expect(move.disabled).toBe(true)
    await render(false)
    await act(async () => move.click())
    expect(update).toHaveBeenCalledWith({ notebookIds: ['personal', 'folder-b'] })
    expect(close).toHaveBeenCalledOnce()
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
