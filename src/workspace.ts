import type { Note } from './model'
export type WorkspaceNote = Pick<Note, 'id' | 'trashed' | 'tags' | 'pinned' | 'updated'>
import type { Notebook, View } from './model'
import type { NoteListPreferences } from './noteOrder'
import type { PaneWidths } from './paneLayout'
import type { NoteListMode } from './noteListPresentation'

export type PdfNotesPreferences = {
  open: boolean
  ratio: number
  scroll: number
  pane: 'pdf' | 'note'
}
export const defaultPdfNotes = (): PdfNotesPreferences => ({
  open: false,
  ratio: 0.6,
  scroll: 0,
  pane: 'pdf',
})
export function normalizePdfNotes(value: unknown): Record<string, PdfNotesPreferences> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value)
      .filter(([id]) => /^[a-zA-Z0-9_-]{1,128}$/.test(id))
      .map(([id, item]) => {
        const p = item as Partial<PdfNotesPreferences> | null
        return [
          id,
          {
            open: p?.open === true,
            ratio:
              typeof p?.ratio === 'number' && Number.isFinite(p.ratio)
                ? Math.max(0.1, Math.min(0.9, p.ratio))
                : 0.6,
            scroll:
              typeof p?.scroll === 'number' && Number.isFinite(p.scroll)
                ? Math.max(0, Math.min(1e8, p.scroll))
                : 0,
            pane: p?.pane === 'note' ? 'note' : 'pdf',
          },
        ]
      }),
  )
}
export type WorkspacePreferences = {
  noteListMode?: NoteListMode
  sidebarView?: View
  /** The open project page: a project ID, 'inbox' or 'all'. */
  projectView?: string | null
  pdfNotes?: Record<string, PdfNotesPreferences>
  recentNoteIds?: string[]
  noteLists?: Record<string, NoteListPreferences>
  paneWidths?: PaneWidths
  contentsWidth?: number
  taskDetailWidth?: number
  tabs: SavedTab[]
  activeTabId: string | null
  split?: SavedSplit
}
export function restoreSidebarView(value: unknown, notebooks: Notebook[], notes: WorkspaceNote[]): View {
  if (typeof value !== 'string') return 'all'
  if (value.startsWith('book:'))
    return notebooks.some((book) => book.id === value.slice(5)) ? (value as View) : 'all'
  if (value.startsWith('tag:'))
    return notes.some((note) => !note.trashed && note.tags.includes(value.slice(4)))
      ? (value as View)
      : 'all'
  switch (value) {
    case 'all':
    case 'today':
    case 'todo':
    case 'uncategorized':
    case 'pinned':
    case 'quickAccess':
    case 'trash':
      return value
    default:
      return 'all'
  }
}
export type NoteLocation = {
  kind?: 'note'
  noteId: string
  view: View
  query: string
  scroll: number
  documentId?: never
}
export type PdfLocation = {
  kind: 'pdf'
  documentId: string
  noteId?: never
  view?: never
  query?: never
  scroll?: never
}
export type Location = NoteLocation | PdfLocation
export type SavedTab = { id: string; pinned?: boolean; preview?: boolean } & (
  | { kind?: 'note'; noteId: string; documentId?: never }
  | { kind: 'pdf'; documentId: string; noteId?: never }
)
const targetKey = (target: { kind?: string; noteId?: string; documentId?: string }) =>
  target.kind === 'pdf' ? `pdf:${target.documentId}` : `note:${target.noteId}`
export const available = (location: Location, notes: WorkspaceNote[], documents: { id: string }[]) =>
  location.kind === 'pdf'
    ? documents.some((d) => d.id === location.documentId)
    : notes.some((n) => n.id === location.noteId && (!n.trashed || location.view === 'trash'))
export type WorkspaceTab = {
  id: string
  entries: Location[]
  index: number
  pinned?: boolean
  preview?: boolean
}
export type Workspace = { tabs: WorkspaceTab[]; activeTabId: string | null }
export type EditorGroupId = 'main' | 'split'
export type SplitSide = 'left' | 'right'
export type SavedSplit = {
  tabs: SavedTab[]
  activeTabId: string | null
  side: SplitSide
  /** The left group's share of the editor pane. */
  ratio: number
  focused: boolean
}
/**
 * The main group plus an optional split group. Each is an ordinary Workspace, so the tab
 * functions below work on either one. PDF tabs stay in the main group, which already pairs
 * them with notes: the split steps aside while a PDF is showing.
 */
