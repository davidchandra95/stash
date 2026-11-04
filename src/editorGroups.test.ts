import { expect, it } from 'vitest'
import { tabDropTarget, type GroupArea } from './app/tabDropTarget'
import {
  groupsPreferences,
  moveTabToGroup,
  normalizeGroups,
  pruneGroups,
  restoreGroups,
  splitTab,
  splitVisible,
  type WorkspaceGroups,
  type WorkspaceTab,
} from './workspace'

const noteTab = (id: string, noteId = id): WorkspaceTab => ({
  id,
  entries: [{ noteId, view: 'all', query: '', scroll: 0 }],
  index: 0,
})
const pdfTab = (id: string): WorkspaceTab => ({
  id,
  entries: [{ kind: 'pdf', documentId: id }],
  index: 0,
})
const one = (...tabs: WorkspaceTab[]): WorkspaceGroups => ({
  main: { tabs, activeTabId: tabs[0]?.id ?? null },
  split: null,
  splitSide: 'right',
  ratio: 0.5,
  focused: 'main',
})
const notes = ['a', 'b', 'c'].map((id) => ({
  id,
  trashed: false,
  tags: [],
  pinned: false,
  updated: 0,
}))

it('splits a note tab into a copy on either side and leaves the original', () => {
  const right = splitTab(one(noteTab('a')), 'a')
  expect(right.main.tabs.map((tab) => tab.id)).toEqual(['a'])
  expect(right.split!.tabs[0].entries[0].noteId).toBe('a')
  expect(right.split!.tabs[0].id).not.toBe('a')
  expect(right).toMatchObject({ splitSide: 'right', focused: 'split' })
  expect(splitTab(one(noteTab('a')), 'a', 'left').splitSide).toBe('left')
})

it('never splits a PDF tab, and hides the split while the main group shows one', () => {
  const groups = one(pdfTab('p'), noteTab('a'))
  expect(splitTab(groups, 'p')).toBe(groups)
  expect(moveTabToGroup(groups, 'p', { side: 'right' })).toBe(groups)
  const split = splitTab({ ...groups, main: { ...groups.main, activeTabId: 'a' } }, 'a')
  expect(splitVisible(split)).toBe(true)
  const showingPdf = normalizeGroups({ ...split, main: { ...split.main, activeTabId: 'p' } })
  expect(splitVisible(showingPdf)).toBe(false)
  expect(showingPdf.focused).toBe('main')
})

it('copies into the other group, selecting a tab already on that note', () => {
  const split = splitTab(one(noteTab('a'), noteTab('b')), 'a')
  const again = splitTab(split, 'b')
  expect(again.split!.tabs.map((tab) => tab.entries[0].noteId)).toEqual(['a', 'b'])
  const selected = splitTab({ ...again, focused: 'main' }, 'a')
  expect(selected.split!.tabs).toHaveLength(2)
  expect(selected.split!.activeTabId).toBe(split.split!.tabs[0].id)
})

it('moves a dragged tab into a new split, but copies a group’s only tab', () => {
  const moved = moveTabToGroup(one(noteTab('a'), noteTab('b')), 'b', { side: 'left' })
  expect(moved.main.tabs.map((tab) => tab.id)).toEqual(['a'])
  expect(moved.split!.tabs.map((tab) => tab.id)).toEqual(['b'])
  expect(moved.splitSide).toBe('left')
  const copied = moveTabToGroup(one(noteTab('a')), 'a', { side: 'right' })
  expect(copied.main.tabs.map((tab) => tab.id)).toEqual(['a'])
  expect(copied.split!.tabs).toHaveLength(1)
})

it('closes a group that loses its last tab', () => {
  const moved = moveTabToGroup(one(noteTab('a'), noteTab('b')), 'b')
  const back = moveTabToGroup(moved, 'b', { index: 0 })
  expect(back.split).toBeNull()
  expect(back.main.tabs.map((tab) => tab.id)).toEqual(['b', 'a'])
  expect(back.focused).toBe('main')
  const promoted = moveTabToGroup(moved, 'a')
  expect(promoted.split).toBeNull()
  expect(promoted.main.tabs.map((tab) => tab.id).sort()).toEqual(['a', 'b'])
})

it('prunes both groups and promotes the split when the main group empties', () => {
  const moved = moveTabToGroup(one(noteTab('a'), noteTab('b')), 'b')
  const left = notes.filter((note) => note.id !== 'a')
  const pruned = pruneGroups(moved, left)
  expect(pruned.split).toBeNull()
  expect(pruned.main.tabs.map((tab) => tab.id)).toEqual(['b'])
  expect(pruneGroups(moved, notes)).toBe(moved)
})

it('restores the split, dropping PDF tabs from it and clamping the ratio', () => {
  const moved = { ...moveTabToGroup(one(noteTab('a'), noteTab('b')), 'b', { side: 'left' }), ratio: 0.3 }
  const saved = groupsPreferences(moved)
  const restored = restoreGroups(saved, notes)
  expect(restored).toMatchObject({ splitSide: 'left', ratio: 0.3, focused: 'split' })
  expect(restored.split!.tabs.map((tab) => tab.id)).toEqual(['b'])
  expect(groupsPreferences(one(noteTab('a'))).split).toBeUndefined()
  const odd = restoreGroups(
    {
      ...saved,
      split: {
        ...saved.split!,
        ratio: 40,
        tabs: [{ id: 'p', kind: 'pdf', documentId: 'p' }],
        activeTabId: 'p',
      },
    },
    notes,
    [{ id: 'p' }],
  )
  expect(odd.split).toBeNull()
})

const area = (group: 'main' | 'split', left: number, right: number): GroupArea => ({
  group,
  left,
  right,
  top: 0,
  bottom: 600,
  documentTop: 42,
})

it('finds drop targets by the document’s edges and the other group', () => {
  const single = [area('main', 0, 1000)]
  expect(tabDropTarget(900, 300, 'main', single)).toEqual({ group: 'main', side: 'right' })
  expect(tabDropTarget(100, 300, 'main', single)).toEqual({ group: 'main', side: 'left' })
  expect(tabDropTarget(500, 300, 'main', single)).toBeNull()
  expect(tabDropTarget(900, 20, 'main', single)).toBeNull()
  expect(tabDropTarget(1200, 300, 'main', single)).toBeNull()
  const both = [area('main', 0, 500), area('split', 500, 1000)]
  expect(tabDropTarget(100, 300, 'main', both)).toBeNull()
  expect(tabDropTarget(700, 300, 'main', both)).toEqual({ group: 'split', inStrip: false })
  expect(tabDropTarget(700, 20, 'main', both)).toEqual({ group: 'split', inStrip: true })
})
