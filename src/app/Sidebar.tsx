import { displayZone, subscribeDisplayZone } from '../projects/schedule'
import {
  Fragment,
  useCallback,
  useId,
  useState,
  useSyncExternalStore,
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
import ProjectRing from '../projects/ProjectRing'
import {
  health,
  healthLabel,
  isOpenProject,
  progress,
  today,
  nextSevenDaysGroups,
  taskTags,
  todayGroups,
  type Task,
} from '../projects/model'
import type { View } from '../model'
import TagChip from '../components/TagChip'
import NoteContextMenu from '../components/NoteContextMenu'
import {
  sectionVisible,
  setSidebarItemHidden,
  type SidebarItem,
  type SidebarSection,
} from '../sidebarLayout'
import type { LibraryState } from '../storage/library'
import {
  CalendarDays,
  ChevronRight,
  FileText,
  Files,
  Inbox,
  Briefcase,
  Calendar,
  CalendarClock,
  CircleCheck,
  Trash2,
  ListTodo,
  Pin,
  Plus,
  Search,
  Star,
  EyeOff,
  Settings,
} from '../icons'
import { trackApp, useApp, useBlocked } from './context'
import { SidebarToggle } from './WindowControls'

function Section({
  title,
  action,
  onHide,
  children,
}: {
  title: string
  action?: ReactNode
  /** Adds Hide Section and Customize Sidebar to the header's context menu. */
  onHide?: () => void
  children: ReactNode
}) {
  const app = useApp()
  const [expanded, setExpanded] = useState(true)
  const contentId = useId()
  const header = (
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
  )
  return (
    <section className="side-section">
      {onHide ? (
        <NoteContextMenu
          disabled={false}
          actions={[
            { label: 'Hide Section', icon: EyeOff, run: onHide },
            {
              label: 'Customize Sidebar…',
              icon: Settings,
              run: () => app.setAppearanceOpen(true),
            },
          ]}
        >
          {header}
        </NoteContextMenu>
      ) : (
        header
      )}
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
  ...presence
}: {
  /** MotionPresence passes its ref, inert and state here; the aside must receive them. */
  ref?: Ref<HTMLElement>
} & HTMLAttributes<HTMLElement>) {
  const app = useApp()
  const blocked = useBlocked()
  const { notebooks, pdfs, workspace } = app
  // While a project page is open, no notes view is selected.
  const view: View | '' = app.projectView ? '' : app.view
  const count = useViewCount(notebooks)
  const showCounts = app.appearance.sidebarCounts

  const select = (next: View) => {
    app.setNoteList(true)
    app.navigate(next)
  }
  /** `tone` colors the view icon in themes that tint them. */
  const row = (id: View, icon: ReactNode, label: string, tone: string) => {
    const total = count(id)
    return (
      <button
        key={id}
        className={`side-row ${view === id ? 'is-selected' : ''}`}
        data-tone={tone}
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

  const hidden = app.appearance.sidebarHidden
  const shows = (id: SidebarItem) => !hidden.includes(id)
  const hide = (id: SidebarItem) => () =>
    app.setAppearance({
      ...app.appearance,
      sidebarHidden: setSidebarItemHidden(hidden, id, true),
    })
  const sections: Record<SidebarSection, () => ReactNode> = {
    quick: () => (
      <Section title="Quick access" onHide={hide('quick')}>
        {shows('pinned') && row('pinned', <Pin aria-hidden="true" />, 'Pinned notes', 'gold')}
        {shows('quickAccess') &&
          row('quickAccess', <Star aria-hidden="true" />, 'Quick Access', 'purple')}
      </Section>
    ),
    notebooks: () => (
      <Section
        title="Notebooks"
        onHide={hide('notebooks')}
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
    ),
    pdfs: () => (
      <Section
        title="PDFs"
        onHide={hide('pdfs')}
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
    ),
    tags: () =>
      app.tags.length > 0 && (
        <Section title="Tags" onHide={hide('tags')}>
          <div className="side-tags">
            {app.tags.map((tag) => (
              <TagChip
                key={tag}
                tag={tag}
                selected={view === `tag:${tag}`}
                appearance={app.appearance}
                setAppearance={app.setAppearance}
                onSelect={() => select(`tag:${tag}`)}
              />
            ))}
          </div>
        </Section>
      ),
  }

  return (
    <aside {...presence} className="sidebar" id="notebook-sidebar" aria-label="Sidebar">
      <div className="pane-bar side-bar" data-tauri-drag-region>
        <h2 className="side-bar-title" data-tauri-drag-region>
          {app.domain === 'projects' ? 'Projects' : 'Notes'}
        </h2>
      </div>
      <div className="sidebar-scroll">
        {app.domain === 'projects' ? (
          <ProjectsNavigation />
        ) : (
          <>
            <nav aria-label="Notes navigation" className="side-group">
              {row('all', <Files aria-hidden="true" />, 'All notes', 'indigo')}
              {shows('today') &&
                row('today', <CalendarDays aria-hidden="true" />, 'Today', 'orange')}
              {shows('todo') && row('todo', <ListTodo aria-hidden="true" />, 'To-do', 'green')}
              {shows('uncategorized') &&
                row('uncategorized', <Inbox aria-hidden="true" />, 'Uncategorized', 'slate')}
            </nav>

            {app.appearance.sidebarOrder
              .filter((id) => sectionVisible(hidden, id))
              .map((id) => (
                <Fragment key={id}>{sections[id]()}</Fragment>
              ))}
          </>
        )}
      </div>
    </aside>
  )
})

function ProjectsNavigation() {
  useSyncExternalStore(subscribeDisplayZone, displayZone)
  const app = useApp()
  const blocked = useBlocked()
  const [othersOpen, setOthersOpen] = useState(false)
  const { projects, tasks, ready, error } = app.projects
  const showCounts = app.appearance.sidebarCounts
  const hidden = app.appearance.sidebarHidden
  const live = projects.filter((project) => project.deletedAt === null)
  const tasksOf = new Map<string | null, Task[]>()
  for (const task of tasks)
    if (task.deletedAt === null)
      tasksOf.set(task.projectId, [...(tasksOf.get(task.projectId) ?? []), task])
  const inboxOpen = (tasksOf.get(null) ?? []).filter(
    (task) => task.status === 'todo' || task.status === 'doing',
  ).length
  const others = live.filter((project) => !isOpenProject(project))
  const tags = taskTags(tasks)
  const current = today()
  const dueTodayGroups = todayGroups(tasks, current)
  const overdueCount = dueTodayGroups.find((g) => g.id === 'overdue')?.tasks.length ?? 0
  const openIn = (groups: { tasks: Task[] }[]) =>
    groups.reduce(
      (sum, group) =>
        sum + group.tasks.filter((t) => t.status === 'todo' || t.status === 'doing').length,
      0,
    )
  /** `tone` colors the view icon like the notes views; `countClass` marks late or attention counts. */
  const pageRow = (
    id: string,
    icon: ReactNode,
    label: string,
    tone: string,
    total: number,
    countClass = '',
    countTitle?: string,
  ) => (
    <button
      className={`side-row ${app.projectView === id ? 'is-selected' : ''}`}
      data-tone={tone}
      aria-current={app.projectView === id ? 'page' : undefined}
      disabled={blocked || !ready}
      onClick={() => app.openProject(id)}
    >
      {icon}
      <span className="side-label">{label}</span>
      {showCounts && total > 0 && (
        <span className={`count ${countClass}`} title={countTitle}>
          {total}
        </span>
      )}
    </button>
  )
  const attention = live.filter((project) => {
    const state = health(project, tasksOf.get(project.id) ?? [])
    return state === 'at_risk' || state === 'overdue'
  }).length
  const projectRow = (project: (typeof live)[number]) => {
    const own = tasksOf.get(project.id) ?? []
    const state = health(project, own)
    const selected = app.projectView === project.id
    return (
      <button
        key={project.id}
        className={`side-row ${selected ? 'is-selected' : ''}`}
        aria-current={selected ? 'page' : undefined}
        disabled={blocked}
        onClick={() => app.openProject(project.id)}
      >
        <ProjectRing project={project} ratio={progress(own).ratio} />
        <span className="side-label">{project.name}</span>
        {state && state !== 'on_track' && (
          <span className={`health-dot is-${state}`} role="img" aria-label={healthLabel[state]} />
        )}
      </button>
    )
  }
  return (
    <>
      <nav aria-label="Task views" className="side-group">
        {!hidden.includes('tasks:today') &&
          pageRow(
            'tasks:today',
            <Calendar aria-hidden="true" />,
            'Today',
            'orange',
            openIn(dueTodayGroups),
            overdueCount > 0 ? 'is-late' : '',
          )}
        {!hidden.includes('tasks:next7') &&
          pageRow(
            'tasks:next7',
            <CalendarClock aria-hidden="true" />,
            'Next 7 Days',
            'purple',
            openIn(nextSevenDaysGroups(tasks, current)),
            overdueCount > 0 ? 'is-late' : '',
          )}
        {!hidden.includes('inbox') &&
          pageRow('inbox', <Inbox aria-hidden="true" />, 'Inbox', 'indigo', inboxOpen)}
        {!hidden.includes('tasks:summary') &&
          pageRow('tasks:summary', <FileText aria-hidden="true" />, 'Summary', 'teal', 0)}
        {!hidden.includes('tasks:calendar') &&
          pageRow('tasks:calendar', <Calendar aria-hidden="true" />, 'Calendar', 'blue', 0)}
        {pageRow(
          'all',
          <Briefcase aria-hidden="true" />,
          'All projects',
          'slate',
          attention,
          'is-attention',
          'Projects that need attention',
        )}
      </nav>
      <Section
        title="Projects"
        action={
          <AppTooltip instant label="New project" disabled={blocked || !ready}>
            <button
              className="icon-btn icon-btn-sm side-section-action"
              aria-label="New project"
              disabled={blocked || !ready}
              onClick={() => app.setProjectEditing('new')}
            >
              <Plus aria-hidden="true" />
            </button>
          </AppTooltip>
        }
      >
        {live.filter(isOpenProject).map(projectRow)}
        {others.length > 0 && (
          <>
            <button
              className="side-row side-row-quiet"
              aria-expanded={othersOpen}
              onClick={() => setOthersOpen((open) => !open)}
            >
              <span className="side-disclosure" aria-hidden="true">
                <ChevronRight />
              </span>
              <span className="side-label">Other projects</span>
              {showCounts && <span className="count">{others.length}</span>}
            </button>
            {othersOpen && others.map(projectRow)}
          </>
        )}
        {error && (
          <p role="alert" className="side-hint is-error">
            {error}
          </p>
        )}
      </Section>
      {tags.length > 0 && !hidden.includes('tasks:tags') && (
        <Section
          title="Tags"
          onHide={() =>
            app.setAppearance({
              ...app.appearance,
              sidebarHidden: setSidebarItemHidden(hidden, 'tasks:tags', true),
            })
          }
        >
          <div className="side-tags">
            {tags.map((tag) => (
              <TagChip
                key={tag}
                tag={tag}
                selected={app.projectView === `tag:${tag}`}
                disabled={blocked}
                appearance={app.appearance}
                setAppearance={app.setAppearance}
                onSelect={() => app.openProject(`tag:${tag}`)}
              />
            ))}
          </div>
        </Section>
      )}
      <nav aria-label="Finished tasks" className="side-group side-group-end">
        {pageRow('tasks:completed', <CircleCheck aria-hidden="true" />, 'Completed', 'green', 0)}
        {pageRow('tasks:trash', <Trash2 aria-hidden="true" />, 'Trash', 'slate', 0)}
      </nav>
    </>
  )
}
