import type { Note, View } from './model'
import type { NoteListPreferences } from './noteOrder'
import type { PaneWidths } from './paneLayout'

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
  pdfNotes?: Record<string, PdfNotesPreferences>
  recentNoteIds?: string[]
  noteLists?: Record<string, NoteListPreferences>
  paneWidths?: PaneWidths
  contentsWidth?: number
  tabs: SavedTab[]
  activeTabId: string | null
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
export type SavedTab = { id: string; preview?: boolean } & (
  | { kind?: 'note'; noteId: string; documentId?: never }
  | { kind: 'pdf'; documentId: string; noteId?: never }
)
const targetKey = (target: { kind?: string; noteId?: string; documentId?: string }) =>
  target.kind === 'pdf' ? `pdf:${target.documentId}` : `note:${target.noteId}`
const available = (location: Location, notes: Note[], documents: { id: string }[]) =>
  location.kind === 'pdf'
    ? documents.some((d) => d.id === location.documentId)
    : notes.some((n) => n.id === location.noteId && (!n.trashed || location.view === 'trash'))
export type WorkspaceTab = { id: string; entries: Location[]; index: number; preview?: boolean }
export type Workspace = { tabs: WorkspaceTab[]; activeTabId: string | null }
export const currentLocation = (tab: WorkspaceTab) => tab.entries[tab.index]
export const activeTab = (state: Workspace) => state.tabs.find((t) => t.id === state.activeTabId)
export function restoreWorkspace(
  saved: WorkspacePreferences | null,
  notes: Note[],
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
      ...(t.preview && t.kind !== 'pdf' ? { preview: true } : {}),
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
    tabs: state.tabs.map((t): SavedTab => {
      const location = currentLocation(t)
      return location.kind === 'pdf'
        ? { id: t.id, kind: 'pdf', documentId: location.documentId }
        : { id: t.id, noteId: location.noteId, ...(t.preview ? { preview: true } : {}) }
    }),
    activeTabId: state.activeTabId,
  }
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
  if (newTab || !tab || currentLocation(tab).kind === 'pdf') {
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
  documents: { id: string }[] = [],
): number | undefined {
  if (!tab) return undefined
  for (let i = tab.index + direction; i >= 0 && i < tab.entries.length; i += direction) {
    const entry = tab.entries[i]
    if (available(entry, notes, documents)) return i
  }
}
export function moveHistory(
  state: Workspace,
  direction: number,
  notes: Note[],
  documents: { id: string }[] = [],
): Workspace {
  const index = historyIndex(activeTab(state), direction, notes, documents)
  return index === undefined
    ? state
    : { ...state, tabs: state.tabs.map((t) => (t.id === state.activeTabId ? { ...t, index } : t)) }
}
export function pruneWorkspace(
  state: Workspace,
  notes: Note[],
  documents: { id: string }[] = [],
): Workspace {
  return state.tabs.reduce((result, t) => {
    const loc = currentLocation(t)
    return available(loc, notes, documents) ? result : closeTab(result, t.id)
  }, state)
}

export function normalizeRecentNotes(value: unknown, notes?: Note[]): string[] {
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
