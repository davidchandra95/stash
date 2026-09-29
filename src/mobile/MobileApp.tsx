import {
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import MobileSheet from './MobileSheet'
import { addPluginListener, invoke, isTauri } from '@tauri-apps/api/core'
import { platform } from '../platform'
import { onBackButtonPress } from '@tauri-apps/api/app'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Feather,
  Files,
  Menu,
  MoreHorizontal,
  MoreVertical,
  Plus,
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
} from '../icons'
import { useLibrary, library } from '../storage/useLibrary'
import { matchesView, type Note, type Notebook, type View } from '../model'
import { fontFamily } from '../fonts'
import { useMotionPreference } from '../motion'
import { ShortcutContext } from '../useShortcuts'
import { useNoteActions } from '../useNoteActions'
import { notebookPath } from '../notebooks'
import { NotebookIconGlyph } from '../notebookIcons'
import NoteEditor from '../components/NoteEditor'
import NoteTools from '../components/NoteTools'
import NotebookDialog from '../components/NotebookDialog'
import NotebookDeleteDialog from '../components/NotebookDeleteDialog'
import Appearance from '../components/Appearance'
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

  useLayoutEffect(() => {
    document.documentElement.dataset.platform = 'mobile'
    document.documentElement.style.setProperty('--ui-font', fontFamily(appearance.uiFont))
    document.documentElement.dataset.theme = appearance.dark ? 'dark' : 'light'
    document.documentElement.dataset.palette = appearance.theme
    return () => {
      delete document.documentElement.dataset.theme
      delete document.documentElement.dataset.palette
    }
  }, [appearance.uiFont, appearance.dark, appearance.theme])
  useEffect(() => {
    if (!isTauri() || !state.ready || !root.current) return
    const background = getComputedStyle(root.current).getPropertyValue('--surface-editor').trim()
    void invoke('set_mobile_appearance', { dark: appearance.dark, background }).catch((e) =>
      setError(String(e)),
    )
  }, [state.ready, appearance.dark, appearance.theme])
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
    '--ui-font': fontFamily(appearance.uiFont),
    '--title-font': fontFamily(appearance.titleFont),
    '--note-font': fontFamily(appearance.noteFont),
    '--code-font': fontFamily(appearance.codeFont),
    '--note-size': `${appearance.size}px`,
    '--writing-width': '100%',
    '--line-spacing': appearance.lineSpacing,
    '--paragraph-spacing': `${appearance.paragraphSpacing}px`,
    '--list-item-spacing': `${appearance.listItemSpacing}px`,
    '--editor-bottom-space': `${Math.max(112, appearance.editorBottomSpace)}px`,
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
  const bookRow = (book: Notebook, drawer: boolean, depth = 0): ReactNode => (
    <div key={book.id}>
      <div
        className={`mobile-book-row ${route.kind === 'list' && route.view === `book:${book.id}` ? 'selected' : ''}`}
        style={{ paddingInlineStart: depth * 16 }}
      >
        <button className="mobile-book-label" onClick={() => navigate(`book:${book.id}`, !drawer)}>
          <NotebookIconGlyph icon={book.icon} color={book.color} />
          <span>{book.name}</span>
          <small>{notes.filter((n) => matchesView(n, `book:${book.id}`)).length || ''}</small>
        </button>
        {drawer && notebooks.some((b) => b.parentId === book.id) && (
          <button
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
      <main className="storage-startup" data-theme="dark">
        <h2>{state.startupError ? 'Could not open your library' : 'Opening your library…'}</h2>
        {state.startupError && (
          <>
            <p role="alert">{state.startupError}</p>
            <button onClick={() => void state.retryOpen()}>Retry</button>
          </>
        )}
      </main>
    )
  return (
    <ShortcutContext.Provider value={appearance.shortcuts ?? {}}>
      <div
        className="mobile-app"
        ref={root}
        style={variables}
        data-theme={appearance.dark ? 'dark' : 'light'}
        data-palette={appearance.theme}
      >
        <header className={`mobile-header${route.kind === 'note' ? ' mobile-note-header' : ''}`}>
          {route.kind !== 'note' && navigation.routes.length > 1 ? (
            <button aria-label="Back" onClick={back}>
              <ArrowLeft />
            </button>
          ) : (
            <button aria-label="Open navigation" onClick={() => setOverlay({ kind: 'drawer' })}>
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
            <button aria-label="Search notes" onClick={() => setSearchOpen((v) => !v)}>
              <Search />
            </button>
          )}
          {route.kind !== 'settings' && (
            <button
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
              <div className="mobile-search">
                <Search size={18} />
                <input
                  autoFocus
                  className="text-field"
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
                  aria-label="Close search"
                  onClick={() => {
                    dispatch({ type: 'replace', route: { ...route, query: '' } })
                    setSearchOpen(false)
                  }}
                >
                  <X size={20} />
                </button>
              </div>
            )}
            <div className="mobile-list" ref={scroll} key={routeKey}>
              {children.length > 0 && (
                <section aria-label="Sub-notebooks" className="mobile-subnotebooks">
                  {children.map((b) => bookRow(b, false))}
                </section>
              )}
              <section aria-label="Notes">
                {listNotes.map((n) => (
                  <div className="mobile-note-row" key={n.id}>
                    <button className="mobile-note-label" onClick={() => openNote(n.id)}>
                      {n.pinned && <Pin size={15} />}
                      <span>{n.title || 'Untitled note'}</span>
                    </button>
                    <button
                      aria-label={`Actions for ${n.title || 'Untitled note'}`}
                      onClick={() => setOverlay({ kind: 'note-actions', id: n.id })}
                    >
                      <MoreHorizontal size={20} />
                    </button>
                  </div>
                ))}
              </section>
              {!listNotes.length && (
                <div className="mobile-empty">
                  <Feather size={32} />
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
                <Feather size={26} />
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
                    <div className="trash-banner">
                      This note is in Trash.
                      <button onClick={() => noteMutation(active, { trashed: false })}>
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
                />
                {contentsOpen && (
                  <button
                    className="mobile-close-contents"
                    aria-label="Close table of contents"
                    onClick={() => setContentsOpen(false)}
                  >
                    <X />
                  </button>
                )}
              </>
            ) : (
              <div className="mobile-empty">
                <p>
                  {note
                    ? state.noteErrors[note.id] || 'Opening note…'
                    : 'This note is no longer available.'}
                </p>
                {note && state.noteErrors[note.id] && (
                  <button onClick={() => void library.load(note.id)}>Retry</button>
                )}
              </div>
            )}
          </>
        )}
        {route.kind === 'settings' && (
          <Appearance
            open
            onOpenChange={() => back()}
            value={appearance}
            onChange={state.setAppearance}
            syncSettings={
              <>
                <SyncConnection state={state} />
                <button
                  className="primary-button"
                  disabled={blocked || state.preview}
                  onClick={sync}
                >
                  <RefreshCw size={17} /> Sync now
                </button>
                {state.syncStatus?.lastSuccess && (
                  <p>Last sync: {formatSyncTime(state.syncStatus.lastSuccess)}</p>
                )}
                {state.syncStatus?.warnings.map((warning) => (
                  <p key={warning} role="status">
                    {warning}
                  </p>
                ))}
              </>
            }
            mobile={{
              category: route.category,
              onCategory: (category) => push({ kind: 'settings', category }),
            }}
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
            dark={appearance.dark}
            palette={appearance.theme}
          >
            {saveFailure}
            {overlay.kind === 'drawer' ? (
              <>
                <div className="mobile-drawer-scroll">
                  <nav aria-label="Notes navigation">
                    {Object.entries(viewNames)
                      .filter(([key]) => key !== 'trash')
                      .map(([key, label]) => (
                        <button
                          key={key}
                          className={route.kind === 'list' && route.view === key ? 'selected' : ''}
                          onClick={() => navigate(key as View)}
                        >
                          <Files size={20} />
                          <span>{label}</span>
                          <small>
                            {notes.filter((n) => matchesView(n, key as View)).length || ''}
                          </small>
                        </button>
                      ))}
                  </nav>
                  <div className="mobile-section-label">
                    <span>Notebooks</span>
                    <button
                      aria-label="New notebook"
                      onClick={() => {
                        setOverlay(null)
                        setBookDialog({})
                      }}
                    >
                      <Plus size={21} />
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
                        <button key={tag} onClick={() => navigate(`tag:${tag}`)}>
                          <span className="mobile-tag-icon">#</span>
                          <span>{tag}</span>
                        </button>
                      ))}
                  </nav>
                  <nav>
                    <button onClick={() => navigate('trash')}>
                      <Files size={20} />
                      <span>Trash</span>
                    </button>
                  </nav>
                </div>
                <footer className="mobile-drawer-footer">
                  <button disabled={blocked || state.preview} onClick={sync}>
                    <RefreshCw size={21} />
                    <span>Sync</span>
                  </button>
                  <button onClick={() => openSettings()}>
                    <Settings2 size={21} />
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
                      Sort by {route.kind === 'list' && route.sortTitle ? 'last updated' : 'title'}
                    </button>
                    <button
                      onClick={() => {
                        setOverlay(null)
                        setBookDialog(currentBook ? { parent: currentBook } : {})
                      }}
                    >
                      {currentBook ? 'New sub-notebook' : 'New notebook'}
                    </button>
                    {currentBook && (
                      <button
                        onClick={() => setOverlay({ kind: 'book-actions', id: currentBook.id })}
                      >
                        Notebook actions
                      </button>
                    )}
                    <button onClick={() => openSettings()}>Settings</button>
                  </>
                )}
                {overlayBook && (
                  <>
                    <button onClick={() => newNote(overlayBook.id)}>New note</button>
                    <button
                      onClick={() => {
                        setBookDialog({ notebook: overlayBook })
                        setOverlay(null)
                      }}
                    >
                      Edit notebook
                    </button>
                    <button
                      onClick={() => {
                        setBookDialog({ parent: overlayBook })
                        setOverlay(null)
                      }}
                    >
                      New sub-notebook
                    </button>
                    <button
                      className="danger"
                      onClick={() => {
                        setDeleteBook(overlayBook)
                        setOverlay(null)
                      }}
                    >
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
                    {!notebooks.length && <p>Create a notebook from the drawer first.</p>}
                  </>
                )}
                {overlayNote && overlay.kind === 'information' && (
                  <>
                    <p>Updated {new Date(overlayNote.updated).toLocaleString()}</p>
                    <p>
                      {overlayNote.text.trim() ? overlayNote.text.trim().split(/\s+/).length : 0}{' '}
                      words · {overlayNote.text.length} characters
                    </p>
                    <p>
                      {notebooks
                        .filter((b) => overlayNote.notebookIds.includes(b.id))
                        .map((b) => notebookPath(b, notebooks))
                        .join(', ') || 'Uncategorized'}
                    </p>
                  </>
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
            fontFamily={fontFamily(appearance.uiFont)}
            dark={appearance.dark}
            palette={appearance.theme}
            allowFolderLinking={false}
          />
        )}
        {deleteBook && (
          <NotebookDeleteDialog
            open
            notebook={deleteBook}
            notebooks={notebooks}
            notes={notes}
            appearance={appearance}
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
            {state.syncProgress || 'Syncing…'}
          </div>
        )}
      </div>
    </ShortcutContext.Provider>
  )
}
