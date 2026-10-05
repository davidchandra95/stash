// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { useContentSearch } from './useContentSearch'
import type { Note } from './model'
import type { ReadSearchNote } from './search'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const notes: Note[] = Array.from({ length: 7 }, (_, i) => ({
  id: String(i),
  title: String(i),
  text: 'fix',
  updated: 1,
  notebookIds: [],
  tags: [],
  pinned: false,
  trashed: false,
  quickAccess: false,
  content: {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'fix' }] }],
  },
}))
it('bounds document reads across changes, rejects stale completions, reports failures, and reuses cached documents', async () => {
  const host = document.createElement('div'),
    root = createRoot(host)
  document.body.append(host)
  const pending: (() => void)[] = []
  let running = 0,
    maxRunning = 0
  const readNote: ReadSearchNote = vi.fn((id: string) => {
    running++
    maxRunning = Math.max(maxRunning, running)
    return new Promise<Note>((resolve, reject) =>
      pending.push(() => {
        running--
        if (id === '6') reject(Error('Unreadable'))
        else resolve(notes.find((note) => note.id === id)!)
      }),
    )
  })
  function Harness({ open, current }: { open: boolean; current: Note[] }) {
    const result = useContentSearch(open, current, readNote)
    return (
      <output>
        {JSON.stringify({
          ids: result.documents.map(({ note }) => note.id),
          loading: result.loading,
          failures: result.failures,
        })}
      </output>
    )
  }
  const render = async (open: boolean, current: Note[]) =>
    act(async () => root.render(<Harness open={open} current={current} />))
  const finish = async () => {
    while (pending.length)
      await act(async () => {
        pending.splice(0).forEach((resolve) => resolve())
      })
  }
  try {
    await render(true, notes)
    expect(running).toBe(3)
    const current = notes.slice(3)
    await render(true, current)
    expect(running).toBe(3)
    await finish()
    expect(maxRunning).toBe(3)
    const state = JSON.parse(host.textContent!)
    expect(state.ids.sort()).toEqual(['3', '4', '5'])
    expect(state.failures).toEqual(['6: Error: Unreadable'])
    expect(state.loading).toBe(false)
    const before = vi.mocked(readNote).mock.calls.length
    await render(false, current)
    await render(true, current)
    await finish()
    expect(vi.mocked(readNote).mock.calls.length - before).toBe(1)
    await render(true, notes)
    await render(false, notes)
    await finish()
    expect(JSON.parse(host.textContent!).ids).toEqual([])
  } finally {
    await act(() => root.unmount())
    host.remove()
  }
})