export type WorkspaceGroups = {
  main: Workspace
  split: Workspace | null
  splitSide: SplitSide
  ratio: number
  focused: EditorGroupId
}
export const currentLocation = (tab: WorkspaceTab) => tab.entries[tab.index]
export const activeTab = (state: Workspace) => state.tabs.find((t) => t.id === state.activeTabId)
export function restoreWorkspace(
  saved: WorkspacePreferences | null,
  notes: WorkspaceNote[],
  documents: { id: string }[] = [],
): Workspace {
  const tabs: WorkspaceTab[] = (
    saved?.tabs ??
    notes
      .filter((n) => !n.trashed)
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated - a.updated)
      .slice(0, 1)
      .map((n): SavedTab => ({ id: crypto.randomUUID(), noteId: n.id, preview: false }))
  )
    .filter(
      (t, i, all) =>
        (t.kind === 'pdf'
          ? documents.some((d) => d.id === t.documentId)
          : notes.some((n) => n.id === t.noteId && !n.trashed)) &&
        all.findIndex((other) => other.id === t.id || targetKey(other) === targetKey(t)) === i,
    )
    .map((t) => ({
      id: t.id,
      entries: [
        t.kind === 'pdf'
          ? { kind: 'pdf' as const, documentId: t.documentId }
          : { noteId: t.noteId, view: 'all' as View, query: '', scroll: 0 },
      ],
      index: 0,
      ...(t.pinned === true ? { pinned: true } : {}),
      ...(!t.pinned && t.preview && t.kind !== 'pdf' ? { preview: true } : {}),
    }))
  tabs.sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned))
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
    tabs: state.tabs.map((t): SavedTab => {
      const location = currentLocation(t)
      return location.kind === 'pdf'
        ? {
            id: t.id,
            ...(t.pinned ? { pinned: true } : {}),
            kind: 'pdf',
            documentId: location.documentId,
          }
        : {
            id: t.id,
            ...(t.pinned ? { pinned: true } : {}),
            noteId: location.noteId,
            ...(t.preview ? { preview: true } : {}),
          }
    }),
    activeTabId: state.activeTabId,
  }
}
export const focusedWorkspace = (groups: WorkspaceGroups) =>
  groups.focused === 'split' && groups.split ? groups.split : groups.main
export const groupOfTab = (groups: WorkspaceGroups, id: string): EditorGroupId | null =>
  groups.main.tabs.some((tab) => tab.id === id)
    ? 'main'
    : groups.split?.tabs.some((tab) => tab.id === id)
      ? 'split'
      : null
