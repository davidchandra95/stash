import {
  useCallback,
  useEffect,
  useId,
  useState,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
} from 'react'
import { isTauri } from '@tauri-apps/api/core'
import AppTooltip from '../components/AppTooltip'
import NotebookTree from '../components/NotebookTree'
import { NotebookIconGlyph } from '../notebookIcons'
import { libraryProjection } from '../storage/librarySelectors'
import { library as libraryStore, useLibrarySelector } from '../storage/useLibrary'
import { pdfStore } from '../pdf/store'
import type { View } from '../model'
import type { LibraryState } from '../storage/library'
import {
  CalendarDays,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Cloud,
  CloudOff,
  FileText,
  Files,
  Inbox,
  ListTodo,
  Pin,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Star,
  Trash2,
} from '../icons'
import { trackApp, useApp, useBlocked } from './context'
import { SidebarToggle } from './WindowControls'

function Section({
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
    <section className="side-section">
      <div className="side-section-header">
        <button
          type="button"
          className="side-section-toggle"
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => setExpanded((open) => !open)}
        >
          <span>{title}</span>
          <ChevronRight size={11} aria-hidden="true" />
        </button>
        {action}
      </div>
      <div id={contentId} hidden={!expanded}>
        {children}
      </div>
    </section>
  )
}

const fixedViews: View[] = [
  'all',
  'today',
  'todo',
  'uncategorized',
  'pinned',
  'quickAccess',
  'trash',
]
/** Counts are read on render; re-renders only when a shown count changes, not on every edit. */
function useViewCount(notebooks: { id: string }[]) {
  useLibrarySelector(
    useCallback(
      (state: LibraryState) =>
        [...fixedViews, ...notebooks.map((book) => `book:${book.id}` as View)]
          .map((view) => libraryProjection.count(state, view))
          .join(','),
      [notebooks],
    ),
  )
  return (view: View) => libraryProjection.count(libraryStore.getSnapshot(), view)
}

