import { useDocumentTheme } from '../appearance'
import {
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import AppTooltip from '../components/AppTooltip'
import NoteListNotebook from '../components/NoteListNotebook'
import VirtualNoteRows from '../components/VirtualNoteRows'
import {
  normalizeNoteListMode,
  noteListModes,
  notePreview,
  noteNotebookContext,
  type NoteListMode,
} from '../noteListPresentation'
import MobileSheet from './MobileSheet'
import { addPluginListener, invoke, isTauri } from '@tauri-apps/api/core'
import { platform } from '../platform'
import { onBackButtonPress } from '@tauri-apps/api/app'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import {
  ArrowDownWideNarrow,
  ArrowLeft,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Feather,
  FilePlus2,
  Files,
  FolderPlus,
  Inbox,
  ListTodo,
  Menu,
  MoreHorizontal,
  MoreVertical,
  BookPlus,
  PenLine,
  Search,
  Settings2,
  X,
  Pin,
  PinOff,
  Star,
  StarOff,
  BookOpen,
  Copy,
  Link,
  List,
  Info,
  Trash2,
  ArchiveRestore,
  RefreshCw,
  type IconComponent,
} from '../icons'
import { useLibrary, library } from '../storage/useLibrary'
import { matchesView, type Note, type Notebook, type View } from '../model'
import { fontFamily } from '../fonts'
import { headingStyleVariables } from '../headingStyles'
import { useMotionPreference } from '../motion'
import { ShortcutContext } from '../useShortcuts'
import { useNoteActions } from '../useNoteActions'
import { notebookPath } from '../notebooks'
import { NotebookIconGlyph } from '../notebookIcons'
import NoteEditor from '../components/NoteEditor'
import NoteTools from '../components/NoteTools'
import NotebookDialog from '../components/NotebookDialog'
import NotebookDeleteDialog from '../components/NotebookDeleteDialog'
import MobileSettings from './MobileSettings'
import SyncConnection from '../components/SyncConnection'
import { formatSyncTime } from '../syncTime'
import { getEditor } from '../editor/session'
import {
  initialNavigation,
  mobileNavigation,
  type MobileRoute,
  type SettingsCategory,
} from './navigation'

const viewNames: Record<string, string> = {
  all: 'All notes',
  today: 'Today',
  todo: 'To-do',
  uncategorized: 'Uncategorized',
  pinned: 'Pinned notes',
  quickAccess: 'Quick Access',
  trash: 'Trash',
}
// The drawer mirrors the desktop sidebar's views and icons.
const viewIcons: Record<string, IconComponent> = {
  all: Files,
  today: CalendarDays,
  todo: ListTodo,
  uncategorized: Inbox,
  pinned: Pin,
  quickAccess: Star,
  trash: Trash2,
}
const categoryNames = {
  appearance: 'Appearance',
  typography: 'Typography',
  editor: 'Editor',
  sync: 'Sync',
}
type Overlay =
  | { kind: 'drawer' | 'list-actions' }
  | { kind: 'note-actions' | 'organization' | 'information'; id: string }
  | { kind: 'book-actions'; id: string }

export default function MobileApp() {
  const state = useLibrary()
  const { notes, notebooks, appearance } = state
  const actions = useNoteActions()
  const [navigation, dispatch] = useReducer(mobileNavigation, undefined, initialNavigation)
  const route = navigation.routes.at(-1)!
  const [overlay, setOverlay] = useState<Overlay | null>(null)
  const [bookDialog, setBookDialog] = useState<{ parent?: Notebook; notebook?: Notebook } | null>(
    null,
  )
  const [deleteBook, setDeleteBook] = useState<Notebook | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [findOpen, setFindOpen] = useState(false)
  const [contentsOpen, setContentsOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const keyboardVisible = useRef(false)
  const scroll = useRef<HTMLDivElement>(null)
  const titleInput = useRef<HTMLTextAreaElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const note = route.kind === 'note' ? notes.find((n) => n.id === route.id) : undefined
  const active = note && state.loaded.has(note.id) ? note : undefined
  const blocked = busy || state.syncing || state.converting
  const noteListMode = normalizeNoteListMode(state.workspace?.noteListMode)
  const listModeScroll = useRef<number | null>(null)
  const listModeFocus = useRef(false)
  useLayoutEffect(() => {
    if (listModeScroll.current !== null && scroll.current) {
      scroll.current.scrollTop = listModeScroll.current
      listModeScroll.current = null
    }
    if (listModeFocus.current && !overlay) {
      root.current?.querySelector<HTMLButtonElement>('[aria-label="Page actions"]')?.focus()
      listModeFocus.current = false
    }
  }, [noteListMode, overlay])
  const changeListMode = (mode: NoteListMode) => {
    listModeFocus.current = true
    if (mode !== noteListMode) {
      listModeScroll.current = scroll.current?.scrollTop ?? null
      library.setNoteListMode(mode)
    }
    setOverlay(null)
  }
  useMotionPreference(appearance.animationsEnabled)

  useEffect(() => {
    const element = document.documentElement
    const pointer = () => {
      element.dataset.mobileFocusInput = 'pointer'
    }
    const keyboard = () => {
      element.dataset.mobileFocusInput = 'keyboard'
    }
    document.addEventListener('pointerdown', pointer, true)
    document.addEventListener('keydown', keyboard, true)
    return () => {
      document.removeEventListener('pointerdown', pointer, true)
      document.removeEventListener('keydown', keyboard, true)
      delete element.dataset.mobileFocusInput
    }
  }, [])

  // Color mode and accent live on <html>, so sheets and dialogs share them.
  const dark = useDocumentTheme(appearance)
  useLayoutEffect(() => {
    document.documentElement.dataset.platform = 'mobile'
  }, [])
  useEffect(() => {
    if (!isTauri() || !state.ready) return
    // The Android system bars match the content surface behind the app bar.
    const background = getComputedStyle(document.documentElement)
      .getPropertyValue('--bg-content')
      .trim()
    void invoke('set_mobile_appearance', { dark, background }).catch((e) => setError(String(e)))
  }, [state.ready, dark])
  useEffect(() => {
    const viewport = window.visualViewport
    const update = () => {
      document.documentElement.style.setProperty(
        '--mobile-height',
        `${viewport?.height ?? window.innerHeight}px`,
      )
      document.documentElement.style.setProperty('--mobile-top', `${viewport?.offsetTop ?? 0}px`)
      document.documentElement.style.setProperty(
        '--mobile-bottom',
        `${Math.max(0, window.innerHeight - (viewport?.height ?? window.innerHeight) - (viewport?.offsetTop ?? 0))}px`,
      )
    }
    update()
    viewport?.addEventListener('resize', update)
    viewport?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    return () => {
      viewport?.removeEventListener('resize', update)
      viewport?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [])
  useEffect(() => {
    if (note) void library.activate(note.id)
  }, [note?.id, state.syncGeneration])
  const routeKey =
    route.kind === 'note'
      ? `note:${route.id}`
      : route.kind === 'list'
        ? `list:${route.view}`
        : `settings:${route.category ?? ''}`
  useLayoutEffect(() => {
    if (scroll.current) scroll.current.scrollTop = 'scroll' in route ? route.scroll : 0
    setFindOpen(false)
    setContentsOpen(false)
  }, [routeKey, active?.id])
  useLayoutEffect(() => {
    const resize = () => {
      const input = titleInput.current
      if (input) {
        input.style.height = '0'
        input.style.height = `${input.scrollHeight}px`
      }
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [active?.title, active?.id])
  useEffect(() => {
    if (route.kind === 'note' && route.focusTitle && active && !blocked && titleInput.current) {
      titleInput.current.focus()
      if (isTauri())
        void invoke('set_mobile_keyboard', { visible: true }).catch((e) => setError(String(e)))
      dispatch({ type: 'replace', route: { ...route, focusTitle: false } })
    }
  }, [route, active?.id, blocked])

  useEffect(() => {
    if (!active) return
    const keepCaretVisible = () =>
      requestAnimationFrame(() => {
        const editor = getEditor(active.id, active.content)
        if (editor.isFocused) editor.commands.scrollIntoView()
        else if (document.activeElement === titleInput.current)
          titleInput.current?.scrollIntoView({ block: 'nearest' })
      })
    window.addEventListener('resize', keepCaretVisible)
    window.visualViewport?.addEventListener('resize', keepCaretVisible)
    return () => {
      window.removeEventListener('resize', keepCaretVisible)
      window.visualViewport?.removeEventListener('resize', keepCaretVisible)
    }
  }, [active?.id])

  const capture = () => {
    if ('scroll' in route)
      dispatch({
        type: 'replace',
        route: { ...route, scroll: scroll.current?.scrollTop ?? route.scroll },
      })
  }
  const perform = async (run: () => void | Promise<void>, close = true) => {
    if (busyRef.current || state.syncing || state.converting) return
    busyRef.current = true
    setBusy(true)
    setError('')
    try {
      await library.flush()
      await run()
      if (close) setOverlay(null)
    } catch (e) {
      setError(String(e))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }
  const push = (next: MobileRoute) =>
    void perform(() => {
      capture()
      dispatch({ type: 'push', route: next })
    })
  const navigate = (view: View, nested = false) =>
    void perform(() => {
      if (nested) {
        capture()
        dispatch({
          type: 'push',
          route: { kind: 'list', view, query: '', scroll: 0, sortTitle: false },
        })
      } else dispatch({ type: 'library', view })
      setSearchOpen(false)
    })
  const openNote = (id: string) => push({ kind: 'note', id, scroll: 0 })
  const newNote = (notebookId?: string) =>
    void perform(() => {
      const view = route.kind === 'list' ? route.view : 'all'
      const created = actions.create(view, notebookId)
      if (created) {
        capture()
        dispatch({
          type: 'push',
          route: { kind: 'note', id: created.id, focusTitle: true, scroll: 0 },
        })
      }
    })
  const openSettings = (category?: SettingsCategory) =>
    void perform(() => {
      capture()
      dispatch({ type: 'push', route: { kind: 'settings' } })
      if (category) dispatch({ type: 'push', route: { kind: 'settings', category } })
    })
  const sync = () => {
    if (!state.syncStatus?.configured) {
      openSettings('sync')
      return
    }
    void perform(async () => {
      await library.sync()
    })
  }
  const closeKeyboard = () => {
    if (isTauri() && !keyboardVisible.current) return false
    const element = document.activeElement
    if (
      element instanceof HTMLElement &&
      (element.isContentEditable || element.matches('input, textarea'))
    ) {
      element.blur()
      if (isTauri())
        void invoke('set_mobile_keyboard', { visible: false }).catch((e) => setError(String(e)))
      return true
    }
    return false
  }
  const back = () => {
    if (blocked) return
    if (closeKeyboard()) return
    if (document.querySelector('.rich-menu')) {
      active &&
        getEditor(active.id, active.content).view.dom.dispatchEvent(new Event('writing-dismiss'))
      return
    }
    // Let nested Radix controls dismiss before their owning sheet.
    const nestedMenu = document.querySelector('[role="menu"]')
    if (nestedMenu) {
      nestedMenu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      return
    }
    if (bookDialog || deleteBook) {
      setBookDialog(null)
      setDeleteBook(null)
      return
    }
    if (overlay) {
      setOverlay(null)
      return
    }
    if (findOpen || contentsOpen) {
      setFindOpen(false)
      setContentsOpen(false)
      return
    }
    void perform(async () => {
      if (navigation.routes.length > 1) dispatch({ type: 'back' })
      else if (isTauri()) await invoke('mobile_background')
    })
  }
  const backRef = useRef(back)
  backRef.current = back
  useEffect(() => {
    if (!isTauri()) return
    const registration = onBackButtonPress(() => backRef.current())
    return () => {
      void registration.then((listener) => listener.unregister())
    }
  }, [])
  useEffect(() => {
    if (!isTauri() || platform.platform !== 'android') return
    const registration = addPluginListener<{ visible: boolean }>(
      'stash-platform',
      'keyboard',
      (event) => {
        keyboardVisible.current = event.visible
      },
    )
    return () => {
      void registration.then((listener) => listener.unregister())
    }
  }, [])
  const headingNotebook =
    route.kind === 'list' && route.view.startsWith('book:')
      ? notebooks.find((b) => b.id === route.view.slice(5))
      : undefined
  const title =
    route.kind === 'list'
      ? route.view.startsWith('book:')
        ? (headingNotebook?.name ?? 'Notebook')
        : route.view.startsWith('tag:')
          ? `#${route.view.slice(4)}`
          : viewNames[route.view]
      : route.kind === 'settings'
        ? route.category
          ? categoryNames[route.category]
          : 'Settings'
        : ''
  const variables = {
    '--title-font': fontFamily(appearance.titleFont),
    '--note-font': fontFamily(appearance.noteFont),
    '--code-font': fontFamily(appearance.codeFont),
    '--note-size': `${appearance.size}px`,
    '--writing-width': '100%',
    '--line-spacing': appearance.lineSpacing,
    '--paragraph-spacing': `${appearance.paragraphSpacing}px`,
    '--list-item-spacing': `${appearance.listItemSpacing}px`,
    '--editor-bottom-space': `${Math.max(112, appearance.editorBottomSpace)}px`,
    ...headingStyleVariables(appearance.headingStyles, appearance.noteFont),
  } as CSSProperties
  const listNotes =
    route.kind === 'list'
      ? notes
          .filter(
            (n) =>
              matchesView(n, route.view) &&
              `${n.title} ${n.text}`.toLocaleLowerCase().includes(route.query.toLocaleLowerCase()),
          )
          .sort(
            (a, b) =>
              Number(b.pinned) - Number(a.pinned) ||
              (route.sortTitle ? a.title.localeCompare(b.title) : b.updated - a.updated),
          )
      : []
  const children =
    route.kind === 'list' && route.view.startsWith('book:')
      ? notebooks.filter((book) => book.parentId === route.view.slice(5))
      : []
  const currentBook =
    route.kind === 'list' && route.view.startsWith('book:')
      ? notebooks.find((b) => b.id === route.view.slice(5))
      : undefined
  const overlayNote =
    overlay && 'id' in overlay ? notes.find((n) => n.id === overlay.id) : undefined
  const overlayBook =
    overlay?.kind === 'book-actions' ? notebooks.find((b) => b.id === overlay.id) : undefined
  const count = (view: View) =>
    (appearance.sidebarCounts && notes.filter((n) => matchesView(n, view)).length) || ''
  const bookRow = (book: Notebook, drawer: boolean, depth = 0): ReactNode => (
    <div key={book.id}>
      <div
        className={`mobile-book-row ${route.kind === 'list' && route.view === `book:${book.id}` ? 'selected' : ''}`}
        style={{ paddingInlineStart: depth * 16 }}
      >
        <button
          className="mobile-book-label"
          aria-current={
            route.kind === 'list' && route.view === `book:${book.id}` ? 'page' : undefined
          }
          onClick={() => navigate(`book:${book.id}`, !drawer)}
        >
          <NotebookIconGlyph icon={book.icon} color={book.color} />
          <span>{book.name}</span>
          <small className="count">{count(`book:${book.id}`)}</small>
        </button>
        {drawer && notebooks.some((b) => b.parentId === book.id) && (
          <button
            className="icon-btn"
            aria-label={`${collapsed.has(book.id) ? 'Expand' : 'Collapse'} ${book.name}`}
            aria-expanded={!collapsed.has(book.id)}
            onClick={() =>
              setCollapsed((old) => {
                const next = new Set(old)
                next.has(book.id) ? next.delete(book.id) : next.add(book.id)
                return next
              })
            }
          >
            {collapsed.has(book.id) ? <ChevronRight size={20} /> : <ChevronDown size={20} />}
          </button>
        )}
        <button
          className="icon-btn"
          aria-label={`Actions for ${book.name}`}
          onClick={() => setOverlay({ kind: 'book-actions', id: book.id })}
        >
          <MoreHorizontal size={20} />
        </button>
      </div>
      {drawer &&
        !collapsed.has(book.id) &&
        notebooks.filter((b) => b.parentId === book.id).map((b) => bookRow(b, true, depth + 1))}
    </div>
  )
  const viewRow = (view: View, label: string, showCount = true) => {
    const Icon = viewIcons[view]
    const selected = route.kind === 'list' && route.view === view
    return (
      <button
        key={view}
        className={selected ? 'selected' : ''}
        aria-current={selected ? 'page' : undefined}
        onClick={() => navigate(view)}
      >
        <Icon aria-hidden="true" />
        <span>{label}</span>
        {showCount && <small className="count">{count(view)}</small>}
      </button>
    )
  }
  const noteMutation = (n: Note, patch: Partial<Note>) =>
    void perform(async () => {
      actions.update(n.id, patch)
      await library.flush()
    })
  const noteLinks = {
    notes: () =>
      notes.map((n) => ({
        ...n,
        notebook: notebooks
          .filter((b) => n.notebookIds.includes(b.id))
          .map((b) => b.name)
          .join(', '),
      })),
    create: (name: string) => {
      const existing = notes.find(
        (n) => !n.trashed && n.title.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase(),
      )
      const created = existing ?? actions.create('all', active?.notebookIds[0], name.trim())
      return created ? { ...created, notebook: '' } : undefined
    },
    open: (id: string) => {
      const target = notes.find((n) => n.id === id)
      if (!target || target.trashed) {
        setError('This linked note is unavailable or in Trash.')
        return
      }
      openNote(id)
    },
  }
  const saveFailure = (error || state.error || state.syncError) && (
    <div className="mobile-error" role="alert">
      <span>{error || state.error || state.syncError}</span>
      <button
        className="btn btn-sm"
        onClick={() =>
          void perform(async () => {
            if (state.syncError && !state.error) await library.sync()
            else await library.flush()
          }, false)
        }
      >
        Retry
      </button>
    </div>
  )
  if (!state.ready)
    return (
      <main className="startup">
        <h2>{state.startupError ? 'Couldn’t open your library' : 'Opening your library…'}</h2>
        {state.startupError && (
          <>
            <p role="alert">{state.startupError}</p>
            <button className="btn" onClick={() => void state.retryOpen()}>
              Retry
            </button>
          </>
        )}
      </main>
    )
  return (
    <ShortcutContext.Provider value={appearance.shortcuts ?? {}}>
      <div className="mobile-app" ref={root} style={variables}>
        <header className={`mobile-header${route.kind === 'note' ? ' mobile-note-header' : ''}`}>
          {route.kind !== 'note' && navigation.routes.length > 1 ? (
            <button className="icon-btn" aria-label="Back" onClick={back}>
              <ArrowLeft />
            </button>
          ) : (
            <button
              className="icon-btn"
              aria-label="Open navigation"
              onClick={() => setOverlay({ kind: 'drawer' })}
            >
              <Menu />
            </button>
          )}
          {route.kind !== 'note' && (
            <h1>
              {headingNotebook && (
                <NotebookIconGlyph
                  className="mobile-heading-icon"
                  icon={headingNotebook.icon}
                  color={headingNotebook.color}
                  size={18}
                  aria-hidden={true}
                />
              )}
              <span className="mobile-heading-title">{title || 'Stash'}</span>
            </h1>
          )}
          {route.kind === 'list' && (
            <button
              className="icon-btn"
              aria-label="Search notes"
              aria-pressed={searchOpen || !!route.query}
              onClick={() => setSearchOpen((v) => !v)}
            >
              <Search />
            </button>
          )}
          {route.kind !== 'settings' && (
            <button
              className="icon-btn"
              aria-label={route.kind === 'note' ? 'Note actions' : 'Page actions'}
              disabled={blocked}
              onClick={() =>
                setOverlay(
                  route.kind === 'note'
                    ? { kind: 'note-actions', id: route.id }
                    : { kind: 'list-actions' },
                )
              }
            >
              {route.kind === 'note' ? <MoreVertical /> : <MoreHorizontal />}
            </button>
          )}
        </header>
        {!overlay && saveFailure}
        {route.kind === 'list' && (
          <>
            {(searchOpen || route.query) && (
              <label className="field-shell mobile-search">
                <Search aria-hidden="true" />
                <input
                  autoFocus
                  aria-label="Search notes"
                  placeholder="Search notes…"
                  value={route.query}
                  onChange={(e) =>
                    dispatch({
                      type: 'replace',
                      route: { ...route, query: e.target.value, scroll: 0 },
                    })
                  }
                />
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Close search"
                  onClick={() => {
                    dispatch({ type: 'replace', route: { ...route, query: '' } })
                    setSearchOpen(false)
                  }}
                >
                  <X aria-hidden="true" />
                </button>
              </label>
            )}
            <div className="mobile-list" ref={scroll} key={routeKey}>
              {children.length > 0 && (
                <section aria-label="Sub-notebooks" className="mobile-subnotebooks">
                  {children.map((b) => bookRow(b, false))}
                </section>
              )}
              <section aria-label="Notes">
                <VirtualNoteRows
                  items={listNotes}
                  scrollRef={scroll}
                  initialOffset={route.scroll}
                  retainedIds={[overlay?.kind === 'note-actions' ? overlay.id : undefined]}
                  // Row heights from mobile.css; All notes adds the notebook context line.
                  estimatedSize={
                    route.view === 'all'
                      ? noteListMode === 'preview'
                        ? 78
                        : 57
                      : noteListMode === 'preview'
                        ? 59
                        : 56
                  }
                  geometryKey={`${noteListMode}:${route.view}`}
                  renderRow={(n) => {
                    const context =
                      route.view === 'all' ? noteNotebookContext(n, notebooks) : undefined
                    const preview = noteListMode === 'preview' ? notePreview(n.text) : undefined
                    return (
                      <div className="mobile-note-row" key={n.id} data-note-id={n.id}>
                        <AppTooltip label={context?.description}>
                          <button
                            className="mobile-note-label"
                            aria-label={n.title || 'Untitled note'}
                            aria-description={
                              [preview, context?.description].filter(Boolean).join('. ') ||
                              undefined
                            }
                            onClick={() => openNote(n.id)}
                          >
                            <span className="mobile-note-copy">
                              <span className="mobile-note-title">
                                {n.pinned && <Pin aria-hidden="true" />}
                                <span>{n.title || 'Untitled note'}</span>
                              </span>
                              {preview && <span className="note-list-preview">{preview}</span>}
                              {context && <NoteListNotebook context={context} />}
                            </span>
                          </button>
                        </AppTooltip>
                        <button
                          className="icon-btn"
                          aria-label={`Actions for ${n.title || 'Untitled note'}`}
                          onClick={() => setOverlay({ kind: 'note-actions', id: n.id })}
                        >
                          <MoreHorizontal aria-hidden="true" />
                        </button>
                      </div>
                    )
                  }}
                />
              </section>
              {!listNotes.length && (
                <div className="mobile-empty">
                  <Feather aria-hidden="true" className="mobile-empty-icon" />
                  <h2>{route.query ? 'No matching notes' : 'A little space for a new thought'}</h2>
                  <p>
                    {route.query
                      ? 'Try another search.'
                      : 'Tap the pencil to write your first note.'}
                  </p>
                </div>
              )}
              {state.preview && <p className="mobile-preview">Browser preview · session only</p>}
            </div>
            {route.view !== 'trash' && (
              <button
                className="mobile-compose"
                aria-label="New note"
                disabled={blocked}
                onClick={() => newNote()}
              >
                <Feather aria-hidden="true" />
              </button>
            )}
          </>
        )}
        {route.kind === 'note' && (
          <>
            <div id="note-find-slot" />
            {active ? (
              <>
                <div className="note-scroll mobile-note-scroll" ref={scroll} key={active.id}>
                  {active.trashed && (
                    <div className="pane-banner">
                      <span>This note is in Trash.</span>
                      <button
                        className="btn btn-sm"
                        onClick={() => noteMutation(active, { trashed: false })}
                      >
                        Restore note
                      </button>
                    </div>
                  )}
                  <article className="note-article">
                    <div className="note-title-wrap">
                      <div className="note-title-highlights" aria-hidden="true" />
                      <textarea
                        rows={1}
                        ref={titleInput}
                        className="note-title"
                        aria-label="Note title"
                        placeholder="Untitled note"
                        value={active.title}
                        disabled={blocked || active.trashed}
                        enterKeyHint="next"
                        onChange={(e) =>
                          actions.update(active.id, { title: e.target.value.replace(/\n/g, ' ') })
                        }
                        onKeyDown={(e) => {
                          if (
                            ['Enter', 'ArrowDown'].includes(e.key) &&
                            !e.nativeEvent.isComposing
                          ) {
                            e.preventDefault()
                            getEditor(active.id, active.content).commands.focus('start')
                          }
                        }}
                      />
                    </div>
                    <NoteEditor
                      note={active}
                      readOnly={blocked || active.trashed}
                      appearance={appearance}
                      cursorSettings={appearance}
                      noteLinks={noteLinks}
                      onOpenTag={(tag) => navigate(`tag:${tag}`, true)}
                      onChange={(content, text) =>
                        actions.update(active.id, { content, text, hasTasks: undefined })
                      }
                    />
                  </article>
                </div>
                <NoteTools
                  note={active}
                  contentsOpen={contentsOpen}
                  findOpen={findOpen}
                  onFindOpenChange={setFindOpen}
                  disabled={blocked}
                  readOnly={!!active.trashed}
                  contentsMode="overlay"
                  onContentsOpenChange={setContentsOpen}
                />
              </>
            ) : (
              <div className="mobile-empty">
                <p>
                  {note
                    ? state.noteErrors[note.id] || 'Opening note…'
                    : 'This note is no longer available.'}
                </p>
                {note && state.noteErrors[note.id] && (
                  <button className="btn" onClick={() => void library.load(note.id)}>
                    Retry
                  </button>
                )}
              </div>
            )}
          </>
        )}
        {route.kind === 'settings' && (
          <MobileSettings
            value={appearance}
            onChange={state.setAppearance}
            syncSettings={<SyncConnection state={state} />}
            onSync={sync}
            syncDisabled={blocked || state.preview}
            category={route.category}
            onCategory={(category) => push({ kind: 'settings', category })}
          />
        )}
        {overlay && (
          <MobileSheet
            title={
              overlay.kind === 'drawer'
                ? 'Stash'
                : overlay.kind === 'organization'
                  ? 'Notebooks'
                  : overlay.kind === 'information'
                    ? 'Note information'
                    : overlay.kind === 'book-actions'
                      ? (overlayBook?.name ?? 'Notebook')
                      : overlay.kind === 'list-actions'
                        ? title
                        : overlayNote?.title || 'Untitled note'
            }
            close={() => setOverlay(null)}
            drawer={overlay.kind === 'drawer'}
          >
            {saveFailure}
            {overlay.kind === 'drawer' ? (
              <>
                <div className="mobile-drawer-scroll">
                  <nav aria-label="Notes navigation">
                    {Object.entries(viewNames)
                      .filter(([key]) => key !== 'trash')
                      .map(([key, label]) => viewRow(key as View, label))}
                  </nav>
                  <div className="mobile-section-label">
                    <span>Notebooks</span>
                    <button
                      className="icon-btn"
                      aria-label="New notebook"
                      onClick={() => {
                        setOverlay(null)
                        setBookDialog({})
                      }}
                    >
                      <BookPlus aria-hidden="true" />
                    </button>
                  </div>
                  <nav aria-label="Notebooks">
                    {notebooks.filter((b) => !b.parentId).map((b) => bookRow(b, true))}
                  </nav>
                  <div className="mobile-section-label">Tags</div>
                  <nav aria-label="Tags">
                    {[...new Set(notes.filter((n) => !n.trashed).flatMap((n) => n.tags))]
                      .sort()
                      .map((tag) => (
                        <button
                          key={tag}
                          className={
                            route.kind === 'list' && route.view === `tag:${tag}` ? 'selected' : ''
                          }
                          aria-current={
                            route.kind === 'list' && route.view === `tag:${tag}`
                              ? 'page'
                              : undefined
                          }
                          onClick={() => navigate(`tag:${tag}`)}
                        >
                          <span className="mobile-tag-icon" aria-hidden="true">
                            #
                          </span>
                          <span>{tag}</span>
                        </button>
                      ))}
                  </nav>
                  <nav aria-label="Trash">{viewRow('trash', viewNames.trash, false)}</nav>
                </div>
                <footer className="mobile-drawer-footer">
                  <button disabled={blocked || state.preview} onClick={sync}>
                    <RefreshCw aria-hidden="true" />
                    <span>Sync</span>
                  </button>
                  <button onClick={() => openSettings()}>
                    <Settings2 aria-hidden="true" />
                    <span>Settings</span>
                  </button>
                  {state.syncStatus?.lastSuccess && (
                    <small>Last sync: {formatSyncTime(state.syncStatus.lastSuccess)}</small>
                  )}
                </footer>
              </>
            ) : (
              <div className="mobile-sheet-actions">
                {overlay.kind === 'list-actions' && (
                  <>
                    <button
                      onClick={() => {
                        if (route.kind === 'list')
                          dispatch({
                            type: 'replace',
                            route: { ...route, sortTitle: !route.sortTitle },
                          })
                        setOverlay(null)
                      }}
                    >
                      <ArrowDownWideNarrow aria-hidden="true" />
                      Sort by {route.kind === 'list' && route.sortTitle ? 'last updated' : 'title'}
                    </button>
                    <fieldset className="mobile-list-modes" disabled={blocked || state.quitting}>
                      <legend>Note list view</legend>
                      {(Object.keys(noteListModes) as NoteListMode[]).map((mode) => (
                        <label key={mode}>
                          <input
                            className="checkbox"
                            type="radio"
                            name="note-list-mode"
                            value={mode}
                            checked={noteListMode === mode}
                            onChange={() => changeListMode(mode)}
                          />
                          {noteListModes[mode]}
                        </label>
                      ))}
                    </fieldset>
                    <button
                      onClick={() => {
                        setOverlay(null)
                        setBookDialog(currentBook ? { parent: currentBook } : {})
                      }}
                    >
                      {currentBook ? (
                        <FolderPlus aria-hidden="true" />
                      ) : (
                        <BookPlus aria-hidden="true" />
                      )}
                      {currentBook ? 'New sub-notebook' : 'New notebook'}
                    </button>
                    {currentBook && (
                      <button
                        onClick={() => setOverlay({ kind: 'book-actions', id: currentBook.id })}
                      >
                        <MoreHorizontal aria-hidden="true" />
                        Notebook actions
                      </button>
                    )}
                    <button onClick={() => openSettings()}>
                      <Settings2 aria-hidden="true" />
                      Settings
                    </button>
                  </>
                )}
                {overlayBook && (
                  <>
                    <button onClick={() => newNote(overlayBook.id)}>
                      <FilePlus2 aria-hidden="true" />
                      New note
                    </button>
                    <button
                      onClick={() => {
                        setBookDialog({ notebook: overlayBook })
                        setOverlay(null)
                      }}
                    >
                      <PenLine aria-hidden="true" />
                      Edit notebook
                    </button>
                    <button
                      onClick={() => {
                        setBookDialog({ parent: overlayBook })
                        setOverlay(null)
                      }}
                    >
                      <FolderPlus aria-hidden="true" />
                      New sub-notebook
                    </button>
                    <button
                      className="danger"
                      onClick={() => {
                        setDeleteBook(overlayBook)
                        setOverlay(null)
                      }}
                    >
                      <Trash2 aria-hidden="true" />
                      Delete notebook
                    </button>
                  </>
                )}
                {overlayNote &&
                  overlay.kind === 'note-actions' &&
                  (overlayNote.trashed ? (
                    <button onClick={() => noteMutation(overlayNote, { trashed: false })}>
                      <ArchiveRestore aria-hidden="true" />
                      Restore note
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => noteMutation(overlayNote, { pinned: !overlayNote.pinned })}
                      >
                        {overlayNote.pinned ? (
                          <PinOff aria-hidden="true" />
                        ) : (
                          <Pin aria-hidden="true" />
                        )}
                        {overlayNote.pinned ? 'Unpin' : 'Pin to top'}
                      </button>
                      <button
                        onClick={() =>
                          noteMutation(overlayNote, { quickAccess: !overlayNote.quickAccess })
                        }
                      >
                        {overlayNote.quickAccess ? (
                          <StarOff aria-hidden="true" />
                        ) : (
                          <Star aria-hidden="true" />
                        )}
                        {overlayNote.quickAccess
                          ? 'Remove from Quick Access'
                          : 'Add to Quick Access'}
                      </button>
                      <button
                        onClick={() => setOverlay({ kind: 'organization', id: overlayNote.id })}
                      >
                        <BookOpen aria-hidden="true" />
                        Notebooks
                      </button>
                      <button
                        onClick={() =>
                          void perform(async () => {
                            const id = await actions.duplicate(overlayNote.id)
                            if (id) {
                              capture()
                              dispatch({ type: 'push', route: { kind: 'note', id, scroll: 0 } })
                            }
                          })
                        }
                      >
                        <Copy aria-hidden="true" />
                        Duplicate
                      </button>
                      <button
                        onClick={() =>
                          void perform(async () => {
                            const text = `upnote2://note/${overlayNote.id}`
                            if (isTauri()) await writeText(text)
                            else await navigator.clipboard.writeText(text)
                          })
                        }
                      >
                        <Link aria-hidden="true" />
                        Copy link to note
                      </button>
                      {active?.id === overlayNote.id && (
                        <>
                          <button
                            onClick={() => {
                              setOverlay(null)
                              setFindOpen(true)
                            }}
                          >
                            <Search aria-hidden="true" />
                            Find in note
                          </button>
                          <button
                            onClick={() => {
                              setOverlay(null)
                              setContentsOpen(true)
                            }}
                          >
                            <List aria-hidden="true" />
                            Table of contents
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => setOverlay({ kind: 'information', id: overlayNote.id })}
                      >
                        <Info aria-hidden="true" />
                        Note information
                      </button>
                      <button
                        className="danger"
                        onClick={() => noteMutation(overlayNote, { trashed: true })}
                      >
                        <Trash2 aria-hidden="true" />
                        Move to trash
                      </button>
                    </>
                  ))}
                {overlayNote && overlay.kind === 'organization' && (
                  <>
                    {notebooks.map((book) => (
                      <label className="mobile-membership" key={book.id}>
                        <input
                          className="checkbox"
                          type="checkbox"
                          checked={overlayNote.notebookIds.includes(book.id)}
                          disabled={blocked}
                          onChange={(e) =>
                            void perform(async () => {
                              actions.update(overlayNote.id, {
                                notebookIds: e.target.checked
                                  ? [...overlayNote.notebookIds, book.id]
                                  : overlayNote.notebookIds.filter((id) => id !== book.id),
                              })
                              await library.flush()
                            }, false)
                          }
                        />
                        <NotebookIconGlyph icon={book.icon} color={book.color} />
                        <span>{notebookPath(book, notebooks)}</span>
                      </label>
                    ))}
                    {!notebooks.length && (
                      <p className="mobile-sheet-note">Create a notebook from the drawer first.</p>
                    )}
                  </>
                )}
                {overlayNote && overlay.kind === 'information' && (
                  <dl className="mobile-info">
                    <div>
                      <dt>Updated</dt>
                      <dd>{new Date(overlayNote.updated).toLocaleString()}</dd>
                    </div>
                    <div>
                      <dt>Length</dt>
                      <dd>
                        {overlayNote.text.trim() ? overlayNote.text.trim().split(/\s+/).length : 0}{' '}
                        words · {overlayNote.text.length} characters
                      </dd>
                    </div>
                    <div>
                      <dt>Notebooks</dt>
                      <dd>
                        {notebooks
                          .filter((b) => overlayNote.notebookIds.includes(b.id))
                          .map((b) => notebookPath(b, notebooks))
                          .join(', ') || 'Uncategorized'}
                      </dd>
                    </div>
                  </dl>
                )}
              </div>
            )}
          </MobileSheet>
        )}
        {bookDialog && (
          <NotebookDialog
            open
            onOpenChange={(open) => {
              if (!open) setBookDialog(null)
            }}
            {...bookDialog}
            onCreated={(id) => navigate(`book:${id}`)}
            onUpdated={state.updateNotebook}
            allowFolderLinking={false}
          />
        )}
        {deleteBook && (
          <NotebookDeleteDialog
            open
            notebook={deleteBook}
            notebooks={notebooks}
            notes={notes}
            onClose={() => setDeleteBook(null)}
            onConfirm={async (options) => {
              const result = await library.deleteNotebook(
                deleteBook.id,
                options.includeChildren,
                options.deleteNotes,
              )
              dispatch({
                type: 'library',
                view: result.parentId ? `book:${result.parentId}` : 'all',
              })
              setDeleteBook(null)
            }}
          />
        )}
        {state.syncing && (
          <div className="mobile-busy" role="status">
            <span>
              <RefreshCw aria-hidden="true" className="ui-icon spinner" />
              {state.syncProgress || 'Syncing…'}
            </span>
          </div>
        )}
      </div>
    </ShortcutContext.Provider>
  )
}