const pdfShowing = (state: Workspace) => {
  const tab = activeTab(state)
  return !!tab && currentLocation(tab).kind === 'pdf'
}
export const splitVisible = (groups: WorkspaceGroups) => !!groups.split && !pdfShowing(groups.main)
export const normalizeRatio = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0.1, Math.min(0.9, value)) : 0.5
/** An emptied split closes; an emptied main group is replaced by the split. */
export function normalizeGroups(groups: WorkspaceGroups): WorkspaceGroups {
  let { main, split } = groups
  if (split && !split.tabs.length) split = null
  if (split && !main.tabs.length) {
    main = split
    split = null
  }
  const focused = split && !pdfShowing(main) ? groups.focused : 'main'
  return main === groups.main && split === groups.split && focused === groups.focused
    ? groups
    : { ...groups, main, split, focused }
}
export function restoreGroups(
  saved: WorkspacePreferences | null,
  notes: WorkspaceNote[],
  documents: { id: string }[] = [],
): WorkspaceGroups {
  const split = saved?.split
  return normalizeGroups({
    main: restoreWorkspace(saved, notes, documents),
    split:
      split && Array.isArray(split.tabs)
        ? restoreWorkspace(
            { tabs: split.tabs.filter((tab) => tab.kind !== 'pdf'), activeTabId: split.activeTabId },
            notes,
          )
        : null,
    splitSide: split?.side === 'left' ? 'left' : 'right',
    ratio: normalizeRatio(split?.ratio),
    focused: split?.focused === true ? 'split' : 'main',
  })
}
export function groupsPreferences(groups: WorkspaceGroups): WorkspacePreferences {
  return {
    ...workspacePreferences(groups.main),
    ...(groups.split
      ? {
          split: {
            ...workspacePreferences(groups.split),
            side: groups.splitSide,
            ratio: groups.ratio,
            focused: groups.focused === 'split',
          },
        }
      : {}),
  }
}
export function pruneGroups(
  groups: WorkspaceGroups,
  notes: WorkspaceNote[],
  documents: { id: string }[] = [],
): WorkspaceGroups {
  const main = pruneWorkspace(groups.main, notes, documents)
  const split = groups.split && pruneWorkspace(groups.split, notes, documents)
  return main === groups.main && split === groups.split
    ? groups
    : normalizeGroups({ ...groups, main, split })
}
const otherGroup = (group: EditorGroupId): EditorGroupId => (group === 'main' ? 'split' : 'main')
/** Puts a tab in a group, or selects the tab already showing the same note there. */
function placeTab(state: Workspace, tab: WorkspaceTab, index?: number): Workspace {
  const key = targetKey(currentLocation(tab))
  const existing = state.tabs.find((other) => targetKey(currentLocation(other)) === key)
  if (existing) return { ...state, activeTabId: existing.id }
  const tabs = [...state.tabs]
  const pinned = tabs.filter((other) => other.pinned).length
  tabs.splice(Math.max(pinned, Math.min(tabs.length, index ?? tabs.length)), 0, tab)
  return { tabs, activeTabId: tab.id }
}
/** Shows a note tab beside its group, as a copy with its own tab. PDF tabs can't be split. */
export function splitTab(groups: WorkspaceGroups, id: string, side?: SplitSide): WorkspaceGroups {
  const source = groupOfTab(groups, id)
  const tab = source && groups[source]!.tabs.find((other) => other.id === id)
  if (!source || !tab || currentLocation(tab).kind === 'pdf') return groups
  const copy: WorkspaceTab = { id: crypto.randomUUID(), entries: [currentLocation(tab)], index: 0 }
  if (groups.split) {
    const target = otherGroup(source)
    return normalizeGroups({
      ...groups,
      [target]: placeTab(groups[target]!, copy),
      focused: target,
    })
  }
  return {
    ...groups,
    split: { tabs: [copy], activeTabId: copy.id },
    splitSide: side ?? 'right',
    ratio: 0.5,
    focused: 'split',
  }
}
/** Moves a tab to the other group, or into a new split when `side` is given. */
export function moveTabToGroup(
  groups: WorkspaceGroups,
  id: string,
  options: { side?: SplitSide; index?: number } = {},
): WorkspaceGroups {
  const source = groupOfTab(groups, id)
  const tab = source && groups[source]!.tabs.find((other) => other.id === id)
  if (!source || !tab || currentLocation(tab).kind === 'pdf') return groups
  // A group's only tab can't leave it without closing the group, so a new split copies it.
  if (!groups.split && groups.main.tabs.length < 2) return splitTab(groups, id, options.side)
  const { preview: _, pinned: __, ...moved } = tab
  const remaining = closeTab(groups[source]!, id)
  if (!groups.split)
    return {
      ...groups,
      main: remaining,
      split: { tabs: [moved], activeTabId: moved.id },
      splitSide: options.side ?? 'right',
      ratio: 0.5,
      focused: 'split',
    }
  const target = otherGroup(source)
  return normalizeGroups({
    ...groups,
    [source]: remaining,
    [target]: placeTab(groups[target]!, moved, options.index),
    focused: target,
  })
}
export function captureLocation(
  state: Workspace,
  context: Omit<NoteLocation, 'noteId'>,
): Workspace {
  return {
    ...state,
    tabs: state.tabs.map((t) =>
      t.id !== state.activeTabId
        ? t
        : {
            ...t,
            entries: t.entries.map((entry, i) =>
              i === t.index && entry.kind !== 'pdf' ? { ...entry, ...context } : entry,
            ),
          },
    ),
  }
}
export function openNote(state: Workspace, location: NoteLocation, newTab = false): Workspace {
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
                i === t.index && entry.kind !== 'pdf'
                  ? { ...entry, view: location.view, query: location.query }
                  : entry,
              ),
            }
          : selected
      }),
    }
  const tab = activeTab(state)
  if (newTab || !tab || tab.pinned || currentLocation(tab).kind === 'pdf') {
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
export function previewNote(state: Workspace, location: NoteLocation): Workspace {
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
export function constrainTabIndex(
  tabs: { id: string; pinned?: boolean }[],
  id: string,
  target: number,
): number {
  const tab = tabs.find((tab) => tab.id === id)
  if (!tab) return target
  const count = tabs.filter((tab) => tab.pinned).length
  return Math.max(
    tab.pinned ? 0 : count,
    Math.min(tab.pinned ? count - 1 : tabs.length - 1, target),
  )
}

export function setTabPinned(state: Workspace, id: string, pinned: boolean): Workspace {
  const tab = state.tabs.find((tab) => tab.id === id)
  if (!tab || !!tab.pinned === pinned) return state
  const { preview: _, pinned: __, ...permanent } = tab
  const tabs = state.tabs.filter((tab) => tab.id !== id)
  const boundary = tabs.filter((tab) => tab.pinned).length
  tabs.splice(boundary, 0, { ...permanent, ...(pinned ? { pinned: true } : {}) })
  return { ...state, tabs }
}

export function reorderTab(state: Workspace, id: string, targetIndex: number): Workspace {
  const index = state.tabs.findIndex((tab) => tab.id === id)
  if (
    index < 0 ||
    !Number.isInteger(targetIndex) ||
    targetIndex < 0 ||
    targetIndex >= state.tabs.length ||
    index === targetIndex
  )
    return state
  targetIndex = constrainTabIndex(state.tabs, id, targetIndex)
  if (index === targetIndex) return state
  const tabs = [...state.tabs]
  const [tab] = tabs.splice(index, 1)
  const { preview: _, ...kept } = tab
  tabs.splice(targetIndex, 0, tab.preview ? kept : tab)
  return { ...state, tabs }
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
/** Shows `location` again: in the tab already on it, its old tab if usable, or a new tab. */
export function restoreLocation(state: Workspace, tabId: string, location: Location): Workspace {
  // Entries hold the scroll captured on leaving, which is newer than the timeline's copy.
  const revisit = (t: WorkspaceTab, index: number): WorkspaceTab => ({
    ...t,
    index,
    entries: t.entries.map((entry, i) =>
      i === index && entry.kind !== 'pdf' && location.kind !== 'pdf'
        ? { ...location, scroll: entry.scroll }
        : entry,
    ),
  })
  const showing = state.tabs.find((t) => targetKey(currentLocation(t)) === targetKey(location))
  if (showing)
    return {
      ...state,
      activeTabId: showing.id,
      tabs: state.tabs.map((t) => (t.id === showing.id ? revisit(t, t.index) : t)),
    }
  const tab = state.tabs.find((t) => t.id === tabId)
  if (!tab || tab.pinned || location.kind === 'pdf' || currentLocation(tab).kind === 'pdf') {
    const id = crypto.randomUUID()
    return { tabs: [...state.tabs, { id, entries: [location], index: 0 }], activeTabId: id }
  }
  const earlier = tab.entries.map(targetKey).lastIndexOf(targetKey(location))
  return {
    ...state,
    activeTabId: tab.id,
    tabs: state.tabs.map((t) =>
      t.id !== tab.id
        ? t
        : earlier >= 0
          ? revisit(t, earlier)
          : { ...t, entries: [...t.entries.slice(0, t.index + 1), location], index: t.index + 1 },
    ),
  }
}
export function pruneWorkspace(
  state: Workspace,
  notes: WorkspaceNote[],
  documents: { id: string }[] = [],
): Workspace {
  return state.tabs.reduce((result, t) => {
    const loc = currentLocation(t)
    return available(loc, notes, documents) ? result : closeTab(result, t.id)
  }, state)
}

export function normalizeRecentNotes(value: unknown, notes?: WorkspaceNote[]): string[] {
  if (!Array.isArray(value)) return []
  const available = notes && new Set(notes.filter((note) => !note.trashed).map((note) => note.id))
  return [
    ...new Set(
      value.filter(
        (id): id is string => typeof id === 'string' && !!id && (!available || available.has(id)),
      ),
    ),
  ].slice(0, 50)
}

export function openPdf(state: Workspace, documentId: string): Workspace {
  const existing = state.tabs.find((t) => {
    const loc = currentLocation(t)
    return loc.kind === 'pdf' && loc.documentId === documentId
  })
  if (existing) return { ...state, activeTabId: existing.id }
  const id = crypto.randomUUID()
  return {
    tabs: [...state.tabs, { id, entries: [{ kind: 'pdf', documentId }], index: 0 }],
    activeTabId: id,
  }
}