export default trackApp(function Sidebar({
  onSearch,
  ...presence
}: {
  onSearch: () => void
  /** MotionPresence passes its ref, inert and state here; the aside must receive them. */
  ref?: Ref<HTMLElement>
} & HTMLAttributes<HTMLElement>) {
  const app = useApp()
  const blocked = useBlocked()
  const { view, notebooks, pdfs, workspace } = app
  const count = useViewCount(notebooks)
  const showCounts = app.appearance.sidebarCounts

  const select = (next: View) => {
    app.setNoteList(true)
    app.navigate(next)
  }
  const row = (id: View, icon: ReactNode, label: string) => {
    const total = count(id)
    return (
      <button
        key={id}
        className={`side-row ${view === id ? 'is-selected' : ''}`}
        aria-current={view === id ? 'page' : undefined}
        onClick={() => select(id)}
      >
        {icon}
        <span className="side-label">{label}</span>
        {showCounts && total > 0 && <span className="count">{total.toLocaleString('en-US')}</span>}
      </button>
    )
  }
  const newNotebook = () => {
    app.setBookParent(undefined)
    app.setBookEditing(undefined)
    app.setBookOpen(true)
  }
  const openPdf = () => {
    if (isTauri()) void app.importPdf()
    else app.pdfInput.current?.click()
  }
  const pdfDisabled = app.pdfImporting || !pdfs.ready || blocked

  return (
    <aside {...presence} className="sidebar" id="notebook-sidebar" aria-label="Sidebar">
      <div className="pane-bar sidebar-bar" data-tauri-drag-region>
        <span className="window-controls-space" data-tauri-drag-region />
        <SidebarToggle />
      </div>
      <div className="sidebar-scroll">
        <button className="side-row side-search" onClick={onSearch} disabled={blocked}>
          <Search aria-hidden="true" />
          <span className="side-label">Search</span>
          <kbd aria-hidden="true">{app.shortcutFor('quick-open')}</kbd>
        </button>
        <nav aria-label="Notes navigation" className="side-group">
          {row('all', <Files aria-hidden="true" />, 'All notes')}
          {row('today', <CalendarDays aria-hidden="true" />, 'Today')}
          {row('todo', <ListTodo aria-hidden="true" />, 'To-do')}
          {row('uncategorized', <Inbox aria-hidden="true" />, 'Uncategorized')}
        </nav>

        <Section title="Quick access">
          {row('pinned', <Pin aria-hidden="true" />, 'Pinned notes')}
          {row('quickAccess', <Star aria-hidden="true" />, 'Quick Access')}
        </Section>

        <Section
          title="Notebooks"
          action={
            <AppTooltip instant label="New notebook" disabled={blocked}>
              <button
                className="icon-btn icon-btn-sm side-section-action"
                aria-label="New notebook"
                disabled={blocked}
                onClick={newNotebook}
              >
                <Plus aria-hidden="true" />
              </button>
            </AppTooltip>
          }
        >
          <NotebookTree
            books={notebooks}
            dropTarget={app.drag.target}
            active={view}
            renderBook={(book) => {
              const id = `book:${book.id}` as View
              const total = count(id)
              return (
                <button
                  className="side-row-main"
                  aria-current={view === id ? 'page' : undefined}
                  onClick={() => select(id)}
                >
                  <NotebookIconGlyph icon={book.icon} color={book.color} />
                  <span className="side-label">{book.name}</span>
                  {showCounts && total > 0 && (
                    <span className="count">{total.toLocaleString('en-US')}</span>
                  )}
                </button>
              )
            }}
            createNote={(book) => app.addNote(book.id)}
            edit={(book) => {
              app.setBookParent(undefined)
              app.setBookEditing(book)
              app.setBookOpen(true)
            }}
            deleteNotebook={(book) => app.setBookToDelete(book)}
            deleteDisabled={(book) => !!book.rootId}
            deleteDisabledReason={() => 'Folder-linked notebooks cannot be deleted.'}
            createChild={(book) => {
              app.setBookParent(book)
              app.setBookEditing(undefined)
              app.setBookOpen(true)
            }}
            convert={(book) => app.setBookToConvert(book)}
            refresh={(id) => void app.refreshFolder(id)}
            reselect={(id) => void app.locateFolder(id)}
            disabled={blocked}
          />
          {!notebooks.length && <p className="side-hint">No notebooks yet.</p>}
          {app.folderBusy && (
            <p role="status" className="side-hint">
              Refreshing folder…
            </p>
          )}
          {app.folderError && (
            <p role="alert" className="side-hint is-error">
              {app.folderError}
            </p>
          )}
          {app.library.roots
            .filter((root) => root.error)
            .map((root) => (
              <div className="side-hint is-error" role="alert" key={root.id}>
                {root.error}
                <span className="side-hint-actions">
                  <button className="btn-link" onClick={() => void app.locateFolder(root.id)}>
                    Locate folder
                  </button>
                  <button className="btn-link" onClick={() => void app.refreshFolder(root.id)}>
                    Retry
                  </button>
                </span>
              </div>
            ))}
          {Object.keys(app.library.conflicts).length > 0 && (
            <div className="side-hint is-warning" role="status">
              File changes need attention
              <span className="side-hint-actions">
                {Object.keys(app.library.conflicts).map((id) => (
                  <button key={id} className="btn-link" onClick={() => app.setConflictId(id)}>
                    {app.notes.find((n) => n.id === id)?.title || 'Untitled'}
                  </button>
                ))}
              </span>
            </div>
          )}
        </Section>

        <Section
          title="PDFs"
          action={
            <AppTooltip instant label="Open PDF" disabled={pdfDisabled}>
              <button
                className="icon-btn icon-btn-sm side-section-action"
                aria-label="Open PDF"
                disabled={pdfDisabled}
                onClick={openPdf}
              >
                <Plus aria-hidden="true" />
              </button>
            </AppTooltip>
          }
        >
          <input
            hidden
            ref={app.pdfInput}
            type="file"
            accept="application/pdf,.pdf"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void app.importPdf(file)
              event.target.value = ''
            }}
          />
          {pdfs.documents.map((doc) => (
            <AppTooltip label={doc.name} disabled={blocked} key={doc.id}>
              <button
                className={`side-row ${workspace.documentId === doc.id ? 'is-selected' : ''}`}
                aria-current={workspace.documentId === doc.id ? 'true' : undefined}
                disabled={blocked}
                onClick={() => workspace.openPdf(doc.id)}
              >
                <FileText aria-hidden="true" className="ui-icon is-muted" />
                <span className="side-label">{doc.name}</span>
                {doc.unavailable && <span className="count">Missing</span>}
              </button>
            </AppTooltip>
          ))}
          {!pdfs.documents.length && <p className="side-hint">Open a PDF to read and annotate.</p>}
          {app.library.preview && (
            <p className="side-hint">Browser preview · PDFs last for this session only.</p>
          )}
          {app.pdfImporting && (
            <p className="side-hint" role="status">
              Importing PDF…
            </p>
          )}
          {(app.pdfImportError || pdfs.error) && (
            <div className="side-hint is-error" role="alert">
              {app.pdfImportError || pdfs.error}
              {pdfs.error && (
                <span className="side-hint-actions">
                  <button className="btn-link" onClick={() => void pdfStore.open()}>
                    Retry
                  </button>
                </span>
              )}
            </div>
          )}
        </Section>

        {app.tags.length > 0 && (
          <Section title="Tags">
            <div className="side-tags">
              {app.tags.map((tag) => (
                <button
                  className={`chip ${view === `tag:${tag}` ? 'is-selected' : ''}`}
                  aria-current={view === `tag:${tag}` ? 'page' : undefined}
                  key={tag}
                  onClick={() => select(`tag:${tag}`)}
                >
                  #{tag}
                </button>
              ))}
            </div>
          </Section>
        )}
      </div>
      <SidebarFooter />
    </aside>
  )
})

