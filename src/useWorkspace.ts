import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Note, View } from './model'
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
  workspacePreferences,
  type Location,
  type Workspace,
  type WorkspacePreferences,
} from './workspace'

export function useWorkspace({
  notes,
  ready,
  saved,
  save,
  view,
  query,
  onActivate,
  disabled,
}: {
  notes: Note[]
  ready: boolean
  saved: WorkspacePreferences | null
  save: (value: WorkspacePreferences) => void
  view: View
  query: string
  onActivate: (location: Location, restoreScope: boolean) => void
  disabled: boolean
}) {
  const [state, setState] = useState<Workspace>(() =>
    ready ? restoreWorkspace(saved, notes) : { tabs: [], activeTabId: null },
  )
  const [activation, setActivation] = useState(0)
  const latest = useRef(state)
  const initialized = useRef(ready)
  const pendingScroll = useRef<Location | null>(null)
  const pendingFocus = useRef(false)
  const commit = (next: Workspace, restoreScope = false) => {
    pendingFocus.current = !!document.activeElement?.closest('.tiptap, .note-title')
    latest.current = next
    setState(next)
    save(workspacePreferences(next))
    const tab = activeTab(next)
    if (tab) {
      const location = currentLocation(tab)
      pendingScroll.current = location
      onActivate(location, restoreScope)
    }
  }
  useEffect(() => {
    if (!ready) return
    if (!initialized.current) {
      initialized.current = true
      commit(restoreWorkspace(saved, notes))
    } else {
      const next = pruneWorkspace(latest.current, notes)
      if (next !== latest.current) commit(next)
    }
  }, [ready, notes])
  useEffect(() => {
    if (ready && initialized.current) save(workspacePreferences(latest.current))
  }, [ready])
  const capture = () => {
    // Two navigation commands can arrive before React mounts the first target.
    // Do not assign the old document's scroll or filters to that pending target.
    if (latest.current !== state) return latest.current
    const tab = activeTab(latest.current)
    const location = tab && currentLocation(tab)
    const scroll = document.querySelector<HTMLElement>('.note-scroll')
    return captureLocation(latest.current, {
      view,
      query,
      scroll:
        scroll?.dataset.noteId === location?.noteId
          ? (scroll?.scrollTop ?? 0)
          : (location?.scroll ?? 0),
    })
  }
  const open = (noteId: string, newTab = false, context = { view, query }) => {
    if (disabled) return
    setActivation((n) => n + 1)
    commit(openNote(capture(), { noteId, ...context, scroll: 0 }, newTab))
  }
  const preview = (noteId: string) => {
    if (disabled) return
    setActivation((n) => n + 1)
    commit(previewNote(capture(), { noteId, view, query, scroll: 0 }))
  }
  const keepOpen = (id: string) => {
    if (disabled) return
    const current = latest.current
    const tab = current.tabs.find((t) => t.id === id)
    if (!tab?.preview) return
    const next = keepTabOpen(current, tab.id)
    latest.current = next
    setState(next)
    save(workspacePreferences(next))
  }
  const keepNoteOpen = (noteId: string) => {
    const tab = latest.current.tabs.find((t) => t.preview && currentLocation(t).noteId === noteId)
    if (tab) keepOpen(tab.id)
  }
  const select = (id: string) => {
    if (disabled || !latest.current.tabs.some((t) => t.id === id)) return
    setActivation((n) => n + 1)
    commit({ ...capture(), activeTabId: id })
  }
  const close = (id: string) => {
    if (!disabled) commit(closeTab(capture(), id))
  }
  const move = (direction: number) => {
    if (!disabled) setActivation((n) => n + 1)
    if (!disabled) commit(moveHistory(capture(), direction, notes), true)
  }
  const tab = activeTab(state)
  const noteId = tab ? currentLocation(tab).noteId : undefined
  // Run after EditorContent has mounted, including an asynchronous document load.
  useLayoutEffect(() => {
    const location = pendingScroll.current
    const scroll = document.querySelector<HTMLElement>('.note-scroll')
    if (!noteId && pendingFocus.current) {
      document.querySelector<HTMLElement>('[aria-label="New note"]')?.focus()
      pendingFocus.current = false
      pendingScroll.current = null
    }
    if (location && scroll?.dataset.noteId === location.noteId) {
      if (pendingFocus.current)
        scroll.querySelector<HTMLElement>('.tiptap')?.focus({ preventScroll: true })
      pendingFocus.current = false
      scroll.scrollTop = location.scroll
      pendingScroll.current = null
    }
  })
  return {
    ...state,
    activation,
    noteId,
    open,
    preview,
    keepOpen,
    keepNoteOpen,
    select,
    close,
    move,
    canBack: historyIndex(tab, -1, notes) !== undefined,
    canForward: historyIndex(tab, 1, notes) !== undefined,
  }
}
