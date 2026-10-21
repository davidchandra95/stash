// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { library } from './useLibrary'
import { LiveNoteRow, useNoteIds } from './libraryReaders'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
it('refreshes mounted Today readers at midnight and after the window resumes', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 9, 9, 23, 59, 59))
  const original = library.getSnapshot()
  const publish = (patch: object) =>
    (library as unknown as { publish: (patch: object) => void }).publish(patch)
  publish({
    notes: [
      {
        id: 'today',
        title: 'Today',
        updated: Date.now(),
        text: '',
        notebookIds: [],
        tags: [],
        pinned: false,
        trashed: false,
        quickAccess: false,
        content: { type: 'doc', content: [{ type: 'paragraph' }] },
      },
    ],
  })
  const host = document.createElement('div')
  const root = createRoot(host)
  function Reader() {
    return <output>{useNoteIds('today', '').join(',')}</output>
  }
  try {
    await act(async () => root.render(<Reader />))
    expect(host.textContent).toBe('today')
    await act(async () => vi.advanceTimersByTime(1100))
    expect(host.textContent).toBe('')
    vi.setSystemTime(new Date(2026, 9, 9, 23, 59, 59))
    await act(async () => window.dispatchEvent(new Event('focus')))
    expect(host.textContent).toBe('today')
  } finally {
    await act(async () => root.unmount())
    Object.assign(library as unknown as { state: typeof original }, { state: original })
    vi.useRealTimers()
  }
})

it('keeps a compact row quiet when only milliseconds change inside the displayed minute', async () => {
  const original = library.getSnapshot()
  // Rows show the time of day only for notes edited today (Finder-style list dates).
  const noon = new Date()
  noon.setHours(12, 0, 0, 0)
  const note = {
    id: 'row',
    title: 'Row',
    updated: noon.getTime(),
    text: 'Body',
    notebookIds: [],
    tags: [],
    pinned: false,
    trashed: false,
    quickAccess: false,
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
  }
  const publish = (patch: object) =>
    (library as unknown as { publish: (patch: object) => void }).publish(patch)
  publish({ notes: [note] })
  const host = document.createElement('div')
  const root = createRoot(host)
  let renders = 0
  try {
    await act(async () =>
      root.render(
        <LiveNoteRow noteId="row" preview={false}>
          {(row) => {
            renders++
            return <output>{row.date}</output>
          }}
        </LiveNoteRow>,
      ),
    )
    expect(renders).toBe(1)
    await act(async () =>
      publish({ notes: [{ ...note, updated: note.updated + 1, text: 'Edited body' }] }),
    )
    expect(renders).toBe(1)
    await act(async () => publish({ notes: [{ ...note, updated: note.updated + 60_000 }] }))
    expect(renders).toBe(2)
    expect(host.textContent).toContain('12:01')
  } finally {
    await act(async () => root.unmount())
    Object.assign(library as unknown as { state: typeof original }, { state: original })
  }
})