function useNow(interval: number) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), interval)
    return () => window.clearInterval(timer)
  }, [interval])
  return now
}

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
function since(timestamp: number, now: number) {
  const minutes = Math.round((timestamp - now) / 60_000)
  if (minutes > -1) return 'just now'
  if (minutes > -60) return relative.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (hours > -24) return relative.format(hours, 'hour')
  return relative.format(Math.round(hours / 24), 'day')
}

function SidebarFooter() {
  const app = useApp()
  const blocked = useBlocked()
  const now = useNow(30_000)
  const { library } = app
  const { syncError, syncProgress } = useLibrarySelector(
    (state) => ({ syncError: state.syncError, syncProgress: state.syncProgress }),
    (a, b) => a.syncError === b.syncError && a.syncProgress === b.syncProgress,
  )
  const status = library.syncStatus
  const trashCount = libraryProjection.count(libraryStore.getSnapshot(), 'trash')

  let icon: ReactNode = <CloudOff aria-hidden="true" />
  let label = 'Sync is off'
  let tone = ''
  if (library.preview) {
    icon = <Cloud aria-hidden="true" />
    label = 'Browser preview'
  } else if (library.syncing) {
    icon = <RefreshCw aria-hidden="true" className="ui-icon spinner" />
    label = syncProgress || 'Syncing…'
  } else if (syncError) {
    icon = <CircleAlert aria-hidden="true" />
    label = 'Couldn’t sync'
    tone = 'is-error'
  } else if (status?.configured) {
    icon = <CircleCheck aria-hidden="true" />
    tone = 'is-ok'
    label = status.pending
      ? `${status.pending.toLocaleString('en-US')} changes to sync`
      : status.lastSuccess
        ? `Synced ${since(status.lastSuccess, now)}`
        : 'Not synced yet'
  }

  return (
    <div className="sidebar-footer">
      <AppTooltip label={library.preview ? 'Browser previews do not sync' : 'Sync now'}>
        <button
          className={`sync-status ${tone}`}
          disabled={library.preview || blocked}
          onClick={app.syncNow}
        >
          {icon}
          <span className="truncate">{label}</span>
        </button>
      </AppTooltip>
      <AppTooltip instant label={trashCount ? `Trash (${trashCount})` : 'Trash'}>
        <button
          className="icon-btn"
          aria-label="Trash"
          aria-pressed={app.view === 'trash'}
          disabled={blocked}
          onClick={() => {
            app.setNoteList(true)
            app.navigate('trash')
          }}
        >
          <Trash2 aria-hidden="true" />
        </button>
      </AppTooltip>
      <AppTooltip instant label="Settings" shortcut={app.shortcutFor('settings')}>
        <button
          className="icon-btn"
          aria-label="Settings"
          disabled={blocked}
          onClick={() => {
            app.setSettingsCategory('appearance')
            app.setAppearanceOpen(true)
          }}
        >
          <Settings aria-hidden="true" />
        </button>
      </AppTooltip>
    </div>
  )
}
