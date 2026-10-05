import AppTooltip from './components/AppTooltip'
import { useDesktopWindowAppearance } from './useDesktopWindowAppearance'
import { PanelRightOpen, PanelRightClose } from 'lucide-react'
import { PdfToolbarButton } from './pdf/PdfTooltip'
import PdfWorkspace from './pdf/PdfWorkspace'
import { currentLocation, defaultPdfNotes, type PdfNotesPreferences } from './workspace'
import { appendCapture } from './pdf/capture'
import {
  citationContent,
  parsePdfCitation,
  resolvePdfCitation,
  type PdfSelection,
} from './pdf/citations'
import type { PdfNavigation } from './pdf/model'
import { focusDocument } from './useShortcuts'
import { pdfStore, usePdfs } from './pdf/store'
import './pdf/pdf.css'
const PdfReader = lazy(() => import('./pdf/PdfViewer'))
function RetainedPdfReader(props: React.ComponentProps<typeof PdfReader>) {
  const [visited, setVisited] = useState(false)
  if (props.active && !visited) setVisited(true)
  return visited || props.active ? <PdfReader {...props} /> : null
}
import {
  sortNotes,
  sortLabels,
  reorderSlots,
  reconcileNoteLists,
  moveNote,
  type NoteSortMode,
} from './noteOrder'
import MoveNoteDialog from './components/MoveNoteDialog'
import { useNotebookMove } from './useNotebookMove'
import { moveSource, notebookMoveTarget } from './notebookMove'
import { useNoteDrag } from './useNoteDrag'
import { useNoteActions } from './useNoteActions'
import { ShortcutContext, useShortcutActions } from './useShortcuts'
import { bindingFor, shortcutLabel } from './shortcuts'
import { validateMarkdown } from './editor/markdown'
import { getEditor, noteScrollPositions } from './editor/session'
import { MotionPresence, motion, useMotionPreference, useAnimatedItems } from './motion'
import { useSmoothScrolling } from './useSmoothScrolling'
import {
  lazy,
  Suspense,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import NoteContextMenu, { type NoteAction } from './components/NoteContextMenu'
import MenuActionContent from './components/MenuActionContent'
import NativeNoteMenuButton from './components/NativeNoteMenuButton'
import { usesNativeContextMenu } from './nativeContextMenu'
import AddToNotebooksPopover, { type PopoverAnchor } from './components/AddToNotebooksPopover'
import NoteOrganization from './components/NoteOrganization'
import * as Dropdown from '@radix-ui/react-dropdown-menu'
import NotebookDialog from './components/NotebookDialog'
import NotebookTree from './components/NotebookTree'
import NotebookDeleteDialog, { type NotebookDeleteOptions } from './components/NotebookDeleteDialog'
import FileConflictDialog from './components/FileConflictDialog'
import { fileTitleError, notebookPath } from './notebooks'
import type { Notebook as NotebookModel } from './model'
import { NotebookIconGlyph } from './notebookIcons'
import { open as pickFolder } from '@tauri-apps/plugin-dialog'
import {
  BookOpen,
  BookPlus,
  Notebook,
  Files,
  CalendarDays,
  ListTodo,
  Inbox,
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
  Search,
  List,
  Plus,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  X,
  Feather,
  FileText,
  ArrowDownWideNarrow,
  FolderInput,
  Check,
  Maximize2,
  Minimize2,
} from './icons'
import { useWorkspace } from './useWorkspace'
import { restoreSidebarView } from './workspace'
import { usePaneResize } from './usePaneResize'
import { useContentsResize } from './useContentsResize'
import NoteTools from './components/NoteTools'
import type { NoteLinkContext } from './editor/noteReferences'
import NotebookConvertDialog from './components/NotebookConvertDialog'
import NoteEditor from './components/NoteEditor'
import Appearance from './components/Appearance'
import AccountMenu from './components/AccountMenu'
import SyncConnection from './components/SyncConnection'
import TitleBar from './components/TitleBar'
import NoteTabs from './components/NoteTabs'
import type { MatchNavigation } from './search'
import { matchesView, type Note, type View } from './model'

import { useLibrary, library as libraryStore } from './storage/useLibrary'
import { fontFamily } from './fonts'
import { headingStyleVariables } from './headingStyles'
const viewNames: Record<string, string> = {
  all: 'All notes',
  today: 'Today',
  todo: 'To-do',
  uncategorized: 'Uncategorized',
  pinned: 'Pinned notes',
  quickAccess: 'Quick Access',
  trash: 'Trash',
}
const noteListDateTime = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

function SidebarSection({
  title,
  action,
  children,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  const [expanded, setExpanded] = useState(true)
  const contentId = useId()

  return (
    <section className="sidebar-section">
      <div className="section-label">
        <button
          type="button"
          className="section-toggle"
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? (
            <ChevronDown size={12} aria-hidden="true" />
          ) : (
            <ChevronRight size={12} aria-hidden="true" />
          )}
          <span>{title}</span>
        </button>
        {action}
      </div>
      <div id={contentId} hidden={!expanded}>
        {children}
      </div>
    </section>
  )
}

export default function App() {
  const library = useLibrary()
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
  useSmoothScrolling(motionActive)
  useLayoutEffect(() => {
    // Document scope includes Radix portals as well as the workspace.
    document.documentElement.dataset.appStyle = appearance.appStyle
    return () => {
      delete document.documentElement.dataset.appStyle
    }
  }, [appearance.appStyle])
  useLayoutEffect(() => {
    // Radix portals mount under <body>, outside the app element that owns the other UI variables.
    document.documentElement.style.setProperty('--ui-font', fontFamily(appearance.uiFont))
    return () => {
      document.documentElement.style.removeProperty('--ui-font')
    }
  }, [appearance.uiFont])
  const rowsRef = useRef<HTMLDivElement>(null)
  const chipsRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<HTMLDivElement>(null)
  const editorWorkspaceRef = useRef<HTMLDivElement>(null)
  useDesktopWindowAppearance(
    appRef,
    library.ready || !!library.startupError,
    library.ready ? appearance.dark : true,
    library.ready ? appearance.theme : 'startup-error',
  )
  const [sidebarView, setView] = useState<View | null>(null)
  const view =
    sidebarView ??
    (library.ready ? restoreSidebarView(library.workspace?.sidebarView, notebooks, notes) : 'all')
  useEffect(() => {
    if (library.ready) libraryStore.setSidebarView(view)
  }, [library.ready, view])
  const [query, setQuery] = useState('')
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
    appRef.current?.style.setProperty('--layout-motion', `${motion.focus}ms`)
    storeFocus(next)
  }
  const setSidebar = (next: boolean | ((old: boolean) => boolean)) => {
    appRef.current?.style.setProperty('--layout-motion', `${motion.sidebar}ms`)
    storeSidebar(next)
  }
  const setNoteList = (next: boolean | ((old: boolean) => boolean)) => {
    appRef.current?.style.setProperty('--layout-motion', `${motion.sidebar}ms`)
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
  const pdfPreferences =
    (activePdf && library.workspace?.pdfNotes?.[activePdf.id]) || defaultPdfNotes()
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
  const listPreferences = library.workspace?.noteLists?.[view]
  const sortMode = listPreferences?.mode ?? 'lastEdited'
  const ordered = sortNotes(
    notes.filter((n) => matchesView(n, view)),
    listPreferences,
  )
  const filtered = ordered.filter((n) =>
    `${n.title} ${n.text}`.toLowerCase().includes(query.toLowerCase()),
  )
  const selected = notes.find(
    (n) => n.id === (activePdf ? (notesOpen ? companionId : undefined) : workspace.noteId),
  )
  const active = selected && library.loaded.has(selected.id) ? selected : undefined
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
  const tags = [...new Set(notes.filter((n) => !n.trashed).flatMap((n) => n.tags))].sort()
  const headingNotebook = view.startsWith('book:')
    ? notebooks.find((b) => b.id === view.slice(5))
    : undefined
  const title = view.startsWith('book:')
    ? headingNotebook?.name || 'Notebook'
    : view.startsWith('tag:')
      ? `#${view.slice(4)}`
      : viewNames[view]
  const animateRows = useAnimatedItems(rowsRef, '[data-motion-key]', `${view}:${query}`, motion.row)
  useAnimatedItems(chipsRef, '[data-motion-key]', active?.id ?? '', motion.chip, true)
  const commitOrder = (next: Note[]) => {
    libraryStore.setNoteList(view, {
      mode: 'custom',
      order: reorderSlots(ordered, next, listPreferences?.order),
    })
  }
  const notebookMove = useNotebookMove(animateRows)
  const drag = useNoteDrag({
    rows: rowsRef,
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
      notes,
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
  const orderActions = (note: Note): NoteAction[] =>
    [-1, 1].map((direction) => {
      const index = filtered.findIndex((n) => n.id === note.id)
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
      titleInput.current?.focus()
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
  const noteLinks: NoteLinkContext = {
    contextMenu: (id, position) => {
      if (notes.some((note) => note.id === id && !note.trashed)) setNoteContext({ id, ...position })
    },
    notes: () =>
      notes.map((n) => ({
        ...n,
        notebook: notebookLabel(n),
      })),
    create: (title) => {
      if (!active || library.quitting || library.syncing || library.converting) return undefined
      const existing = notes.find(
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
      const target = notes.find((n) => n.id === id)
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
  const notebookLabel = (note: Note) =>
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
  const actionsFor = (note: Note): NoteAction[] => {
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
  const syncFailure = !library.error && !library.quitFailed && !!library.syncError
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
        if (workspace.activeTabId) workspace.close(workspace.activeTabId)
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
  const noteMenu =
    active && usesNativeContextMenu() ? (
      <NativeNoteMenuButton
        actions={actionsFor(active)}
        disabled={library.quitting || library.syncing || library.converting}
        onError={setActionError}
      />
    ) : active ? (
      <Dropdown.Root open={noteMenuOpen} onOpenChange={setNoteMenuOpen}>
        <Dropdown.Trigger
          className="icon-button"
          aria-label="Note actions"
          disabled={library.quitting || library.syncing || library.converting}
        >
          <MoreHorizontal size={21} />
        </Dropdown.Trigger>
        {(noteMenuOpen || motionActive) && (
          <Dropdown.Portal>
            <Dropdown.Content
              inert={!noteMenuOpen}
              onCloseAutoFocus={(event) => {
                if (document.querySelector('.notebook-popover')) event.preventDefault()
              }}
              style={{ fontFamily: fontFamily(appearance.uiFont) }}
              className="workspace-action-menu note-actions-menu"
              data-theme={appearance.dark ? 'dark' : 'light'}
              data-palette={appearance.theme}
              sideOffset={7}
              align="end"
              collisionPadding={8}
            >
              {actionsFor(active).map((action) => (
                <div key={action.label}>
                  {action.separator && <Dropdown.Separator />}
                  <Dropdown.Item
                    disabled={
                      library.quitting || library.syncing || library.converting || action.disabled
                    }
                    onSelect={(event) => action.run(event.currentTarget as HTMLElement)}
                  >
                    <MenuActionContent icon={action.icon} label={action.label} />
                    {action.shortcutId && bindingFor(action.shortcutId, appearance.shortcuts) && (
                      <kbd aria-hidden="true">
                        {shortcutLabel(
                          bindingFor(action.shortcutId, appearance.shortcuts),
                          isTauri(),
                        )}
                      </kbd>
                    )}
                  </Dropdown.Item>
                </div>
              ))}
            </Dropdown.Content>
          </Dropdown.Portal>
        )}
      </Dropdown.Root>
    ) : null
  const nav = (id: View, icon: ReactNode, label: string, notebook = false) => {
    const count = notes.filter((note) => matchesView(note, id)).length
    return (
      <button
        key={id}
        className={`nav-item ${view === id ? 'selected' : ''} ${notebook ? 'notebook-nav-item' : ''}`}
        aria-current={view === id ? 'page' : undefined}
        onClick={() => {
          setNoteList(true)
          navigate(id)
        }}
      >
        {icon}
        <span>{label}</span>
        {count > 0 && <small className="notebook-count">{count.toLocaleString('en-US')}</small>}
      </button>
    )
  }
  const variables = {
    '--ui-font': fontFamily(appearance.uiFont),
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
  if (!library.ready)
    return (
      <div ref={appRef} className="storage-startup" data-theme="dark">
        <h2>{library.startupError ? 'Could not open your library' : 'Opening your library…'}</h2>
        {library.startupError && (
          <>
            <p role="alert">{library.startupError}</p>
            <p>Your existing library has not been replaced.</p>
            <button onClick={() => void library.retryOpen()}>Retry</button>
          </>
        )}
      </div>
    )
  return (
    <ShortcutContext.Provider value={appearance.shortcuts ?? {}}>
      <div
        className={`app ${workspace.documentId ? 'pdf-active' : ''} ${focus ? 'focus-mode' : ''} ${!sidebar ? 'no-sidebar' : ''} ${!noteList ? 'no-note-list' : ''} ${contentsOpen ? 'has-contents' : ''} ${paneResize.resizing || contentsResize.resizing ? 'is-resizing' : ''}`}
        ref={appRef}
        data-theme={appearance.dark ? 'dark' : 'light'}
        data-palette={appearance.theme}
        style={variables}
      >
        <TitleBar
          notes={notes}
          notebooks={notebooks}
          appearance={appearance}
          recentNoteIds={library.workspace?.recentNoteIds ?? []}
          readSearchNote={libraryStore.readSearchNote}
          onSelectMatch={(request, newTab) => {
            if (!notes.some((note) => note.id === request.noteId && !note.trashed)) return
            workspace.open(request.noteId, newTab)
            setFocus(false)
            setFindOpen(true)
            setMatchNavigation(request)
          }}
          sidebarVisible={sidebar && !focus}
          noteListVisible={noteListVisible}
          noteListAvailable={!workspace.documentId}
          onToggleNoteList={toggleNoteList}
          disabled={library.quitting || library.syncing || library.converting}
          onToggleSidebar={toggleSidebar}
          onSelect={(id, newTab) => {
            if (!notes.some((note) => note.id === id && !note.trashed)) return
            workspace.open(id, newTab)
            setFocus(false)
          }}
          canBack={workspace.canBack}
          canForward={workspace.canForward}
          onBack={() => workspace.move(-1)}
          onForward={() => workspace.move(1)}
        />
        <MotionPresence
          open={!!(library.error || library.quitFailed || library.syncError)}
          duration={motion.notice}
        >
          <div className="save-error" role="alert">
            <strong>{syncFailure ? 'Couldn’t sync' : 'Couldn’t save'}</strong>
            <span>
              {library.error || (library.quitFailed ? 'Quit was cancelled.' : library.syncError)}
            </span>
            <button
              onClick={() =>
                syncFailure
                  ? syncNow()
                  : void (library.quitFailed
                      ? library.requestQuit()
                      : library.flush().catch(() => {}))
              }
            >
              {syncFailure
                ? library.syncStatus?.configured
                  ? 'Retry sync'
                  : 'Open sync settings'
                : library.quitFailed
                  ? 'Retry and quit'
                  : 'Retry save'}
            </button>
            {library.quitFailed && <button onClick={library.keepEditing}>Keep editing</button>}
          </div>
        </MotionPresence>
        {(library.quitting || library.syncing) && (
          <div className="saving-overlay" role="status">
            {library.syncing ? library.syncProgress : 'Saving before quitting…'}
          </div>
        )}
        <MotionPresence open={!focus && sidebar} duration={motion.sidebar} initial={false}>
          <aside className="sidebar" id="notebook-sidebar">
            <div className="sidebar-content">
              <nav aria-label="Notes navigation">
                {nav('all', <Files />, 'All notes')}
                {nav('today', <CalendarDays />, 'Today')}
                {nav('todo', <ListTodo />, 'To-do')}
                {nav('uncategorized', <Inbox />, 'Uncategorized')}
              </nav>
              <SidebarSection title="Quick access">
                {nav('pinned', <Pin />, 'Pinned notes')}
                {nav('quickAccess', <BookOpen />, 'Quick Access')}
              </SidebarSection>
              <SidebarSection
                title="Notebooks"
                action={
                  <AppTooltip instant label="New notebook">
                    <button
                      className="new-notebook-button"
                      aria-label="New notebook"
                      onClick={() => {
                        setBookParent(undefined)
                        setBookEditing(undefined)
                        setBookOpen(true)
                      }}
                    >
                      <BookPlus size={15} aria-hidden="true" />
                    </button>
                  </AppTooltip>
                }
              >
                <NotebookTree
                  books={notebooks}
                  dropTarget={drag.target}
                  active={view}
                  dark={appearance.dark}
                  palette={appearance.theme}
                  renderBook={(b) =>
                    nav(
                      `book:${b.id}`,
                      <NotebookIconGlyph icon={b.icon} color={b.color} />,
                      b.name,
                      true,
                    )
                  }
                  createNote={(book) => addNote(book.id)}
                  edit={(book) => {
                    setBookParent(undefined)
                    setBookEditing(book)
                    setBookOpen(true)
                  }}
                  deleteNotebook={(book) => setBookToDelete(book)}
                  deleteDisabled={(book) => !!book.rootId}
                  deleteDisabledReason={() => 'Folder-linked notebooks cannot be deleted.'}
                  createChild={(book) => {
                    setBookParent(book)
                    setBookEditing(undefined)
                    setBookOpen(true)
                  }}
                  convert={(book) => setBookToConvert(book)}
                  refresh={(id) => void refreshFolder(id)}
                  reselect={(id) => void locateFolder(id)}
                  disabled={library.quitting || library.syncing || library.converting}
                />
                {folderBusy && (
                  <div role="status" className="folder-message">
                    Refreshing folder…
                  </div>
                )}
                {folderError && (
                  <div role="alert" className="folder-error">
                    {folderError}
                  </div>
                )}
                {library.roots
                  .filter((r) => r.error)
                  .map((root) => (
                    <div className="folder-error" key={root.id}>
                      {root.error}
                      <button className="quiet-button" onClick={() => void locateFolder(root.id)}>
                        Locate folder
                      </button>
                      <button className="quiet-button" onClick={() => void refreshFolder(root.id)}>
                        Retry
                      </button>
                    </div>
                  ))}
                {Object.keys(library.conflicts).length > 0 && (
                  <div className="file-conflict-summary" role="status">
                    File changes need attention
                    {Object.keys(library.conflicts).map((id) => (
                      <button key={id} className="quiet-button" onClick={() => setConflictId(id)}>
                        {notes.find((n) => n.id === id)?.title || 'Untitled'}
                      </button>
                    ))}
                  </div>
                )}
              </SidebarSection>
              <SidebarSection
                title="PDFs"
                action={
                  <AppTooltip
                    instant
                    label="Open PDF"
                    disabled={
                      pdfImporting ||
                      !pdfs.ready ||
                      library.quitting ||
                      library.syncing ||
                      library.converting
                    }
                  >
                    <button
                      className="new-notebook-button"
                      aria-label="Open PDF"
                      disabled={
                        pdfImporting ||
                        !pdfs.ready ||
                        library.quitting ||
                        library.syncing ||
                        library.converting
                      }
                      onClick={() => {
                        if (isTauri()) void importPdf()
                        else pdfInput.current?.click()
                      }}
                    >
                      <BookPlus size={15} aria-hidden="true" />
                    </button>
                  </AppTooltip>
                }
              >
                <input
                  hidden
                  ref={pdfInput}
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) void importPdf(file)
                    event.target.value = ''
                  }}
                />
                {pdfs.documents.map((doc) => (
                  <AppTooltip
                    label={doc.name}
                    disabled={library.quitting || library.syncing || library.converting}
                    key={doc.id}
                  >
                    <button
                      className="pdf-sidebar-row"
                      aria-current={workspace.documentId === doc.id ? 'true' : undefined}
                      disabled={library.quitting || library.syncing || library.converting}
                      onClick={() => workspace.openPdf(doc.id)}
                    >
                      <FileText size={16} />
                      <span>{doc.name}</span>
                      {doc.unavailable && <small>Missing</small>}
                    </button>
                  </AppTooltip>
                ))}
                {!pdfs.documents.length && (
                  <p className="pdf-sidebar-status">Use Open PDF to add a document.</p>
                )}
                {library.preview && (
                  <p className="pdf-sidebar-status">
                    Browser preview · PDFs last for this session only.
                  </p>
                )}
                {pdfImporting && (
                  <p className="pdf-sidebar-status" role="status">
                    Importing PDF…
                  </p>
                )}
                {(pdfImportError || pdfs.error) && (
                  <div className="pdf-sidebar-status" role="alert">
                    {pdfImportError || pdfs.error}
                    {pdfs.error && <button onClick={() => void pdfStore.open()}>Retry</button>}
                  </div>
                )}
              </SidebarSection>
              <SidebarSection title="Tags">
                <div className="tag-list">
                  {tags.map((tag) => (
                    <button
                      className={view === `tag:${tag}` ? 'selected' : ''}
                      key={tag}
                      onClick={() => {
                        setNoteList(true)
                        navigate(`tag:${tag}`)
                      }}
                    >
                      <span>#</span>
                      {tag}
                    </button>
                  ))}
                </div>
              </SidebarSection>
            </div>
            <div className="sidebar-bottom">
              <AccountMenu
                state={library}
                trashCount={notes.filter((note) => matchesView(note, 'trash')).length}
                trashSelected={view === 'trash'}
                dark={appearance.dark}
                palette={appearance.theme}
                settingsTitle="Settings"
                settingsShortcut={shortcutFor('settings')}
                onSync={syncNow}
                onTrash={() => {
                  setNoteList(true)
                  navigate('trash')
                }}
                onSettings={() => {
                  setSettingsCategory('appearance')
                  setAppearanceOpen(true)
                }}
              />
            </div>
          </aside>
        </MotionPresence>
        <section
          className="note-list"
          id="note-list"
          aria-label="Note list"
          hidden={!!workspace.documentId}
          inert={!noteListVisible}
          aria-hidden={!noteListVisible || undefined}
        >
          <header className="list-heading">
            <div>
              <h1>
                {headingNotebook && (
                  <NotebookIconGlyph
                    className="list-heading-icon"
                    icon={headingNotebook.icon}
                    color={headingNotebook.color}
                    size={16}
                    aria-hidden={true}
                  />
                )}
                <AppTooltip label={title}>
                  <span className="list-heading-title">{title}</span>
                </AppTooltip>
                {filtered.length > 0 && (
                  <small className="notebook-count">
                    {filtered.length.toLocaleString('en-US')}
                  </small>
                )}
              </h1>
            </div>
            <AppTooltip
              label={'New note'}
              shortcut={shortcutFor('new-note')}
              disabled={library.quitting || library.syncing || library.converting}
            >
              <button
                type="button"
                className="quiet-button new-note-button"
                aria-label="New note"
                disabled={library.quitting || library.syncing || library.converting}
                onClick={() => addNote()}
              >
                <Plus size={16} aria-hidden="true" />
                <span>New note</span>
              </button>
            </AppTooltip>
          </header>
          <div className="search-box text-field-shell">
            <Search size={15} />
            <input
              className="text-field"
              aria-label="Search notes"
              placeholder="Search your notes…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button aria-label="Clear search" onClick={() => setQuery('')}>
                <X size={14} />
              </button>
            )}
          </div>
          <div className="list-sort">
            <span>{query ? 'Search results' : 'Notes'}</span>
            <Dropdown.Root>
              <AppTooltip
                label="Change note sorting"
                disabled={library.quitting || library.syncing || library.converting}
              >
                <Dropdown.Trigger asChild>
                  <button
                    aria-label="Change note sorting"
                    disabled={library.quitting || library.syncing || library.converting}
                  >
                    {sortLabels[sortMode]}
                    <ArrowDownWideNarrow size={13} />
                  </button>
                </Dropdown.Trigger>
              </AppTooltip>
              <Dropdown.Portal>
                <Dropdown.Content
                  className="workspace-action-menu note-sort-menu"
                  align="end"
                  sideOffset={5}
                  data-theme={appearance.dark ? 'dark' : 'light'}
                  data-palette={appearance.theme}
                  style={{ fontFamily: fontFamily(appearance.uiFont) }}
                >
                  <Dropdown.RadioGroup
                    value={sortMode}
                    onValueChange={(value) => changeSort(value as NoteSortMode)}
                  >
                    {(Object.keys(sortLabels) as NoteSortMode[]).map((mode) => (
                      <Dropdown.RadioItem key={mode} value={mode}>
                        <span className="sort-check">
                          <Dropdown.ItemIndicator>
                            <Check size={14} />
                          </Dropdown.ItemIndicator>
                        </span>
                        {sortLabels[mode]}
                      </Dropdown.RadioItem>
                    ))}
                  </Dropdown.RadioGroup>
                </Dropdown.Content>
              </Dropdown.Portal>
            </Dropdown.Root>
          </div>
          <div
            className="note-rows"
            ref={rowsRef}
            onClickCapture={(event) => {
              if (drag.consumeClick()) {
                event.preventDefault()
                event.stopPropagation()
              }
            }}
          >
            {(drag.preview ?? filtered).map((n) => (
              <NoteContextMenu
                key={n.id}
                actions={[...actionsFor(n), ...orderActions(n)]}
                dark={appearance.dark}
                palette={appearance.theme}
                style={{ fontFamily: fontFamily(appearance.uiFont) }}
                disabled={library.quitting || library.syncing || library.converting}
              >
                <button
                  className={`note-row ${n.id === selected?.id ? 'selected' : ''} ${drag.draggedId === n.id ? 'note-drag-placeholder' : ''}`}
                  key={n.id}
                  data-note-id={n.id}
                  data-motion-key={n.id}
                  onPointerDown={(event) => drag.onPointerDown(event, n.id)}
                  onDragStart={(event) => event.preventDefault()}
                  onClick={(event) => {
                    if (drag.consumeClick()) {
                      event.preventDefault()
                      return
                    }
                    if (event.metaKey || event.ctrlKey) workspace.open(n.id, true)
                    else workspace.preview(n.id)
                  }}
                  onDoubleClick={() => workspace.open(n.id, true)}
                >
                  <span className="note-row-title">
                    {n.pinned && <Pin size={12} />}
                    <span>{n.title || 'Untitled note'}</span>
                  </span>
                  <span className="note-row-meta">{noteListDateTime.format(n.updated)}</span>
                </button>
              </NoteContextMenu>
            ))}
            {!filtered.length && (
              <div className="list-empty">
                <Search size={25} />
                <p>{query ? 'No notes found' : 'Nothing here yet'}</p>
                <small>{query ? 'Try a different word.' : 'Your notes will appear here.'}</small>
              </div>
            )}
          </div>
          <div className="list-footer">
            <BookOpen size={13} />
            <span>{notes.filter((n) => !n.trashed).length} notes</span>
          </div>
        </section>
        {sidebar && !focus && (
          <div {...paneResize.dividerProps('sidebar')} aria-controls="notebook-sidebar" />
        )}
        {noteListVisible && (
          <div {...paneResize.dividerProps('noteList')} aria-controls="note-list" />
        )}
        <main className="writing-pane">
          <NoteTabs
            documents={pdfs.documents}
            notes={notes}
            disabled={library.quitting || library.syncing || library.converting}
            tabs={workspace.tabs.map((tab) => ({
              id: tab.id,
              noteId: tab.entries[tab.index].noteId,
              documentId: tab.entries[tab.index].documentId,
              preview: tab.preview,
            }))}
            activeTabId={workspace.activeTabId}
            onSelectTab={workspace.select}
            onCloseTab={workspace.close}
            onKeepOpenTab={workspace.keepOpen}
          />
          {pdfs.savingError && (
            <div role="alert" className="pdf-message">
              {pdfs.savingError}{' '}
              <button onClick={() => void pdfStore.flush().catch(() => {})}>Retry</button>
            </div>
          )}
          {pdfNotesError && (
            <div role="alert" className="pdf-message">
              {pdfNotesError} <button onClick={() => setPdfNotesError('')}>Dismiss</button>
            </div>
          )}
          <PdfWorkspace
            pdfActive={!!activePdf}
            open={notesOpen}
            preferences={pdfPreferences}
            onPreferences={setPdfPreferences}
            onFocus={setFocusedPane}
            pdf={
              workspace.tabs.some((tab) => currentLocation(tab).kind === 'pdf') ? (
                <>
                  <Suspense
                    fallback={
                      <p role="status" className="pdf-message">
                        Loading PDF viewer…
                      </p>
                    }
                  >
                    {workspace.tabs.flatMap((tab) => {
                      const location = currentLocation(tab)
                      const doc =
                        location.kind === 'pdf'
                          ? pdfs.documents.find((item) => item.id === location.documentId)
                          : undefined
                      if (!doc) return []
                      const active = doc.id === activePdf?.id
                      return (
                        <div key={doc.id} className="pdf-session" hidden={!active}>
                          <RetainedPdfReader
                            active={active}
                            source={pdfStore.source(doc)}
                            reading={doc.reading}
                            target={
                              pdfNavigation?.documentId === doc.id ? pdfNavigation : undefined
                            }
                            onReading={(reading) => pdfStore.reading(doc.id, reading)}
                            registerCapture={pdfStore.capture}
                            contentsWidth={library.workspace?.contentsWidth}
                            onContentsWidth={libraryStore.setContentsWidth}
                            disabled={library.quitting || library.syncing || library.converting}
                            captureDisabled={captureBusy}
                            onCapture={active ? capturePdf : undefined}
                            toolbarActions={
                              active ? (
                                <PdfToolbarButton
                                  className="icon-button"
                                  aria-label={focus ? 'Exit focus mode' : 'Focus mode'}
                                  title={focus ? 'Exit focus mode' : 'Focus mode'}
                                  shortcut={shortcutFor('focus')}
                                  aria-pressed={focus}
                                  onClick={() => setFocus((value) => !value)}
                                >
                                  {focus ? <Minimize2 /> : <Maximize2 />}
                                </PdfToolbarButton>
                              ) : undefined
                            }
                            notesAction={
                              active ? (
                                <PdfToolbarButton
                                  className="icon-button"
                                  aria-label={pdfNotesLabel}
                                  title={pdfNotesLabel}
                                  aria-expanded={notesOpen}
                                  disabled={
                                    captureBusy ||
                                    library.quitting ||
                                    library.syncing ||
                                    library.converting
                                  }
                                  onMouseDown={(event) => event.preventDefault()}
                                  onClick={() => void takeNotes()}
                                >
                                  {companion?.trashed ? (
                                    <RotateCcw />
                                  ) : notesOpen ? (
                                    <PanelRightClose />
                                  ) : (
                                    <PanelRightOpen />
                                  )}
                                </PdfToolbarButton>
                              ) : undefined
                            }
                          />
                        </div>
                      )
                    })}
                  </Suspense>
                </>
              ) : undefined
            }
          >
            <MotionPresence open={!!linkMessage} collapse duration={motion.notice}>
              <div className="note-link-message" role="alert">
                {linkMessage}
                <button onClick={() => setLinkMessage('')}>Dismiss</button>
              </div>
            </MotionPresence>
            <header className="editor-header">
              <div className="breadcrumb">
                {selected && (
                  <>
                    <Notebook size={14} />
                    <AppTooltip label={notebookLabel(selected)}>
                      <span className="breadcrumb-notebook">{notebookLabel(selected)}</span>
                    </AppTooltip>
                    <ChevronRight size={12} />
                    <AppTooltip label={selected.title || 'Untitled note'}>
                      <span className="breadcrumb-title">{selected.title || 'Untitled note'}</span>
                    </AppTooltip>
                  </>
                )}
              </div>
              <div className="header-actions">
                {!activePdf &&
                  active &&
                  Object.entries(companions).some(([, id]) => id === active.id) && (
                    <button
                      className="quiet-button"
                      onClick={() => {
                        const documentId = Object.entries(companions).find(
                          ([, id]) => id === active.id,
                        )![0]
                        workspace.openPdf(documentId)
                        setPdfPreferences({ open: true }, documentId)
                      }}
                    >
                      Open PDF
                    </button>
                  )}
                <AppTooltip
                  instant
                  label={focus ? 'Exit focus mode' : 'Focus mode'}
                  shortcut={shortcutFor('focus')}
                >
                  <button
                    className="icon-button"
                    aria-label={focus ? 'Exit focus mode' : 'Focus mode'}
                    onClick={() => setFocus((v) => !v)}
                  >
                    {focus ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
                  </button>
                </AppTooltip>
                {active && (
                  <>
                    <AppTooltip
                      instant
                      label={active.pinned ? 'Unpin note' : 'Pin note'}
                      shortcut={shortcutFor('pin')}
                    >
                      <button
                        className={`icon-button ${active.pinned ? 'is-pinned' : ''}`}
                        aria-label={active.pinned ? 'Unpin note' : 'Pin note'}
                        onClick={() => update(active.id, { pinned: !active.pinned })}
                      >
                        <Pin size={16} />
                      </button>
                    </AppTooltip>
                  </>
                )}
                <AppTooltip
                  instant
                  label={'Table of contents'}
                  shortcut={shortcutFor('contents')}
                  disabled={!active || library.quitting || library.syncing || library.converting}
                >
                  <button
                    ref={contentsLauncher}
                    className="icon-button"
                    aria-label="Table of contents"
                    aria-pressed={contentsOpen}
                    aria-expanded={contentsOpen}
                    aria-controls="note-contents"
                    disabled={!active || library.quitting || library.syncing || library.converting}
                    onClick={(event) => toggleContents(event.detail === 0)}
                  >
                    <List size={18} />
                  </button>
                </AppTooltip>
                <AppTooltip
                  instant
                  label={'Find in note'}
                  shortcut={shortcutFor('find')}
                  disabled={!active || library.quitting || library.syncing || library.converting}
                >
                  <button
                    className="icon-button"
                    aria-label="Find in note"
                    aria-pressed={findOpen}
                    disabled={!active || library.quitting || library.syncing || library.converting}
                    onClick={() => setFindOpen((value) => !value)}
                  >
                    <Search size={17} />
                  </button>
                </AppTooltip>
                {noteMenu || (
                  <button className="icon-button" aria-label="Note actions" disabled>
                    <MoreHorizontal size={21} />
                  </button>
                )}
              </div>
            </header>
            <div id="note-find-slot" />
            <div
              ref={editorWorkspaceRef}
              className={`editor-workspace ${contentsOpen && active ? 'with-contents' : ''} ${contentsResize.overlay ? 'contents-overlay' : ''}`}
            >
              <div className="editor-document">
                {active ? (
                  <>
                    <div
                      className="note-scroll"
                      key={active.id}
                      data-note-id={active.id}
                      onScroll={(event) => {
                        const scroll = event.currentTarget.scrollTop
                        noteScrollPositions.set(active.id, scroll)
                        if (pairedDocumentId) setPdfPreferences({ scroll }, pairedDocumentId)
                      }}
                    >
                      <MotionPresence open={active.trashed} collapse duration={motion.notice}>
                        <div className="trash-banner">
                          This note is in Trash.
                          <button onClick={() => update(active.id, { trashed: false })}>
                            Restore note
                          </button>
                        </div>
                      </MotionPresence>
                      <article className="note-article">
                        <div className="note-kicker">
                          <span className="tiny-dot" />{' '}
                          {new Date(active.updated).toLocaleDateString('en-US', {
                            month: 'long',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </div>
                        <div className="note-title-wrap">
                          <div className="note-title-highlights" aria-hidden="true" />
                          <input
                            ref={titleInput}
                            className="note-title"
                            aria-label="Note title"
                            placeholder="Untitled note"
                            value={
                              active.source && titleDraft?.id === active.id
                                ? titleDraft.value
                                : active.title
                            }
                            readOnly={
                              !!active.source?.unavailable || !!library.conflicts[active.id]
                            }
                            onChange={(e) => {
                              workspace.keepNoteOpen(active.id)
                              if (active.source)
                                setTitleDraft({ id: active.id, value: e.target.value })
                              else update(active.id, { title: e.target.value })
                            }}
                            onBlur={() => {
                              if (titleDraft?.id === active.id) {
                                if (fileTitleError(titleDraft.value)) return
                                update(active.id, { title: titleDraft.value })
                                setTitleDraft(null)
                              }
                            }}
                            onKeyDown={(e) => {
                              if (
                                !['Enter', 'ArrowDown'].includes(e.key) ||
                                e.nativeEvent.isComposing ||
                                library.syncing ||
                                library.converting ||
                                !!active.source?.unavailable ||
                                !!library.conflicts[active.id] ||
                                !!active.source?.trashPath ||
                                busyNote === active.id ||
                                (active.source &&
                                  titleDraft?.id === active.id &&
                                  !!fileTitleError(titleDraft.value))
                              )
                                return
                              e.preventDefault()
                              getEditor(active.id, active.content).commands.focus('start')
                            }}
                            onScroll={(event) => {
                              const highlights =
                                event.currentTarget.parentElement?.querySelector(
                                  '.note-title-highlights',
                                )
                              if (highlights) highlights.scrollLeft = event.currentTarget.scrollLeft
                            }}
                          />
                        </div>
                        {active.source &&
                          titleDraft?.id === active.id &&
                          fileTitleError(titleDraft.value) && (
                            <p className="folder-error" role="alert">
                              {fileTitleError(titleDraft.value)}
                            </p>
                          )}
                        <div className="note-meta" ref={chipsRef}>
                          <div className="notebook-memberships">
                            {notebooks
                              .filter((book) => active.notebookIds.includes(book.id))
                              .map((book) => (
                                <button
                                  key={book.id}
                                  data-motion-key={`book:${book.id}`}
                                  className="note-tag"
                                  aria-label={
                                    book.rootId
                                      ? `File folder: ${notebookPath(book, notebooks)}`
                                      : `Remove from ${notebookPath(book, notebooks)}`
                                  }
                                  disabled={!!book.rootId}
                                  onClick={() =>
                                    update(active.id, {
                                      notebookIds: active.notebookIds.filter(
                                        (id) => id !== book.id,
                                      ),
                                    })
                                  }
                                >
                                  {notebookPath(book, notebooks)}
                                  {book.rootId ? '' : ' ×'}
                                </button>
                              ))}
                            <button
                              className="note-organization-button"
                              type="button"
                              aria-haspopup="dialog"
                              onClick={(event) =>
                                openAddToNotebooks(active.id, event.currentTarget)
                              }
                            >
                              <Plus size={12} aria-hidden="true" />
                              Add to notebooks
                            </button>
                            <button
                              className="note-organization-button"
                              type="button"
                              aria-haspopup="dialog"
                              data-move-note-id={active.id}
                              onClick={(event) =>
                                setOrganization({ id: active.id, launcher: event.currentTarget })
                              }
                            >
                              <FolderInput size={12} aria-hidden="true" />
                              Move
                            </button>
                          </div>
                        </div>
                        {active.source && (
                          <div className="file-note-banner">
                            <AppTooltip label={active.source.relativePath}>
                              <span>{active.source.relativePath}</span>
                            </AppTooltip>
                            <button
                              className="quiet-button"
                              onClick={() => void libraryStore.activate(active.id)}
                            >
                              Reload file
                            </button>
                          </div>
                        )}
                        {active.source?.unavailable && (
                          <div role="alert" className="folder-error">
                            {active.source.unavailable}
                            <button
                              className="quiet-button"
                              onClick={() => void libraryStore.activate(active.id)}
                            >
                              Retry
                            </button>
                            <button
                              className="quiet-button"
                              onClick={() => void locateFolder(active.source!.rootId)}
                            >
                              Locate folder
                            </button>
                          </div>
                        )}
                        {library.conflicts[active.id] && (
                          <div role="alert" className="file-conflict-summary">
                            This note has conflicting file changes.
                            <button
                              className="quiet-button"
                              onClick={() => setConflictId(active.id)}
                            >
                              Resolve changes
                            </button>
                          </div>
                        )}
                        <NoteEditor
                          appearance={appearance}
                          readOnly={
                            library.quitting ||
                            (!!activePdf && active.trashed) ||
                            library.syncing ||
                            library.converting ||
                            !!active.source?.unavailable ||
                            !!library.conflicts[active.id] ||
                            !!active.source?.trashPath ||
                            busyNote === active.id
                          }
                          key={`${active.id}:${library.syncGeneration}`}
                          note={active}
                          noteLinks={noteLinks}
                          onOpenTag={(tag) => navigate(`tag:${tag}`)}
                          cursorSettings={
                            motionActive
                              ? appearance
                              : {
                                  ...appearance,
                                  cursorSmoothCaretAnimation: 'off',
                                  cursorBlinking: 'solid',
                                }
                          }
                          onChange={(content, text) => {
                            workspace.keepNoteOpen(active.id)
                            update(active.id, { content, text, hasTasks: undefined })
                          }}
                        />
                      </article>
                    </div>
                    <footer className="editor-status">
                      <span>
                        {(active.text.trim()
                          ? active.text.trim().split(/\s+/).length
                          : 0
                        ).toLocaleString('en-US')}{' '}
                        words
                        <span className="status-dot">·</span>
                        {active.text.length.toLocaleString('en-US')} characters
                      </span>
                      <AppTooltip label={library.path} key={library.status}>
                        <span role="status" className="save-status">
                          <Check size={12} />{' '}
                          {library.preview
                            ? 'Browser preview · session only'
                            : Object.keys(library.conflicts).length
                              ? 'File changes need attention'
                              : library.status === 'saved'
                                ? 'Saved on this Mac'
                                : library.status === 'error'
                                  ? 'Couldn’t save'
                                  : 'Saving…'}
                        </span>
                      </AppTooltip>
                    </footer>
                  </>
                ) : selected ? (
                  <div className="note-scroll note-opening-pane">
                    <div className="note-article">
                      <div className="note-kicker">
                        <span className="tiny-dot" />{' '}
                        {new Date(selected.updated).toLocaleDateString('en-US', {
                          month: 'long',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </div>
                    </div>
                    {library.noteErrors[selected.id] ? (
                      <div className="empty-editor">
                        <h2>Could not open this note</h2>
                        <p role="alert">{library.noteErrors[selected.id]}</p>
                        <button onClick={() => void library.load(selected.id)}>Retry</button>
                      </div>
                    ) : (
                      <div className="empty-editor note-opening" role="status" aria-live="polite">
                        <div className="empty-symbol" aria-hidden="true">
                          <Feather size={37} />
                        </div>
                        <h2>Opening note…</h2>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="empty-editor">
                    <div className="empty-symbol">
                      <Feather size={37} />
                    </div>
                    <h2>A little space for a new thought.</h2>
                    <p>
                      {query
                        ? 'Choose a different search, or start something new.'
                        : 'Choose a note from the list, or create your first one.'}
                    </p>
                    <button className="primary-button" onClick={() => addNote()}>
                      <Plus size={16} />
                      New note
                    </button>
                    {!notes.length && (
                      <button className="quiet-button" onClick={library.addSamples}>
                        Add sample notes
                      </button>
                    )}
                    <p role="status">
                      {library.preview
                        ? 'Browser preview · session only'
                        : library.status === 'saved'
                          ? 'Stored on this Mac'
                          : library.status === 'error'
                            ? 'Couldn’t save'
                            : 'Saving…'}
                    </p>
                  </div>
                )}
              </div>
              {active && (
                <NoteTools
                  note={active}
                  contentsOpen={contentsOpen}
                  contentsMode={contentsResize.overlay ? 'overlay' : 'docked'}
                  onContentsOpenChange={setContentsOpen}
                  contentsLauncher={contentsLauncher}
                  focusContentsOnOpen={contentsKeyboardOpen.current}
                  findOpen={findOpen}
                  searchNavigation={matchNavigation}
                  searchNotes={notes}
                  onSearchNavigationComplete={() => setMatchNavigation(null)}
                  onFindOpenChange={setFindOpen}
                  disabled={library.quitting || library.syncing || library.converting}
                  readOnly={
                    !!(
                      active.trashed ||
                      active.source?.unavailable ||
                      library.conflicts[active.id] ||
                      active.source?.trashPath ||
                      busyNote === active.id
                    )
                  }
                  contentsDividerProps={contentsResize.dividerProps}
                />
              )}
            </div>
          </PdfWorkspace>
        </main>
        <MotionPresence open={!!noteContext} duration={motion.menu}>
          <div
            className="workspace-action-menu note-context-menu"
            role="menu"
            style={{
              left: Math.min(noteContext?.x ?? 0, window.innerWidth - 200),
              top: Math.min(noteContext?.y ?? 0, window.innerHeight - 55),
            }}
          >
            <button
              autoFocus
              role="menuitem"
              onClick={() => {
                if (!noteContext) return
                workspace.open(noteContext.id, true)
                setNoteContext(null)
              }}
            >
              Open in new tab
            </button>
          </div>
        </MotionPresence>
        <MotionPresence open={!!actionError} duration={motion.notice}>
          <div className="action-error" role="alert">
            {actionError?.message}
            <button onClick={actionError?.retry}>Retry</button>
            <button onClick={() => setActionError(null)}>Dismiss</button>
          </div>
        </MotionPresence>
        {addOrganization && notes.some((n) => n.id === addOrganization.id && !n.trashed) && (
          <AddToNotebooksPopover
            key={`add:${addOrganization.id}`}
            note={notes.find((n) => n.id === addOrganization.id)!}
            notes={notes}
            notebooks={notebooks}
            appearance={appearance}
            anchor={addOrganization.anchor}
            launcher={addOrganization.launcher}
            update={(patch) => updateNotebookMembership(addOrganization.id, patch)}
            createNotebook={(book) => setNotebooks((old) => [...old, book])}
            close={() => setAddOrganization(null)}
            disabled={library.quitting || library.syncing || library.converting}
          />
        )}
        {drag.draggedId && (
          <div className="move-drag-announcement" role="status" aria-live="polite">
            {drag.target?.hint ?? 'Drag to a notebook to move.'}
          </div>
        )}
        {notebookMove.notice && (
          <div className="notebook-move-notice" role="status" aria-live="polite">
            <span>{notebookMove.notice.message}</span>
            {notebookMove.notice.change && (
              <button
                disabled={
                  notebookMove.busy ||
                  !!notebookMove.failure ||
                  library.syncing ||
                  library.converting ||
                  library.quitting
                }
                onClick={notebookMove.undo}
              >
                Undo
              </button>
            )}
            <button aria-label="Dismiss move notice" onClick={notebookMove.dismiss}>
              <X size={14} />
            </button>
          </div>
        )}
        {notebookMove.busy && (
          <div className="notebook-move-notice" role="status">
            Saving notebook change…
          </div>
        )}
        {notebookMove.failure && (
          <div className="action-error" role="alert">
            {notebookMove.failure.message}
            {notebookMove.failure.retry ? (
              <button
                disabled={
                  notebookMove.busy || library.syncing || library.converting || library.quitting
                }
                onClick={notebookMove.failure.retry}
              >
                Retry
              </button>
            ) : (
              <button onClick={notebookMove.dismissFailure}>Dismiss</button>
            )}
          </div>
        )}
        {organization &&
          organizationOpen &&
          notes.some((n) => n.id === organization.id && !n.trashed && !n.source) && (
            <MoveNoteDialog
              key={`move:${organization.id}:${organization.destination ?? 'choose'}`}
              anchor={organization.anchor}
              launcher={organization.launcher}
              note={notes.find((n) => n.id === organization.id)!}
              notebooks={notebooks}
              appearance={appearance}
              view={organization.view}
              destination={organization.destination}
              move={notebookMove.move}
              createNotebook={(book) => setNotebooks((old) => [...old, book])}
              close={() => setOrganization(null)}
              disabled={
                library.quitting ||
                library.syncing ||
                library.converting ||
                !!busyNote ||
                notebookMove.busy ||
                !!notebookMove.failure
              }
            />
          )}
        {organization && notes.some((n) => n.id === organization.id && !n.trashed && n.source) && (
          <NoteOrganization
            key={`move-file:${organization.id}`}
            anchor={organization.anchor}
            launcher={organization.launcher}
            note={notes.find((n) => n.id === organization.id)!}
            notes={notes}
            notebooks={notebooks}
            appearance={appearance}
            update={(patch) => updateNotebookMembership(organization.id, patch)}
            close={() => setOrganization(null)}
            disabled={library.quitting || library.syncing || library.converting}
          />
        )}
        <Appearance
          initialCategory={settingsCategory}
          syncSettings={appearanceOpen ? <SyncConnection state={library} /> : undefined}
          open={appearanceOpen}
          onOpenChange={setAppearanceOpen}
          value={appearance}
          onChange={setAppearance}
        />
        <NotebookDialog
          open={bookOpen}
          onOpenChange={(open) => {
            setBookOpen(open)
            if (!open) {
              setBookParent(undefined)
              setBookEditing(undefined)
            }
          }}
          parent={bookParent}
          notebook={bookEditing}
          onCreated={(id) => navigate(`book:${id}`)}
          onUpdated={(id, patch) => libraryStore.updateNotebook(id, patch)}
          fontFamily={fontFamily(appearance.uiFont)}
          dark={appearance.dark}
          palette={appearance.theme}
        />
        {bookToDelete && notebooks.some((book) => book.id === bookToDelete.id) && (
          <NotebookDeleteDialog
            open
            notebook={bookToDelete}
            notebooks={notebooks}
            notes={notes}
            appearance={appearance}
            onConfirm={(options) => deleteNotebook(bookToDelete, options)}
            onClose={() => setBookToDelete(null)}
          />
        )}
        {bookToConvert && (
          <NotebookConvertDialog
            notebook={bookToConvert}
            appearance={appearance}
            progress={library.conversionProgress}
            onConfirm={() => libraryStore.convertNotebook(bookToConvert.id)}
            onClose={() => setBookToConvert(null)}
          />
        )}
        <FileConflictDialog
          dark={appearance.dark}
          palette={appearance.theme}
          note={notes.find((n) => n.id === conflictId) ?? null}
          error={conflictId ? (library.conflicts[conflictId] ?? '') : ''}
          onClose={() => setConflictId(null)}
        />
      </div>
    </ShortcutContext.Provider>
  )
}
