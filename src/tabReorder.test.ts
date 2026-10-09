import { expect, it } from 'vitest'
import { reorderTab, workspacePreferences, restoreWorkspace, type Workspace } from './workspace'

const state: Workspace = {
  activeTabId: 'b',
  tabs: [
    {
      id: 'a',
      entries: [{ noteId: 'one', view: 'all', query: 'find', scroll: 42 }],
      index: 0,
      preview: true,
    },
    { id: 'b', entries: [{ kind: 'pdf', documentId: 'pdf' }], index: 0 },
    { id: 'c', entries: [{ noteId: 'two', view: 'all', query: '', scroll: 90 }], index: 0 },
  ],
}
it('moves mixed tabs, preserves histories and selection, and promotes only the moved preview', () => {
  const moved = reorderTab(state, 'a', 2)
  expect(moved.tabs.map((t) => t.id)).toEqual(['b', 'c', 'a'])
  expect(moved.activeTabId).toBe('b')
  expect(moved.tabs[2].preview).toBeUndefined()
  expect(moved.tabs[2].entries).toBe(state.tabs[0].entries)
  expect(moved.tabs[0]).toBe(state.tabs[1])
  expect(reorderTab(state, 'c', 0).tabs.map((t) => t.id)).toEqual(['c', 'a', 'b'])
  expect(reorderTab(state, 'b', 2).tabs[0].preview).toBe(true)
  const saved = workspacePreferences(moved)
  const restored = restoreWorkspace(saved, [{ id: 'one' }, { id: 'two' }] as never, [{ id: 'pdf' }])
  expect(restored.tabs.map((t) => t.id)).toEqual(['b', 'c', 'a'])
  expect(restored.activeTabId).toBe('b')
})
it('ignores unchanged, missing, and invalid moves without promoting previews', () => {
  for (const [id, index] of [
    ['a', 0],
    ['missing', 1],
    ['a', -1],
    ['a', 3],
    ['a', 1.5],
  ] as const) {
    expect(reorderTab(state, id, index)).toBe(state)
  }
})
