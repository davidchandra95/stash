import { expect, it } from 'vitest'
import type { Note } from './model'
import {
  restoreWorkspace,
  workspacePreferences,
  setTabPinned,
  reorderTab,
  openNote,
  previewNote,
  closeTab,
  pruneWorkspace,
} from './workspace'
const notes = ['a', 'b', 'c'].map((id) => ({ id, trashed: false })) as Note[]
const initial = () =>
  restoreWorkspace(
    {
      activeTabId: 'a',
      tabs: [
        { id: 'a', noteId: 'a' },
        { id: 'b', noteId: 'b', preview: true },
        { id: 'pdf', kind: 'pdf', documentId: 'pdf' },
      ],
    },
    notes,
    [{ id: 'pdf' }],
  )
it('groups pins, promotes previews, preserves selection/history and unpins at the boundary', () => {
  const state = initial()
  let next = setTabPinned(state, 'b', true)
  expect(next.tabs.map((t) => t.id)).toEqual(['b', 'a', 'pdf'])
  expect(next.tabs[0].preview).toBeUndefined()
  expect(next.tabs[0].entries).toBe(state.tabs[1].entries)
  expect(next.activeTabId).toBe('a')
  next = setTabPinned(next, 'pdf', true)
  expect(next.tabs.map((t) => t.id)).toEqual(['b', 'pdf', 'a'])
  expect(reorderTab(next, 'b', 2).tabs.map((t) => t.id)).toEqual(['pdf', 'b', 'a'])
  expect(reorderTab(next, 'a', 0)).toBe(next)
  next = setTabPinned(next, 'b', false)
  expect(next.tabs.map((t) => t.id)).toEqual(['pdf', 'b', 'a'])
  expect(next.tabs[1].preview).toBeUndefined()
  expect(setTabPinned(next, 'missing', true)).toBe(next)
})
it('restores note and PDF pins, normalizes conflicting preview state and supports old preferences', () => {
  const state = setTabPinned(setTabPinned(initial(), 'a', true), 'pdf', true)
  const saved = workspacePreferences(state)
  expect(restoreWorkspace(saved, notes, [{ id: 'pdf' }])).toEqual(state)
  expect(
    restoreWorkspace(
      { tabs: [{ id: 'a', noteId: 'a', pinned: true, preview: true }], activeTabId: 'a' },
      notes,
    ).tabs[0],
  ).toMatchObject({ pinned: true })
  expect(
    restoreWorkspace(
      { tabs: [{ id: 'a', noteId: 'a', pinned: true, preview: true }], activeTabId: 'a' },
      notes,
    ).tabs[0].preview,
  ).toBeUndefined()
  expect(initial().tabs.every((t) => !t.pinned)).toBe(true)
})
it('keeps pinned documents during navigation but permits explicit closing and unavailable-document pruning', () => {
  const state = setTabPinned(initial(), 'a', true)
  const location = { noteId: 'c', view: 'all' as const, query: '', scroll: 0 }
  for (const next of [openNote(state, location), previewNote(state, location)])
    expect(next.tabs.find((t) => t.id === 'a')).toEqual(state.tabs[0])
  expect(closeTab(state, 'a').tabs.some((t) => t.id === 'a')).toBe(false)
  expect(
    pruneWorkspace(state, notes.slice(1), [{ id: 'pdf' }]).tabs.some((t) => t.id === 'a'),
  ).toBe(false)
})
