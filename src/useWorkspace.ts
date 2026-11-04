import type { WorkspaceNote } from './workspace'
import { noteScrollPositions, splitScrollPositions } from './editor/session'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { View } from './model'
import {
  activeTab,
  captureLocation,
  closeTab,
  currentLocation,
  focusedWorkspace,
  groupOfTab,
  groupsPreferences,
  keepTabOpen,
  moveTabToGroup,
  normalizeGroups,
  normalizeRatio,
  reorderTab,
  setTabPinned,
  openNote,
  openPdf,
  previewNote,
  pruneGroups,
  restoreLocation,
  restoreGroups,
  splitTab,
  splitVisible,
  type EditorGroupId,
  type Location,
  type SplitSide,
  type Workspace,
  type WorkspaceGroups,
  type WorkspacePreferences,
} from './workspace'

export function useWorkspace({
  notes,
  initialNotes,
  documents = [],
  ready,
  saved,
  save,
  view,
  query,
  onActivate,
  disabled,
}: {
  notes: WorkspaceNote[]
  initialNotes?: () => WorkspaceNote[]
  documents?: { id: string }[]
  ready: boolean
  saved: WorkspacePreferences | null
  save: (value: WorkspacePreferences) => void
  view: View
  query: string
  onActivate: (location: Location, restoreScope: boolean) => void
  disabled: boolean
}) {
  const [state, setState] = useState<WorkspaceGroups>(() =>
    ready
      ? restoreGroups(saved, initialNotes?.() ?? notes, documents)
      : restoreGroups({ tabs: [], activeTabId: null }, []),
  )
  const [activation, setActivation] = useState(0)
  const latest = useRef(state)
  const initialized = useRef(ready)
  const pendingScroll = useRef<Location | null>(null)
  const pendingFocus = useRef(false)
  const store = (next: WorkspaceGroups) => {
    latest.current = next
    setState(next)
    save(groupsPreferences(next))
  }
  const commit = (next: WorkspaceGroups, restoreScope = false) => {
    pendingFocus.current = !!document.activeElement?.closest('.tiptap, .note-title')
    // Tabs that came from the split keep their places in the main group's scroll positions.
    const splitTabs = latest.current.split?.tabs ?? []
    for (const tab of next.main.tabs)
      if (splitTabs.some((other) => other.id === tab.id)) {
        const noteId = currentLocation(tab).noteId
        const scroll = noteId ? splitScrollPositions.get(noteId) : undefined
        if (noteId && scroll !== undefined) noteScrollPositions.set(noteId, scroll)
      }
    store(next)
    const tab = activeTab(focusedWorkspace(next))
    if (tab) {
      const location = currentLocation(tab)
      pendingScroll.current = location
      onActivate(location, restoreScope)
    }
  }
  /** Replaces the focused group with a state built from `capture()`. */
  const commitFocused = (next: Workspace, restoreScope = false) =>
    commit(normalizeGroups({ ...latest.current, [latest.current.focused]: next }), restoreScope)
  useEffect(() => {
    if (!ready) return
    if (!initialized.current) {
      initialized.current = true
      commit(restoreGroups(saved, initialNotes?.() ?? notes, documents))
    } else {
      const next = pruneGroups(latest.current, notes, documents)
      if (next !== latest.current) commit(next)
    }
  }, [ready, notes, documents])
  useEffect(() => {
    if (ready && initialized.current) save(groupsPreferences(latest.current))
  }, [ready])
  const focusedScroll = () => {
    const group = document.querySelector(`[data-group="${latest.current.focused}"]`)
    return (group ?? document).querySelector<HTMLElement>('.note-scroll')
  }
  const capture = () => {
    // Two navigation commands can arrive before React mounts the first target.
    // Do not assign the old document's scroll or filters to that pending target.
    const current = focusedWorkspace(latest.current)
    if (latest.current !== state) return current
    const tab = activeTab(current)
    const location = tab && currentLocation(tab)
    const scroll = focusedScroll()
    return captureLocation(current, {
      view,
      query,
      scroll:
        scroll?.dataset.noteId === location?.noteId
          ? (scroll?.scrollTop ?? 0)
          : (location?.scroll ?? 0),
    })
  }
  /** Saves the focused group's current place, then gives another group the focus. */
  const withFocus = (group: EditorGroupId): WorkspaceGroups => {
    const current = latest.current
    return current.focused === group
      ? current
      : { ...current, [current.focused]: capture(), focused: group }
  }
  const open = (noteId: string, newTab = false, context = { view, query }) => {
    if (disabled) return
    setActivation((n) => n + 1)
    commitFocused(openNote(capture(), { noteId, ...context, scroll: 0 }, newTab))
  }
  const preview = (noteId: string) => {
    if (disabled) return
    setActivation((n) => n + 1)
    commitFocused(previewNote(capture(), { noteId, view, query, scroll: 0 }))
  }
  /** Changes one tab where it lives, without moving the focus or a document's activation. */
  const updateTabGroup = (id: string, change: (state: Workspace) => Workspace) => {
    if (disabled) return
    const group = groupOfTab(latest.current, id)
    if (!group) return
    const current = latest.current[group]!
    const next = change(current)
    if (next !== current) store({ ...latest.current, [group]: next })
  }
  const keepOpen = (id: string) => updateTabGroup(id, (current) => keepTabOpen(current, id))
  const keepNoteOpen = (noteId: string) => {
    const groups = [latest.current.main, latest.current.split]
    for (const group of groups)
      for (const tab of group?.tabs ?? [])
        if (tab.preview && currentLocation(tab).noteId === noteId) keepOpen(tab.id)
  }
  const select = (id: string) => {
    const group = groupOfTab(latest.current, id)
    if (disabled || !group) return
    setActivation((n) => n + 1)
    const next = withFocus(group)
    const current = group === latest.current.focused ? capture() : next[group]!
    commit(normalizeGroups({ ...next, [group]: { ...current, activeTabId: id } }))
  }
  const close = (id: string) => {
    const group = groupOfTab(latest.current, id)
    if (disabled || !group) return
    const current = group === latest.current.focused ? capture() : latest.current[group]!
    commit(normalizeGroups({ ...latest.current, [group]: closeTab(current, id) }))
  }
  /** Goes back to a timeline stop and returns the tab showing it. */
  const restore = (tabId: string, location: Location) => {
    if (disabled) return null
    setActivation((n) => n + 1)
    const group =
      location.kind === 'pdf'
        ? 'main'
        : (groupOfTab(latest.current, tabId) ?? latest.current.focused)
    const focused = withFocus(group)
    const current = group === latest.current.focused ? capture() : focused[group]!
    const target = restoreLocation(current, tabId, location)
    const next = normalizeGroups({ ...focused, [group]: target })
    commit(next, true)
    return focusedWorkspace(next).activeTabId
  }
  /** The tab is captured first, so a copy opens at the note's current place. */
  const arrangeTab = (id: string, change: (groups: WorkspaceGroups) => WorkspaceGroups) => {
    if (disabled) return
    const source = groupOfTab(latest.current, id)
    const tab = source && latest.current[source]!.tabs.find((t) => t.id === id)
    const current = { ...latest.current, [latest.current.focused]: capture() }
    const next = change(current)
    if (next === current) return
    const noteId = tab && currentLocation(tab).noteId
    if (noteId) {
      const [from, to] =
        source === 'split'
          ? [splitScrollPositions, noteScrollPositions]
          : [noteScrollPositions, splitScrollPositions]
      to.set(noteId, from.get(noteId) ?? 0)
    }
    commit(next)
  }
  const current = focusedWorkspace(state)
  const tab = activeTab(current)
  const noteId = tab ? currentLocation(tab).noteId : undefined
  // Run after EditorContent has mounted, including an asynchronous document load.
  useLayoutEffect(() => {
    const location = pendingScroll.current
    const scroll = focusedScroll()
    if (!noteId && !tab && pendingFocus.current) {
      document.querySelector<HTMLElement>('[aria-label="New note"]')?.focus()
      pendingFocus.current = false
      pendingScroll.current = null
    }
    if (location && location.kind !== 'pdf' && scroll?.dataset.noteId === location.noteId) {
      if (pendingFocus.current)
        scroll.querySelector<HTMLElement>('.tiptap')?.focus({ preventScroll: true })
      pendingFocus.current = false
      const positions = state.focused === 'split' ? splitScrollPositions : noteScrollPositions
      scroll.scrollTop = positions.get(location.noteId) ?? location.scroll
      pendingScroll.current = null
    }
  })
  return {
    ...current,
    groups: state,
    focusedGroup: state.focused,
    splitOpen: splitVisible(state),
    activation,
    noteId,
    documentId: tab && currentLocation(tab).documentId,
    openPdf: (documentId: string) => {
      if (disabled) return
      setActivation((n) => n + 1)
      const focused = withFocus('main')
      const main = latest.current.focused === 'main' ? capture() : focused.main
      commit(normalizeGroups({ ...focused, main: openPdf(main, documentId) }))
    },
    open,
    preview,
    reorderTab: (id: string, targetIndex: number) =>
      updateTabGroup(id, (current) => reorderTab(current, id, targetIndex)),
    setPinned: (id: string, pinned: boolean) =>
      updateTabGroup(id, (current) => setTabPinned(current, id, pinned)),
    closeActive: () => {
      const tab = activeTab(focusedWorkspace(latest.current))
      if (tab && !tab.pinned) close(tab.id)
    },
    /** Moves focus to a group after a click or Tab, leaving its scroll and the caret alone. */
    focusGroup: (group: EditorGroupId) => {
      if (disabled || latest.current.focused === group || !latest.current.split) return
      const next = normalizeGroups(withFocus(group))
      if (next === latest.current) return
      store(next)
      const tab = activeTab(focusedWorkspace(next))
      if (tab) onActivate(currentLocation(tab), false)
    },
    /** Shows a tab beside its group, or in the other group when already split. */
    splitTab: (id: string, side?: SplitSide) =>
      arrangeTab(id, (groups) => splitTab(groups, id, side)),
    moveTab: (id: string, options: { side?: SplitSide; index?: number }) =>
      arrangeTab(id, (groups) => moveTabToGroup(groups, id, options)),
    setSplitRatio: (ratio: number) => {
      if (latest.current.split) store({ ...latest.current, ratio: normalizeRatio(ratio) })
    },
    keepOpen,
    keepNoteOpen,
    select,
    close,
    restore,
  }
}
