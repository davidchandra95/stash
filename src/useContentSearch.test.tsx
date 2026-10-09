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
    while (pending.length || JSON.parse(host.textContent!).loading)
      await act(async () => {
        pending.splice(0).forEach((resolve) => resolve())
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
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

it('publishes usable documents and failures while another read is still pending', async () => {
  vi.useFakeTimers()
  const host = document.createElement('div'),
    root = createRoot(host)
  const resolve = new Map<string, (note: Note) => void>(),
    reject = new Map<string, (error: Error) => void>()
  const current = notes.slice(0, 4)
  const readNote: ReadSearchNote = (id) =>
    new Promise((yes, no) => {
      resolve.set(id, yes)
      reject.set(id, no)
    })
  let result: ReturnType<typeof useContentSearch>
  function Harness() {
    result = useContentSearch(true, current, readNote)
    return null
  }
  try {
    await act(() => root.render(<Harness />))
    await act(async () => {
      resolve.get('0')!(current[0])
    })
    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
    })
    expect(result!.documents.map(({ note }) => note.id)).toEqual(['0'])
    expect(result!.loading).toBe(true)
    expect(result!.read).toBe(1)
    expect(result!.total).toBe(4)
    await act(async () => {
      reject.get('1')!(Error('Synthetic unreadable'))
      await vi.runOnlyPendingTimersAsync()
    })
    expect(result!.failures).toEqual(['1: Error: Synthetic unreadable'])
    expect(result!.loading).toBe(true)
    await act(async () => {
      resolve.get('2')!(current[2])
      resolve.get('3')!(current[3])
      await vi.runAllTimersAsync()
    })
    expect(result!.loading).toBe(false)
    expect(result!.read).toBe(4)
  } finally {
    await act(() => root.unmount())
    vi.useRealTimers()
  }
})

it('keeps the other read lanes working when the first note is slow', async () => {
  vi.useFakeTimers()
  const host = document.createElement('div'),
    root = createRoot(host)
  const current = Array.from({ length: 10 }, (_, i) => ({ ...notes[0], id: String(i) }))
  let release!: (note: Note) => void
  const readNote = vi.fn(async (id: string) =>
    id === '0'
      ? new Promise<Note>((resolve) => {
          release = resolve
        })
      : current[Number(id)],
  )
  let result: ReturnType<typeof useContentSearch>
  function Harness() {
    result = useContentSearch(true, current, readNote)
    return null
  }
  try {
    await act(() => root.render(<Harness />))
    await act(async () => {
      await vi.runAllTimersAsync()
    })
    expect(readNote).toHaveBeenCalledTimes(10)
    expect(result!.documents).toHaveLength(9)
    expect(result!.loading).toBe(true)
    await act(async () => {
      release(current[0])
      await vi.runAllTimersAsync()
    })
    expect(result!.documents).toHaveLength(10)
    expect(result!.loading).toBe(false)
  } finally {
    await act(() => root.unmount())
    vi.useRealTimers()
  }
})

it('reuses active documents on metadata updates and keeps a bounded cache after closing', async () => {
  vi.useFakeTimers()
  const host = document.createElement('div'),
    root = createRoot(host)
  const current = Array.from({ length: 700 }, (_, i) => ({
    ...notes[0],
    id: `note-${i}`,
    title: String(i),
    content: { ...notes[0].content },
  }))
  let lookup = new Map(current.map((note) => [note.id, note]))
  const readNote = vi.fn(async (id: string) => lookup.get(id)!)
  let result: ReturnType<typeof useContentSearch>
  function Harness({ open, values }: { open: boolean; values: Note[] }) {
    result = useContentSearch(open, values, readNote)
    return null
  }
  const render = async (open: boolean, values: Note[]) => {
    await act(() => root.render(<Harness open={open} values={values} />))
    await act(async () => {
      await vi.runAllTimersAsync()
    })
  }
  try {
    await render(true, current)
    expect(result!.documents).toHaveLength(700)
    expect(readNote).toHaveBeenCalledTimes(700)
    const changed = current.map((note, i) =>
      i === 0 ? { ...note, notebookIds: ['synthetic-book'] } : note,
    )
    lookup = new Map(changed.map((note) => [note.id, note]))
    await render(true, changed)
    expect(readNote).toHaveBeenCalledTimes(700)
    expect(
      result!.documents.find(({ note }) => note.id === current[0].id)?.note.notebookIds,
    ).toEqual(['synthetic-book'])
    await render(false, changed)
    expect(result!.documents).toHaveLength(0)
    await render(true, changed)
    expect(result!.documents).toHaveLength(700)
    expect(readNote.mock.calls.length - 700).toBe(700 - 512)
  } finally {
    await act(() => root.unmount())
    vi.useRealTimers()
  }
})

it('rechecks clean linked documents after reopen even if their summary fingerprint is unchanged', async () => {
  vi.useFakeTimers()
  const host = document.createElement('div'),
    root = createRoot(host)
  const current = [
    {
      ...notes[0],
      source: { rootId: 'synthetic', relativePath: 'fictional.md', fingerprint: 'unchanged' },
    },
  ]
  let text = 'first body'
  const readNote = vi.fn(async () => ({
    ...current[0],
    text,
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
  }))
  let result: ReturnType<typeof useContentSearch>
  function Harness({ open }: { open: boolean }) {
    result = useContentSearch(open, current, readNote)
    return null
  }
  const render = async (open: boolean) => {
    await act(() => root.render(<Harness open={open} />))
    await act(async () => {
      await vi.runAllTimersAsync()
    })
  }
  try {
    await render(true)
    await render(false)
    text = 'changed body'
    await render(true)
    expect(readNote).toHaveBeenCalledTimes(2)
    expect(result!.documents[0].doc.textContent).toBe('changed body')
  } finally {
    await act(() => root.unmount())
    vi.useRealTimers()
  }
})
