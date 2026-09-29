import type { Note, View } from './model'
import type { NoteListPreferences } from './noteOrder'
import type { PaneWidths } from './paneLayout'

export type WorkspacePreferences = {
  noteLists?: Record<string, NoteListPreferences>
  paneWidths?: PaneWidths
  contentsWidth?: number
  tabs: { id: string; noteId: string; preview?: boolean }[]
  activeTabId: string | null
}
export type Location = { noteId: string; view: View; query: string; scroll: number }
export type WorkspaceTab = { id: string; entries: Location[]; index: number; preview?: boolean }
export type Workspace = { tabs: WorkspaceTab[]; activeTabId: string | null }
export const currentLocation = (tab: WorkspaceTab) => tab.entries[tab.index]
export const activeTab = (state: Workspace) => state.tabs.find((t) => t.id === state.activeTabId)
export function restoreWorkspace(saved: WorkspacePreferences | null, notes: Note[]): Workspace {
  const tabs = (
    saved?.tabs ??
    notes
      .filter((n) => !n.trashed)
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated - a.updated)
      .slice(0, 1)
      .map((n) => ({ id: crypto.randomUUID(), noteId: n.id, preview: false }))
  )
    .filter(
      (t, i, all) =>
        notes.some((n) => n.id === t.noteId && !n.trashed) &&
        all.findIndex((other) => other.id === t.id || other.noteId === t.noteId) === i,
    )
    .map((t) => ({
      id: t.id,
      entries: [{ noteId: t.noteId, view: 'all' as View, query: '', scroll: 0 }],
      index: 0,
      ...(t.preview ? { preview: true } : {}),
    }))
  // Only one tab can own the preview slot, including after reading saved preferences.
  const firstPreview = tabs.findIndex((tab) => tab.preview)
  if (firstPreview >= 0) for (let i = firstPreview + 1; i < tabs.length; i++) delete tabs[i].preview
  return {
    tabs,
    activeTabId: tabs.find((t) => t.id === saved?.activeTabId)?.id ?? tabs[0]?.id ?? null,
  }
}
export function workspacePreferences(state: Workspace): WorkspacePreferences {
  return {
    tabs: state.tabs.map((t) => ({
      id: t.id,
      noteId: currentLocation(t).noteId,
      ...(t.preview ? { preview: true } : {}),
    })),
    activeTabId: state.activeTabId,
  }
}
export function captureLocation(state: Workspace, context: Omit<Location, 'noteId'>): Workspace {
  return {
    ...state,
    tabs: state.tabs.map((t) =>
      t.id !== state.activeTabId
        ? t
        : {
            ...t,
            entries: t.entries.map((entry, i) =>
              i === t.index ? { ...entry, ...context } : entry,
            ),
          },
    ),
  }
}
export function openNote(state: Workspace, location: Location, newTab = false): Workspace {
  const existing = state.tabs.find((t) => currentLocation(t).noteId === location.noteId)
  if (existing)
    return {
      ...state,
      activeTabId: existing.id,
      tabs: state.tabs.map((t) => {
        if (t.id !== existing.id) return t
        const { preview: _, ...kept } = t
        const selected = newTab && t.preview ? kept : t
        return t.id === state.activeTabId
          ? {
              ...selected,
              entries: t.entries.map((entry, i) =>
                i === t.index ? { ...entry, view: location.view, query: location.query } : entry,
              ),
            }
          : selected
      }),
    }
  const tab = activeTab(state)
  if (newTab || !tab) {
    const id = crypto.randomUUID()
    return { tabs: [...state.tabs, { id, entries: [location], index: 0 }], activeTabId: id }
  }
  return {
    ...state,
    tabs: state.tabs.map((t) =>
      t.id !== tab.id
        ? t
        : {
            ...t,
            entries: [...t.entries.slice(0, t.index + 1), location],
            index: t.index + 1,
          },
    ),
  }
}
export function previewNote(state: Workspace, location: Location): Workspace {
  const existing = state.tabs.find((tab) => currentLocation(tab).noteId === location.noteId)
  if (existing) return openNote(state, location)
  const preview = state.tabs.find((tab) => tab.preview)
  if (preview) {
    return {
      ...state,
      activeTabId: preview.id,
      tabs: state.tabs.map((tab) =>
        tab.id === preview.id
          ? {
              ...tab,
              entries: [...tab.entries.slice(0, tab.index + 1), location],
              index: tab.index + 1,
            }
          : tab,
      ),
    }
  }
  const id = crypto.randomUUID()
  return {
    tabs: [...state.tabs, { id, entries: [location], index: 0, preview: true }],
    activeTabId: id,
  }
}
export function keepTabOpen(state: Workspace, id: string): Workspace {
  if (!state.tabs.some((tab) => tab.id === id && tab.preview)) return state
  return {
    ...state,
    tabs: state.tabs.map((tab) => {
      if (tab.id !== id) return tab
      const { preview: _, ...kept } = tab
      return kept
    }),
  }
}
export function closeTab(state: Workspace, id: string): Workspace {
  const index = state.tabs.findIndex((t) => t.id === id)
  const tabs = state.tabs.filter((t) => t.id !== id)
  return {
    tabs,
    activeTabId:
      state.activeTabId !== id ? state.activeTabId : ((tabs[index] ?? tabs[index - 1])?.id ?? null),
  }
}
export function historyIndex(
  tab: WorkspaceTab | undefined,
  direction: number,
  notes: Note[],
): number | undefined {
  if (!tab) return undefined
  for (let i = tab.index + direction; i >= 0 && i < tab.entries.length; i += direction) {
    const entry = tab.entries[i]
    if (notes.some((n) => n.id === entry.noteId && (!n.trashed || entry.view === 'trash'))) return i
  }
}
export function moveHistory(state: Workspace, direction: number, notes: Note[]): Workspace {
  const index = historyIndex(activeTab(state), direction, notes)
  return index === undefined
    ? state
    : { ...state, tabs: state.tabs.map((t) => (t.id === state.activeTabId ? { ...t, index } : t)) }
}
export function pruneWorkspace(state: Workspace, notes: Note[]): Workspace {
  return state.tabs.reduce((result, t) => {
    const loc = currentLocation(t)
    return notes.some((n) => n.id === loc.noteId && (!n.trashed || loc.view === 'trash'))
      ? result
      : closeTab(result, t.id)
  }, state)
}
