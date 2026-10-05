import { expect, it } from 'vitest'
import {
  activeTab,
  captureLocation,
  closeTab,
  currentLocation,
  historyIndex,
  keepTabOpen,
  moveHistory,
  openNote,
  previewNote,
  pruneWorkspace,
  restoreWorkspace,
  restoreSidebarView,
  workspacePreferences,
  type NoteLocation,
} from './workspace'
import type { Note } from './model'
const notes = ['a', 'b', 'c', 'd'].map((id) => ({ id, trashed: false })) as Note[]
const location = (noteId: string): NoteLocation => ({ noteId, view: 'all', query: '', scroll: 0 })
it('falls back to All notes for missing, invalid, or unavailable saved sidebar views', () => {
  for (const saved of [undefined, null, 42, {}, 'unknown', 'book:missing', 'tag:missing'])
    expect(restoreSidebarView(saved, [], [])).toBe('all')
  expect(
    restoreSidebarView('tag:project', [], [{ ...notes[0], tags: ['project'], trashed: true }]),
  ).toBe('all')
})
it('reuses a tab, branches history, restores contexts, and keeps separate tab histories', () => {
  let state = restoreWorkspace(null, notes)
  const first = state.activeTabId!
  state = captureLocation(state, { view: 'book:work', query: 'apple', scroll: 123 })
  state = openNote(state, location('b'))
  state = moveHistory(state, -1, notes)
  expect(currentLocation(activeTab(state)!)).toEqual({
    noteId: 'a',
    view: 'book:work',
    query: 'apple',
    scroll: 123,
  })
  state = openNote(state, location('c'))
  expect(historyIndex(activeTab(state), 1, notes)).toBeUndefined()
  state = openNote(state, location('d'), true)
  expect(state.tabs).toHaveLength(2)
  expect(activeTab(state)?.entries).toHaveLength(1)
  state = openNote(state, location('c'), true)
  expect(state.activeTabId).toBe(first)
  expect(state.tabs).toHaveLength(2)
})
it('closes to the right then left and preserves an intentionally empty restart', () => {
  let state = restoreWorkspace(null, notes)
  state = openNote(state, location('b'), true)
  state = openNote(state, location('c'), true)
  const [a, b, c] = state.tabs
  state.activeTabId = b.id
  state = closeTab(state, b.id)
  expect(state.activeTabId).toBe(c.id)
  state = closeTab(state, c.id)
  expect(state.activeTabId).toBe(a.id)
  state = closeTab(state, a.id)
  expect(restoreWorkspace(workspacePreferences(state), notes).tabs).toEqual([])
})
it('restores order and active tab and drops unavailable references', () => {
  const saved = {
    tabs: [
      { id: 't1', noteId: 'c' },
      { id: 't2', noteId: 'missing' },
      { id: 't3', noteId: 'b' },
    ],
    activeTabId: 't3',
  }
  expect(workspacePreferences(restoreWorkspace(saved, notes))).toEqual({
    tabs: [saved.tabs[0], saved.tabs[2]],
    activeTabId: 't3',
  })
})
it('skips trashed history, removes normal trashed tabs, and allows Trash tabs', () => {
  let state = restoreWorkspace(null, notes)
  state = openNote(state, location('b'))
  state = openNote(state, location('c'))
  const changed = notes.map((n) => ({ ...n, trashed: n.id === 'b' }))
  state = moveHistory(state, -1, changed)
  expect(currentLocation(activeTab(state)!).noteId).toBe('a')
  state = openNote(state, location('b'), true)
  state = pruneWorkspace(state, changed)
  expect(state.tabs).toHaveLength(1)
  state = openNote(state, { ...location('b'), view: 'trash' }, true)
  expect(pruneWorkspace(state, changed).tabs).toHaveLength(2)
  expect(restoreWorkspace(workspacePreferences(state), changed).tabs).toHaveLength(1)
})
it('uses one preview slot while preserving permanent tabs and preview history', () => {
  let state = restoreWorkspace(null, notes)
  const permanentId = state.activeTabId
  state = previewNote(state, location('b'))
  const previewId = state.activeTabId
  expect(state.tabs).toHaveLength(2)
  expect(state.tabs.find((tab) => tab.id === previewId)?.preview).toBe(true)
  state = previewNote(state, location('c'))
  expect(state.activeTabId).toBe(previewId)
  expect(state.tabs).toHaveLength(2)
  expect(
    state.tabs.find((tab) => tab.id === previewId)?.entries.map((entry) => entry.noteId),
  ).toEqual(['b', 'c'])
  state = moveHistory(state, -1, notes)
  expect(currentLocation(activeTab(state)!).noteId).toBe('b')
  expect(activeTab(state)?.preview).toBe(true)
  state = previewNote(state, location('a'))
  expect(state.activeTabId).toBe(permanentId)
  expect(state.tabs.find((tab) => tab.id === previewId)?.preview).toBe(true)
})
it('promotes a preview on edit or explicit open and restores saved status', () => {
  let state = previewNote(restoreWorkspace(null, notes), location('b'))
  const previewId = state.activeTabId!
  const saved = workspacePreferences(state)
  expect(saved.tabs[1]).toEqual({ id: previewId, noteId: 'b', preview: true })
  expect(restoreWorkspace(saved, notes).tabs[1].preview).toBe(true)
  state = keepTabOpen(state, previewId)
  expect(state.tabs[1].preview).toBeUndefined()
  expect(workspacePreferences(state).tabs[1]).toEqual({ id: previewId, noteId: 'b' })
  state = previewNote(state, location('c'))
  expect(state.tabs).toHaveLength(3)
  state = openNote(state, location('c'), true)
  expect(state.tabs[2].preview).toBeUndefined()
  expect(state.tabs).toHaveLength(3)
  expect(
    restoreWorkspace({ tabs: [{ id: 'old', noteId: 'a' }], activeTabId: 'old' }, notes).tabs[0]
      .preview,
  ).toBeUndefined()
})
