import { type VirtualNoteRowsApi } from '../components/VirtualNoteRows'
import { normalizeNoteListMode, type NoteListMode } from '../noteListPresentation'
import { useDesktopWindowAppearance } from '../useDesktopWindowAppearance'
import { colorModes, layoutNames, layouts, useDocumentTheme, useSystemAccent } from '../appearance'
import { platform } from '../platform'
import { defaultPdfNotes, type PdfNotesPreferences } from '../workspace'
import { appendCapture } from '../pdf/capture'
import {
  citationContent,
  parsePdfCitation,
  resolvePdfCitation,
  type PdfSelection,
} from '../pdf/citations'
import type { PdfNavigation } from '../pdf/model'
import { focusDocument } from '../useShortcuts'
import { captureLayout } from '../layoutMotion'
import { pdfStore, usePdfs } from '../pdf/store'
import { useLibraryShell, useNoteIds } from '../storage/libraryReaders'
import { libraryProjection, type NavigationNote } from '../storage/librarySelectors'
import { useNotebookMove } from '../useNotebookMove'
import { moveSource, notebookMoveTarget } from '../notebookMove'
import { useNoteDrag } from '../useNoteDrag'
import { useNoteActions } from '../useNoteActions'
import { followsFirstLine } from '../noteTitles'
import { startAutoSync } from '../autoSync'
import { useShortcutActions } from '../useShortcuts'
import { bindingFor, shortcutLabel } from '../shortcuts'
import { validateMarkdown } from '../editor/markdown'
import { getEditor, noteScrollPositions } from '../editor/session'
import { motion, useMotionPreference, useAnimatedItems } from '../motion'
import { useEffect, useMemo, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { type NoteAction } from '../components/NoteContextMenu'
import { type PopoverAnchor } from '../components/AddToNotebooksPopover'
import { type NotebookDeleteOptions } from '../components/NotebookDeleteDialog'
import { fileTitleError, notebookPath } from '../notebooks'
import type { Notebook as NotebookModel } from '../model'
import { open as pickFolder } from '@tauri-apps/plugin-dialog'
import {
  Files,
  Pin,
  PinOff,
  Trash2,
  ExternalLink,
  Star,
  StarOff,
  Link2,
  FolderPlus,
  RotateCcw,
  ArrowUp,
  ArrowDown,
  Plus,
  FileText,
  FolderInput,
  Maximize2,
  Moon,
  SunMoon,
  Sun,
  RefreshCw,
  Settings2,
  Columns2,
  PanelLeft,
} from '../icons'
import {
  sortNotes,
  reorderSlots,
  reconcileNoteLists,
  moveNote,
  type NoteSortMode,
} from '../noteOrder'
import { useWorkspace } from '../useWorkspace'
import { restoreSidebarView } from '../workspace'
import { usePaneResize } from '../usePaneResize'
import { useContentsResize } from '../useContentsResize'
import type { NoteLinkContext } from '../editor/noteReferences'
import type { PaletteCommand } from '../components/CommandPalette'
import type { MatchNavigation } from '../search'
import { matchesView, type ColorMode, type Note, type View } from '../model'
import { useLibrarySelector, library as libraryStore } from '../storage/useLibrary'
import { fontFamily } from '../fonts'
import { headingStyleVariables } from '../headingStyles'

// Shared so views that read pdfPreferences without a PDF open see a stable value.
const noPdfNotes = Object.freeze(defaultPdfNotes())

export const viewNames: Record<string, string> = {
  all: 'All notes',
  today: 'Today',
  todo: 'To-do',
  uncategorized: 'Uncategorized',
  pinned: 'Pinned notes',
  quickAccess: 'Quick Access',
  trash: 'Trash',
}

/** Desktop workspace state and behavior. Views read from this; it renders nothing. */
export function useAppController() {
  const library = useLibraryShell()
  useEffect(() => {
    if (!(library.syncing || library.converting)) return
    const block = (event: Event) => {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    document.addEventListener('pointerdown', block, true)
    document.addEventListener('click', block, true)
    return () => {
      document.removeEventListener('pointerdown', block, true)
      document.removeEventListener('click', block, true)
    }
  }, [library.syncing || library.converting])
  const { notes, setNotes, notebooks, setNotebooks, appearance, setAppearance } = library
  const motionActive = useMotionPreference(appearance.animationsEnabled)
  const dark = useDocumentTheme(appearance)
  const nativeMac = isTauri() && platform.platform === 'macos'
  const rowsRef = useRef<HTMLDivElement>(null)
  const virtualRowsRef = useRef<VirtualNoteRowsApi | null>(null)
  const chipsRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<HTMLDivElement>(null)
  const editorWorkspaceRef = useRef<HTMLDivElement>(null)
  useDesktopWindowAppearance(
    appRef,
    library.ready || !!library.startupError,
    library.ready ? dark : true,
    library.ready ? `${appearance.colorMode}:${appearance.accent}` : 'startup-error',
    library.ready && nativeMac && appearance.translucentSidebar,
  )
  useSystemAccent(nativeMac && library.ready && appearance.accent === 'system')
  const [sidebarView, setView] = useState<View | null>(null)
  const view =
    sidebarView ??
    (library.ready ? restoreSidebarView(library.workspace?.sidebarView, notebooks, notes) : 'all')
  useEffect(() => {
    if (library.ready) libraryStore.setSidebarView(view)
  }, [library.ready, view])
  const [query, setQuery] = useState('')
  const filterInput = useRef<HTMLInputElement>(null)
  const [appearanceOpen, setAppearanceOpen] = useState(false)
  const [settingsCategory, setSettingsCategory] = useState<'appearance' | 'sync'>('appearance')
  useEffect(() => {
    if (!appearanceOpen) setSettingsCategory('appearance')
  }, [appearanceOpen])
  const [bookOpen, setBookOpen] = useState(false)
  const [bookParent, setBookParent] = useState<NotebookModel | undefined>()
  const [bookEditing, setBookEditing] = useState<NotebookModel | undefined>()
  const [bookToConvert, setBookToConvert] = useState<NotebookModel | null>(null)
  const [bookToDelete, setBookToDelete] = useState<NotebookModel | null>(null)
  const [conflictId, setConflictId] = useState<string | null>(null)
  const [titleDraft, setTitleDraft] = useState<{ id: string; value: string } | null>(null)
  const [folderError, setFolderError] = useState('')
  const [folderBusy, setFolderBusy] = useState(false)
  const [focus, storeFocus] = useState(false)
  const [sidebar, storeSidebar] = useState(true)
  const [noteList, storeNoteList] = useState(true)
  const setFocus = (next: boolean | ((old: boolean) => boolean)) => {
    if (motionActive) captureLayout(appRef.current, motion.focus)
    storeFocus(next)
  }
  const setSidebar = (next: boolean | ((old: boolean) => boolean)) => {
    if (motionActive) captureLayout(appRef.current, motion.sidebar)
    storeSidebar(next)
  }
  const setNoteList = (next: boolean | ((old: boolean) => boolean)) => {
    if (motionActive) captureLayout(appRef.current, motion.sidebar)
    storeNoteList(next)
  }
  const [noteMenuOpen, setNoteMenuOpen] = useState(false)
  const [organization, storeOrganization] = useState<{
    id: string
    view: View
    anchor: PopoverAnchor
    launcher: HTMLElement | null
    destination?: string
  } | null>(null)
  const [addOrganization, setAddOrganization] = useState<{
    id: string
    anchor: PopoverAnchor
    launcher: HTMLElement | null
  } | null>(null)
  const organizationOpen = !!organization
  const setOrganization = (
    next: { id: string; destination?: string; launcher?: HTMLElement } | null,
  ) => {
    if (!next) {
      storeOrganization(null)
      return
    }
    const row = [...document.querySelectorAll<HTMLElement>('.note-row')].find(
      (el) => el.dataset.noteId === next.id,
    )
    const dropRow =
      next.destination !== undefined
        ? [...document.querySelectorAll<HTMLElement>('[data-notebook-drop-id]')].find(
            (el) => el.dataset.notebookDropId === next.destination,
          )
        : null
    const moveButton = [...document.querySelectorAll<HTMLElement>('[data-move-note-id]')].find(
      (el) => el.dataset.moveNoteId === next.id,
    )
    const launcher =
      next.launcher ??
      dropRow?.querySelector<HTMLElement>('.nav-item') ??
      dropRow ??
      moveButton ??
      row ??
      document.querySelector<HTMLElement>('[aria-label="Note actions"]')
    const { left, top, width, height } =
      launcher?.getBoundingClientRect() ?? new DOMRect(10, 10, 0, 0)
    setAddOrganization(null)
    storeOrganization({ ...next, view, launcher, anchor: { left, top, width, height } })
  }
  const openAddToNotebooks = (id: string, launcher: HTMLElement) => {
    if (addOrganization?.launcher === launcher) {
      setAddOrganization(null)
      return
    }
    storeOrganization(null)
    const { left, top, width, height } = launcher.getBoundingClientRect()
    setAddOrganization({ id, anchor: { left, top, width, height }, launcher })
  }
  const [actionError, setActionError] = useState<{ message: string; retry: () => void } | null>(
    null,
  )
  const [busyNote, setBusyNote] = useState<string | null>(null)
  const [linkMessage, setLinkMessage] = useState('')
  const [noteContext, setNoteContext] = useState<{
    id: string
    x: number
    y: number
  } | null>(null)
  useEffect(() => {
    if (!noteContext) return
    const close = () => setNoteContext(null)
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close()
        requestAnimationFrame(() => {
          const source = [...document.querySelectorAll<HTMLElement>('.note-row')].find(
            (el) => el.dataset.noteId === noteContext.id,
          )
          source?.focus()
        })
      }
    }
    document.addEventListener('click', close)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('click', close)
      document.removeEventListener('keydown', escape)
    }
  }, [noteContext])
  const [contentsOpen, setContentsOpen] = useState(false)
  const contentsLauncher = useRef<HTMLButtonElement>(null)
  const contentsKeyboardOpen = useRef(false)
  const toggleContents = (keyboard = false) => {
    contentsKeyboardOpen.current = keyboard
    setContentsOpen((value) => !value)
  }
  const [findOpen, setFindOpen] = useState(false)
  const [matchNavigation, setMatchNavigation] = useState<MatchNavigation | null>(null)
  const contentsResize = useContentsResize({
    workspaceRef: editorWorkspaceRef,
    savedWidth: library.workspace?.contentsWidth,
    disabled: library.quitting || library.syncing || library.converting,
    onCommit: libraryStore.setContentsWidth,
    adaptive: true,
  })
  const pdfs = usePdfs(library.ready)
  const [pdfImportError, setPdfImportError] = useState('')
  const [pdfImporting, setPdfImporting] = useState(false)
  const pdfInput = useRef<HTMLInputElement>(null)
  useEffect(() => libraryStore.registerFlush(pdfStore.flush), [])
  const workspace = useWorkspace({
    notes,
    initialNotes: () => libraryStore.getSnapshot().notes,
    documents: pdfs.documents,
    ready: library.ready && pdfs.ready,
    saved: library.workspace,
    save: library.setWorkspace,
    view,
    query,
    disabled: library.quitting || library.syncing || library.converting,
    onActivate: (location, restoreScope) => {
      setMatchNavigation(null)
      if (location.kind === 'pdf') return
      libraryStore.setRecentNotes([
        location.noteId,
        ...(libraryStore.getSnapshot().workspace?.recentNoteIds ?? []),
      ])
      setLinkMessage('')
      if (restoreScope) {
        setView(location.view)
        setQuery(location.query)
      }
    },
  })
  const noteListVisible = noteList && !focus && !workspace.documentId
  const paneResize = usePaneResize({
    appRef,
    savedWidths: library.workspace?.paneWidths,
    sidebarVisible: sidebar && !focus,
    noteListVisible,
    disabled: library.quitting || library.syncing || library.converting,
    onCommit: libraryStore.setPaneWidths,
  })

  useEffect(() => {
    if (!library.ready) return
    const ids = libraryStore.getSnapshot().workspace?.recentNoteIds ?? []
    libraryStore.setRecentNotes(workspace.noteId ? [workspace.noteId, ...ids] : ids)
  }, [library.ready, workspace.noteId, notes])

  const [companions, setCompanions] = useState<Record<string, string>>({})
  const [pdfNotesError, setPdfNotesError] = useState('')
  const [captureBusy, setCaptureBusy] = useState(false)
  const [pdfNavigation, setPdfNavigation] = useState<
    (PdfNavigation & { documentId: string }) | undefined
  >()
  const [focusedPane, setFocusedPane] = useState<'pdf' | 'note'>('note')
  useEffect(() => {
    let current = true
    if (library.ready && pdfs.documents.length)
      void libraryStore.listPdfCompanions().then(
        (associations) => {
          if (current) setCompanions(associations)
        },
        (error) => {
          if (current) setPdfNotesError(String(error))
        },
      )
    return () => {
      current = false
    }
  }, [library.ready, library.syncGeneration, notes.length, pdfs.documents.length])
  const activePdf = pdfs.documents.find((doc) => doc.id === workspace.documentId)
  const companionId = activePdf ? companions[activePdf.id] : undefined
  const companion = notes.find((n) => n.id === companionId)
  const pdfPreferences = (activePdf && library.workspace?.pdfNotes?.[activePdf.id]) || noPdfNotes
  const notesOpen = !!companion && pdfPreferences.open
  const pdfNotesLabel = companion?.trashed
    ? 'Restore note'
    : companion
      ? notesOpen
        ? 'Hide notes'
        : 'Show notes'
      : 'Take notes'
  const setPdfPreferences = (patch: Partial<PdfNotesPreferences>, documentId = activePdf?.id) => {
    if (!documentId) return
    const saved = libraryStore.getSnapshot().workspace ?? { tabs: [], activeTabId: null }
    libraryStore.setWorkspace({
      ...saved,
      pdfNotes: {
        ...saved.pdfNotes,
        [documentId]: { ...defaultPdfNotes(), ...saved.pdfNotes?.[documentId], ...patch },
      },
    })
  }
  useEffect(() => {
    const pane = activePdf ? 'pdf' : 'note'
    focusDocument(pane)
    setFocusedPane(pane)
  }, [activePdf?.id])
  useEffect(() => {
    const navigate = (event: Event) => {
      try {
        const citation = parsePdfCitation((event as CustomEvent<string>).detail)
        if (!citation) throw Error('This PDF citation is malformed or uses an unsupported version.')
        const { document, changed } = resolvePdfCitation(citation, pdfs.documents)
        setPdfNotesError(
          changed
            ? 'This PDF differs from the quoted revision. The selected region cannot be shown.'
            : '',
        )
        setPdfNavigation({
          documentId: document.id,
          page: citation.page,
          requestId: crypto.randomUUID(),
          regions: changed ? undefined : citation.regions,
        })
        if (document.id !== activePdf?.id) {
          workspace.openPdf(document.id)
          if (companions[document.id]) setPdfPreferences({ open: true }, document.id)
        }
        setPdfPreferences({ pane: 'pdf' }, document.id)
      } catch (error) {
        setPdfNotesError(String(error))
      }
    }
    document.addEventListener('pdf-citation', navigate)
    return () => document.removeEventListener('pdf-citation', navigate)
  })
  const ensureCompanion = async () => {
    if (!activePdf) throw Error('Open a PDF first.')
    const id = await libraryStore.ensurePdfCompanion(activePdf)
    setCompanions((old) => ({ ...old, [activePdf.id]: id }))
    setPdfPreferences({ open: true }, activePdf.id)
    return id
  }
  const takeNotes = async () => {
    setCaptureBusy(true)
    setPdfNotesError('')
    try {
      if (companion?.trashed) {
        libraryStore.setNotes((old) =>
          old.map((n) =>
            n.id === companion.id ? { ...n, trashed: false, updated: Date.now() } : n,
          ),
        )
        setPdfPreferences({ open: true })
      } else if (companion) setPdfPreferences({ open: !notesOpen })
      else await ensureCompanion()
    } catch (error) {
      setPdfNotesError(String(error))
    } finally {
      setCaptureBusy(false)
    }
  }
  const capturePdf = async (page: number, selection?: PdfSelection) => {
    if (!activePdf || captureBusy) return false
    setCaptureBusy(true)
    setPdfNotesError('')
    try {
      const id = await ensureCompanion()
      await libraryStore.load(id)
      const state = libraryStore.getSnapshot()
      const note = state.notes.find((n) => n.id === id)
      if (state.syncing || state.converting || state.quitting)
        throw Error('Wait for the current operation to finish before capturing.')
      if (!note || !state.loaded.has(id))
        throw Error(state.noteErrors[id] || 'Could not load the companion note. Try again.')
      if (
        note.trashed ||
        note.source?.unavailable ||
        note.source?.trashPath ||
        state.conflicts[id] ||
        busyNote === id
      )
        throw Error(
          note.trashed
            ? 'Restore the companion note before capturing.'
            : 'Resolve this note’s file problem before capturing.',
        )
      const editor = getEditor(
        id,
        note.content,
        (content, text) => {
          libraryStore.setNotes((old) =>
            old.map((n) =>
              n.id === id ? { ...n, content, text, updated: Date.now(), hasTasks: undefined } : n,
            ),
          )
        },
        !!note.source,
      )
      const citation = {
        documentId: activePdf.id,
        fingerprint: activePdf.fingerprint,
        page,
        regions: selection?.regions,
      }
      const receipt = appendCapture(editor, citationContent(citation, selection?.text))
      receipt.dispose()
      return true
    } catch (error) {
      setPdfNotesError(String(error))
      return false
    } finally {
      setCaptureBusy(false)
    }
  }
  useEffect(() => {
    void pdfStore.flush().catch(() => {})
  }, [workspace.documentId, workspace.activeTabId])
  const importPdf = async (source?: File) => {
    setPdfImportError('')
    setPdfImporting(true)
    try {
      const chosen =
        source ??
        (await pickFolder({
          directory: false,
          multiple: false,
          title: 'Open PDF',
          filters: [{ name: 'PDF documents', extensions: ['pdf'] }],
        }))
      if (chosen) {
        const doc = await pdfStore.import(chosen)
        workspace.openPdf(doc.id)
      }
    } catch (error) {
      setPdfImportError(String(error))
    } finally {
      setPdfImporting(false)
    }
  }
  const noteListMode = normalizeNoteListMode(library.workspace?.noteListMode)
  const listModeScroll = useRef<number | null>(null)
  useLayoutEffect(() => {
    if (listModeScroll.current !== null && rowsRef.current) {
      rowsRef.current.scrollTop = listModeScroll.current
      listModeScroll.current = null
    }
  }, [noteListMode])
  const changeListMode = (mode: NoteListMode) => {
    if (mode === noteListMode) return
    listModeScroll.current = rowsRef.current?.scrollTop ?? null
    libraryStore.setNoteListMode(mode)
  }
  const listPreferences = library.workspace?.noteLists?.[view]
  const sortMode = listPreferences?.mode ?? 'lastEdited'
  const notesById = useMemo(() => new Map(notes.map((note) => [note.id, note])), [notes])
  const orderedIds = useNoteIds(view, '', listPreferences)
  const filteredIds = useNoteIds(view, query, listPreferences)
  const ordered = useMemo(
    () => orderedIds.map((id) => notesById.get(id)!).filter(Boolean),
    [orderedIds, notesById],
  )
  const filtered = useMemo(
    () => filteredIds.map((id) => notesById.get(id)!).filter(Boolean),
    [filteredIds, notesById],
  )
  const filteredIndexById = useMemo(
    () => new Map(filteredIds.map((id, index) => [id, index])),
    [filteredIds],
  )
  const selected = notes.find(
    (n) => n.id === (activePdf ? (notesOpen ? companionId : undefined) : workspace.noteId),
  )
  const selectedLoaded = useLibrarySelector((state) => !!selected && state.loaded.has(selected.id))
  const active = selectedLoaded ? selected : undefined
  useEffect(() => {
    if (selected) void library.activate(selected.id)
  }, [selected?.id, workspace.activation, selected?.source?.fingerprint, library.converting])
  const pairedDocumentId =
    active && Object.entries(companions).find(([, id]) => id === active.id)?.[0]
  useLayoutEffect(() => {
    if (!pairedDocumentId || !active) return
    const scroll = document.querySelector<HTMLElement>('.note-scroll')
    if (scroll)
      scroll.scrollTop =
        noteScrollPositions.get(active.id) ??
        library.workspace?.pdfNotes?.[pairedDocumentId]?.scroll ??
        0
  }, [pairedDocumentId, activePdf?.id, active?.id, notesOpen])
  const refreshFolder = async (id: string) => {
    setFolderBusy(true)
    setFolderError('')
    try {
      await libraryStore.folderAction('refresh_folder', { id })
      if (selected) await libraryStore.activate(selected.id)
    } catch (error) {
      setFolderError(String(error))
    } finally {
      setFolderBusy(false)
    }
  }
  const locateFolder = async (id: string) => {
    try {
      const path = await pickFolder({
        directory: true,
        multiple: false,
        title: 'Locate linked folder',
      })
      if (path) {
        await libraryStore.folderAction('reselect_folder', { id, path })
        if (selected) await libraryStore.activate(selected.id)
      }
    } catch (error) {
      setFolderError(String(error))
    }
  }
  useEffect(() => {
    const root = notebooks.find((b) => `book:${b.id}` === view)?.rootId
    if (root) void refreshFolder(root)
  }, [view])
  const tags = useLibrarySelector(libraryProjection.tags)
  const headingNotebook = view.startsWith('book:')
    ? notebooks.find((b) => b.id === view.slice(5))
    : undefined
  const title = view.startsWith('book:')
    ? headingNotebook?.name || 'Notebook'
    : view.startsWith('tag:')
      ? `#${view.slice(4)}`
      : viewNames[view]
  const animateRows = useAnimatedItems(
    rowsRef,
    '[data-motion-key]',
    `${view}:${query}`,
    motion.row,
    false,
    true,
  )
  useAnimatedItems(chipsRef, '[data-motion-key]', active?.id ?? '', motion.chip, true)
  const commitOrder = (next: NavigationNote[]) => {
    libraryStore.setNoteList(view, {
      mode: 'custom',
      order: reorderSlots(ordered, next, listPreferences?.order),
    })
  }
  const notebookMove = useNotebookMove(animateRows)
  const drag = useNoteDrag({
    rows: rowsRef,
    resolveRow: (clientY) => virtualRowsRef.current?.hitTest(clientY),
    notes: filtered,
    identity: JSON.stringify([
      view,
      query,
      sortMode,
      sidebar,
      noteList,
      focus,
      organizationOpen,
      notebooks.map((b) => [b.id, b.rootId, b.parentId]),
      filtered.map((n) => [n.id, n.pinned, n.notebookIds, n.trashed, n.source]),
    ]),
    disabled:
      library.quitting ||
      library.syncing ||
      library.converting ||
      !!busyNote ||
      notebookMove.busy ||
      !!notebookMove.failure ||
      organizationOpen,
    animate: animateRows,
    commit: commitOrder,
    resolveTarget: (noteId, destination) => {
      const state = libraryStore.getSnapshot()
      return notebookMoveTarget(
        state.notes.find((n) => n.id === noteId),
        view,
        destination,
        state.notebooks,
      )
    },
    dropNotebook: (noteId, destination) => {
      const state = libraryStore.getSnapshot()
      const note = state.notes.find((n) => n.id === noteId)
      const target = notebookMoveTarget(note, view, destination, state.notebooks)
      if (!note || !target.allowed) return
      const source = moveSource(note, view)
      if (source === undefined) setOrganization({ id: noteId, destination })
      else notebookMove.move({ noteId, destination, source })
    },
  })
  useEffect(() => {
    if (!library.ready || library.syncing || library.converting || library.quitting) return
    const saved = libraryStore.getSnapshot().workspace
    if (!saved?.noteLists) return
    const noteLists = reconcileNoteLists(
      saved.noteLists,
      libraryStore.getSnapshot().notes,
      notebooks.map((book) => book.id),
    )
    if (JSON.stringify(noteLists) !== JSON.stringify(saved.noteLists))
      libraryStore.setWorkspace({ ...saved, noteLists })
  }, [
    library.ready,
    library.syncing,
    library.converting,
    library.quitting,
    library.workspace,
    notes,
    notebooks,
  ])
  const changeSort = (mode: NoteSortMode) => {
    animateRows()
    libraryStore.setNoteList(view, {
      mode,
      order: listPreferences?.order.length
        ? listPreferences.order
        : mode === 'custom'
          ? ordered.map((n) => n.id)
          : [],
    })
  }
  const orderActions = (note: NavigationNote): NoteAction[] =>
    [-1, 1].map((direction) => {
      const index = filteredIndexById.get(note.id) ?? -1
      const target = filtered[index + direction]
      return {
        label: direction < 0 ? 'Move up' : 'Move down',
        icon: direction < 0 ? ArrowUp : ArrowDown,
        separator: direction < 0,
        disabled: index < 0 || !target || target.pinned !== note.pinned,
        run: () => {
          if (target) {
            animateRows()
            commitOrder(moveNote(filtered, note.id, target.id))
          }
        },
      }
    })
  const { update, create: createNote } = useNoteActions(animateRows)
  const navigate = (next: View) => {
    setView(next)
    setQuery('')
    const snapshot = libraryStore.getSnapshot()
    const first = sortNotes(
      snapshot.notes.filter((n) => matchesView(n, next)),
      snapshot.workspace?.noteLists?.[next],
    )[0]
    if (first) workspace.open(first.id, false, { view: next, query: '' })
  }
  const deleteNotebook = async (book: NotebookModel, options: NotebookDeleteOptions) => {
    const result = await libraryStore.deleteNotebook(
      book.id,
      options.includeChildren,
      options.deleteNotes,
    )
    const currentBookId = view.startsWith('book:') ? view.slice(5) : undefined
    if (currentBookId && result.removedIds.includes(currentBookId)) {
      const fallback: View = result.parentId ? `book:${result.parentId}` : 'all'
      navigate(fallback)
      if (
        !libraryStore.getSnapshot().notes.some((note) => matchesView(note, fallback)) &&
        workspace.activeTabId
      )
        workspace.close(workspace.activeTabId)
    }
  }
  const titleInput = useRef<HTMLInputElement>(null)
  const pendingTitleFocus = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (active?.id === pendingTitleFocus.current) {
      // "First line" notes start in the body, which then names the note.
      if (followsFirstLine(active.id)) {
        const note = libraryProjection.note(libraryStore.getSnapshot(), active.id)
        if (note) getEditor(active.id, note.content).commands.focus('start')
      } else titleInput.current?.focus()
      pendingTitleFocus.current = null
    }
  }, [active?.id])
  const addNote = (requestedNotebookId?: string) => {
    const notebookId = typeof requestedNotebookId === 'string' ? requestedNotebookId : undefined
    const noteView: View = notebookId
      ? `book:${notebookId}`
      : view.startsWith('book:') || view.startsWith('tag:')
        ? view
        : 'all'
    if (notebookId) {
      setView(noteView)
      setQuery('')
    }
    const created = createNote(view, notebookId)
    if (!created) return
    const id = created.id
    pendingTitleFocus.current = id
    workspace.open(id, true, {
      view: noteView,
      query: '',
    })
  }
  const currentNoteLinks: NoteLinkContext = {
    contextMenu: (id, position) => {
      if (notes.some((note) => note.id === id && !note.trashed)) setNoteContext({ id, ...position })
    },
    notes: () =>
      libraryStore.getSnapshot().notes.map((n) => ({
        ...n,
        notebook: notebookLabel(n),
      })),
    create: (title) => {
      if (!active || library.quitting || library.syncing || library.converting) return undefined
      const existing = libraryStore
        .getSnapshot()
        .notes.find(
          (n) =>
            !n.trashed && n.title.trim().toLocaleLowerCase() === title.trim().toLocaleLowerCase(),
        )
      if (existing) return { ...existing, notebook: notebookLabel(existing) }
      const created: Note = {
        id: crypto.randomUUID(),
        title: title.trim(),
        notebookIds: [...active.notebookIds],
        quickAccess: false,
        tags: [],
        content: { type: 'doc', content: [{ type: 'paragraph' }] },
        text: '',
        pinned: false,
        trashed: false,
        updated: Date.now(),
      }
      // Enqueue the target before the editor transaction queues its reference.
      setNotes((old) => [...old, created])
      return { ...created, notebook: notebookLabel(created) }
    },
    open: (id, newTab = false) => {
      const target = libraryStore.getSnapshot().notes.find((n) => n.id === id)
      if (!target || target.trashed) {
        setLinkMessage(
          target?.trashed
            ? 'This note is in Trash. Restore it to open this link.'
            : 'This linked note is not available in this library.',
        )
        return
      }
      workspace.open(id, newTab)
    },
  }
  const latestNoteLinks = useRef(currentNoteLinks)
  latestNoteLinks.current = currentNoteLinks
  const noteLinks = useMemo<NoteLinkContext>(
    () => ({
      notes: () => latestNoteLinks.current.notes(),
      create: (title) => latestNoteLinks.current.create(title),
      open: (id, newTab) => latestNoteLinks.current.open(id, newTab),
      contextMenu: (id, position) => latestNoteLinks.current.contextMenu?.(id, position),
    }),
    [notes, notebooks],
  )
  const cursorSettings = useMemo(
    () =>
      motionActive
        ? appearance
        : {
            ...appearance,
            cursorSmoothCaretAnimation: 'off' as const,
            cursorBlinking: 'solid' as const,
          },
    [appearance, motionActive],
  )
  const notebookLabel = (note: Pick<Note, 'notebookIds'>) =>
    notebooks
      .filter((b) => note.notebookIds.includes(b.id))
      .map((b) => notebookPath(b, notebooks))
      .join(', ') || 'Uncategorized'
  const perform = (id: string, operation: () => Promise<void>) => {
    if (library.quitting || library.syncing || library.converting || busyNote) return
    setActionError(null)
    setBusyNote(id)
    void operation()
      .catch((error) =>
        setActionError({ message: String(error), retry: () => perform(id, operation) }),
      )
      .finally(() => setBusyNote(null))
  }
  const updateNotebookMembership = (id: string, patch: Partial<Note>) => {
    const current = notes.find((note) => note.id === id)!
    if (patch.notebookIds?.some((bookId) => notebooks.find((book) => book.id === bookId)?.rootId)) {
      perform(current.id, async () => {
        await libraryStore.activate(current.id)
        const latest = libraryStore.getSnapshot().notes.find((note) => note.id === current.id)!
        if (!current.source) {
          validateMarkdown(latest.content)
          const error = fileTitleError(latest.title || 'Untitled')
          if (error) throw Error(error)
        }
        update(current.id, patch)
        await library.flush()
      })
    } else update(id, patch)
  }
  const actionsFor = (note: NavigationNote): NoteAction[] => {
    const open = {
      label: 'Open in new tab',
      icon: ExternalLink,
      run: () => workspace.open(note.id, true),
    }
    if (note.trashed)
      return [
        open,
        {
          label: 'Restore note',
          icon: RotateCcw,
          separator: true,
          run: () => update(note.id, { trashed: false }),
        },
      ]
    return [
      open,
      {
        label: note.pinned ? 'Unpin' : 'Pin to top',
        icon: note.pinned ? PinOff : Pin,
        shortcutId: 'pin',
        separator: true,
        run: () => update(note.id, { pinned: !note.pinned }),
      },
      {
        label: note.quickAccess ? 'Remove from Quick Access' : 'Add to Quick Access',
        icon: note.quickAccess ? StarOff : Star,
        run: () => update(note.id, { quickAccess: !note.quickAccess }),
      },
      {
        label: 'Duplicate',
        icon: Files,
        shortcutId: 'duplicate',
        separator: true,
        disabled: busyNote !== null,
        run: () =>
          perform(note.id, async () => {
            animateRows()
            const id = await libraryStore.duplicate(note.id)
            if (id) workspace.open(id, true)
          }),
      },
      {
        label: 'Copy link to note',
        icon: Link2,
        shortcutId: 'copy-link',
        disabled: busyNote !== null,
        run: () =>
          perform(note.id, async () => {
            const text = `upnote2://note/${note.id}`
            if (isTauri()) await writeText(text)
            else await navigator.clipboard.writeText(text)
          }),
      },
      {
        label: note.source ? 'Move file to notebook' : 'Move to another notebook',
        icon: FolderInput,
        shortcutId: 'move',
        separator: true,
        run: (launcher) => setOrganization({ id: note.id, launcher }),
      },
      {
        label: 'Add to notebooks',
        icon: FolderPlus,
        run: (launcher) => launcher && openAddToNotebooks(note.id, launcher),
      },
      {
        label: 'Move to trash',
        icon: Trash2,
        shortcutId: 'trash',
        separator: true,
        run: () => update(note.id, { trashed: true }),
      },
    ]
  }
  const cycleTab = (direction: number) => {
    const index = workspace.tabs.findIndex((tab) => tab.id === workspace.activeTabId)
    const tab = workspace.tabs[(index + direction + workspace.tabs.length) % workspace.tabs.length]
    if (tab) workspace.select(tab.id)
  }
  const runNoteAction = (id: string) => {
    if (!active || active.trashed || busyNote) return
    const action = actionsFor(active).find((action) => action.shortcutId === id)
    if (action && !action.disabled) action.run()
  }
  const toggleSidebar = () => {
    if (focus) {
      setFocus(false)
      setSidebar(true)
    } else setSidebar((value) => !value)
  }
  const toggleNoteList = () => {
    if (workspace.documentId) return
    if (focus) {
      setFocus(false)
      setNoteList(true)
    } else setNoteList((value) => !value)
  }
  const shortcutFor = (id: string) => {
    const binding = bindingFor(id, appearance.shortcuts)
    return binding ? shortcutLabel(binding, isTauri()) : undefined
  }
  const syncNow = () => {
    if (!library.syncStatus?.configured) {
      setSettingsCategory('sync')
      setAppearanceOpen(true)
      return
    }
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    void libraryStore.sync()
  }
  const syncConfigured = !!library.syncStatus?.configured
  useEffect(() => {
    if (!syncConfigured || !appearance.autoSyncMinutes) return
    return startAutoSync(appearance.autoSyncMinutes * 60_000, syncNow)
  }, [syncConfigured, appearance.autoSyncMinutes])
  const paletteCommands: PaletteCommand[] = [
    {
      id: 'settings',
      label: 'Open Settings',
      shortcut: shortcutFor('settings'),
      icon: Settings2,
      run: () => setAppearanceOpen(true),
    },
    {
      id: 'new-note',
      label: 'New note',
      shortcut: shortcutFor('new-note'),
      icon: Plus,
      run: () => addNote(),
    },
    {
      id: 'new-notebook',
      label: 'New notebook',
      icon: FolderPlus,
      run: () => {
        setBookParent(undefined)
        setBookEditing(undefined)
        setBookOpen(true)
      },
    },
    ...(pdfs.ready && !pdfImporting
      ? [
          {
            id: 'open-pdf',
            label: 'Open PDF',
            keywords: 'import document',
            icon: FileText,
            run: () => {
              if (isTauri()) void importPdf()
              else pdfInput.current?.click()
            },
          },
        ]
      : []),
    {
      id: 'toggle-sidebar',
      label: 'Toggle sidebar',
      keywords: 'navigation pane',
      shortcut: shortcutFor('sidebar'),
      icon: PanelLeft,
      run: toggleSidebar,
    },
    ...(workspace.documentId
      ? []
      : [
          {
            id: 'toggle-notes-list',
            label: 'Toggle notes list',
            keywords: 'pane',
            icon: Columns2,
            run: toggleNoteList,
          },
        ]),
    ...(active || activePdf
      ? [
          {
            id: 'toggle-focus',
            label: 'Toggle focus mode',
            shortcut: shortcutFor('focus'),
            icon: Maximize2,
            run: () => setFocus((value) => !value),
          },
        ]
      : []),
    {
      id: 'sync',
      label: 'Sync now',
      icon: RefreshCw,
      run: syncNow,
    },
    ...layouts.map((layout) => ({
      id: `layout-${layout}`,
      label: `Layout: ${layoutNames[layout]}`,
      keywords: 'cards panels modern window',
      icon: Columns2,
      checked: appearance.layout === layout,
      run: () => setAppearance({ ...appearance, layout }),
    })),
    ...(Object.entries(colorModes) as [ColorMode, string][]).map(([mode, name]) => ({
      id: `appearance-${mode}`,
      label: `Appearance: ${name}`,
      keywords: 'theme color mode light dark system',
      icon: mode === 'dark' ? Moon : mode === 'light' ? Sun : SunMoon,
      checked: appearance.colorMode === mode,
      run: () => setAppearance({ ...appearance, colorMode: mode }),
    })),
  ]
  useShortcutActions(
    {
      'new-note': addNote,
      settings: () => setAppearanceOpen(true),
      sidebar: toggleSidebar,
      focus: active || activePdf ? () => setFocus((value) => !value) : undefined,
      contents:
        active && (!activePdf || focusedPane === 'note') ? () => toggleContents(true) : undefined,
      editor: active
        ? () => document.querySelector<HTMLElement>('.note-scroll .tiptap')?.focus()
        : undefined,
      title: active
        ? () => document.querySelector<HTMLElement>('[aria-label="Note title"]')?.focus()
        : undefined,
      back: workspace.canBack ? () => workspace.move(-1) : undefined,
      forward: workspace.canForward ? () => workspace.move(1) : undefined,
      'next-tab': () => cycleTab(1),
      'previous-tab': () => cycleTab(-1),
      'close-tab': () => {
        workspace.closeActive()
      },
      pin: () => {
        if (!activePdf || focusedPane === 'note') runNoteAction('pin')
      },
      duplicate: () => {
        if (!activePdf || focusedPane === 'note') runNoteAction('duplicate')
      },
      trash: () => {
        if (!activePdf || focusedPane === 'note') runNoteAction('trash')
      },
      move: () => {
        if (!activePdf || focusedPane === 'note') runNoteAction('move')
      },
      'copy-link': () => {
        if (!activePdf || focusedPane === 'note') runNoteAction('copy-link')
      },
    },
    !library.ready || library.quitting || library.syncing || library.converting,
    appearance.shortcuts ?? {},
  )
  const variables = {
    '--title-font': fontFamily(appearance.titleFont),
    '--note-font': fontFamily(appearance.noteFont),
    '--code-font': fontFamily(appearance.codeFont),
    '--note-size': `${appearance.size}px`,
    '--writing-width': `${appearance.width}%`,
    '--line-spacing': appearance.lineSpacing,
    '--paragraph-spacing': `${appearance.paragraphSpacing}px`,
    '--list-item-spacing': `${appearance.listItemSpacing}px`,
    '--editor-bottom-space': `${appearance.editorBottomSpace}px`,
    ...paneResize.cssVariables,
    ...contentsResize.cssVariables,
    ...headingStyleVariables(appearance.headingStyles, appearance.noteFont),
  } as CSSProperties
  return {
    library,
    notes,
    setNotes,
    notebooks,
    setNotebooks,
    appearance,
    setAppearance,
    motionActive,
    rowsRef,
    virtualRowsRef,
    chipsRef,
    appRef,
    editorWorkspaceRef,
    sidebarView,
    setView,
    view,
    query,
    setQuery,
    filterInput,
    appearanceOpen,
    setAppearanceOpen,
    settingsCategory,
    setSettingsCategory,
    bookOpen,
    setBookOpen,
    bookParent,
    setBookParent,
    bookEditing,
    setBookEditing,
    bookToConvert,
    setBookToConvert,
    bookToDelete,
    setBookToDelete,
    conflictId,
    setConflictId,
    titleDraft,
    setTitleDraft,
    folderError,
    setFolderError,
    folderBusy,
    setFolderBusy,
    focus,
    storeFocus,
    sidebar,
    storeSidebar,
    noteList,
    storeNoteList,
    setFocus,
    setSidebar,
    setNoteList,
    noteMenuOpen,
    setNoteMenuOpen,
    organization,
    storeOrganization,
    addOrganization,
    setAddOrganization,
    organizationOpen,
    setOrganization,
    openAddToNotebooks,
    actionError,
    setActionError,
    busyNote,
    setBusyNote,
    linkMessage,
    setLinkMessage,
    noteContext,
    setNoteContext,
    contentsOpen,
    setContentsOpen,
    contentsLauncher,
    contentsKeyboardOpen,
    toggleContents,
    findOpen,
    setFindOpen,
    matchNavigation,
    setMatchNavigation,
    contentsResize,
    pdfs,
    pdfImportError,
    setPdfImportError,
    pdfImporting,
    setPdfImporting,
    pdfInput,
    workspace,
    noteListVisible,
    paneResize,
    companions,
    setCompanions,
    pdfNotesError,
    setPdfNotesError,
    captureBusy,
    setCaptureBusy,
    pdfNavigation,
    setPdfNavigation,
    focusedPane,
    setFocusedPane,
    activePdf,
    companionId,
    companion,
    pdfPreferences,
    notesOpen,
    pdfNotesLabel,
    setPdfPreferences,
    ensureCompanion,
    takeNotes,
    capturePdf,
    importPdf,
    noteListMode,
    listModeScroll,
    changeListMode,
    listPreferences,
    sortMode,
    notesById,
    orderedIds,
    filteredIds,
    ordered,
    filtered,
    filteredIndexById,
    selected,
    selectedLoaded,
    active,
    pairedDocumentId,
    refreshFolder,
    locateFolder,
    tags,
    headingNotebook,
    title,
    animateRows,
    commitOrder,
    notebookMove,
    drag,
    changeSort,
    orderActions,
    update,
    createNote,
    navigate,
    deleteNotebook,
    titleInput,
    pendingTitleFocus,
    addNote,
    currentNoteLinks,
    latestNoteLinks,
    noteLinks,
    cursorSettings,
    notebookLabel,
    perform,
    updateNotebookMembership,
    actionsFor,
    cycleTab,
    runNoteAction,
    toggleSidebar,
    toggleNoteList,
    shortcutFor,
    syncNow,
    dark,
    paletteCommands,
    variables,
  }
}

export type AppController = ReturnType<typeof useAppController>
