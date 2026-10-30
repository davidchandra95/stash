import * as Dropdown from '@radix-ui/react-dropdown-menu'
import { memo, useEffect, useRef, type PointerEvent, type RefObject } from 'react'
import ProjectRing from '../projects/ProjectRing'
import { progress } from '../projects/model'
import AppTooltip from '../components/AppTooltip'
import NoteContextMenu, { type NoteAction } from '../components/NoteContextMenu'
import NoteListNotebook from '../components/NoteListNotebook'
import VirtualNoteRows from '../components/VirtualNoteRows'
import { NotebookIconGlyph } from '../notebookIcons'
import { noteListModes, noteNotebookContext, type NoteListMode } from '../noteListPresentation'
import { sortLabels, type NoteSortMode } from '../noteOrder'
import { LiveNoteRow } from '../storage/libraryReaders'
import type { NavigationNote } from '../storage/librarySelectors'
import type { Notebook } from '../model'
import { ArrowDownWideNarrow, Check, ListFilter, Pin, Search, SquarePen, X } from '../icons'
import { trackApp, useApp, useBlocked } from './context'
import { LeadingControls } from './WindowControls'

function RadioItems<T extends string>({
  labels,
  value,
  onChange,
  label,
}: {
  labels: Record<T, string>
  value: T
  onChange: (value: T) => void
  label: string
}) {
  return (
    <Dropdown.RadioGroup
      value={value}
      onValueChange={(next) => onChange(next as T)}
      aria-label={label}
    >
      {(Object.keys(labels) as T[]).map((key) => (
        <Dropdown.RadioItem key={key} value={key} className="menu-item">
          <span className="menu-check">
            <Dropdown.ItemIndicator>
              <Check aria-hidden="true" />
            </Dropdown.ItemIndicator>
          </span>
          <span className="menu-text">{labels[key]}</span>
        </Dropdown.RadioItem>
      ))}
    </Dropdown.RadioGroup>
  )
}

/** Projects that link to the notebook in view. */
function LinkedProjects() {
  const app = useApp()
  const blocked = useBlocked()
  const bookId = app.view.startsWith('book:') ? app.view.slice(5) : null
  if (!bookId) return null
  const { projects, tasks } = app.projects
  return projects
    .filter((project) => project.deletedAt === null && project.notebookId === bookId)
    .map((project) => (
      <AppTooltip key={project.id} label={`Open project “${project.name}”`} disabled={blocked}>
        <button
          className="project-link-chip"
          disabled={blocked}
          onClick={() => app.openProject(project.id)}
        >
          <ProjectRing
            project={project}
            ratio={
              progress(tasks.filter((t) => t.deletedAt === null && t.projectId === project.id))
                .ratio
            }
          />
          Project
        </button>
      </AppTooltip>
    ))
}

function ListMenu() {
  const app = useApp()
  const blocked = useBlocked()
  return (
    <Dropdown.Root>
      <AppTooltip instant label="Sort and view options" disabled={blocked}>
        <Dropdown.Trigger asChild>
          <button className="icon-btn" aria-label="Sort and view options" disabled={blocked}>
            <ArrowDownWideNarrow aria-hidden="true" />
          </button>
        </Dropdown.Trigger>
      </AppTooltip>
      <Dropdown.Portal>
        <Dropdown.Content className="menu" align="end" sideOffset={4} collisionPadding={8}>
          <Dropdown.Label className="menu-label indented">Sort by</Dropdown.Label>
          <RadioItems<NoteSortMode>
            label="Change note sorting"
            labels={sortLabels}
            value={app.sortMode}
            onChange={app.changeSort}
          />
          <Dropdown.Separator className="menu-separator" />
          <Dropdown.Label className="menu-label indented">View</Dropdown.Label>
          <RadioItems<NoteListMode>
            label="Note list view"
            labels={noteListModes}
            value={app.noteListMode}
            onChange={app.changeListMode}
          />
          <Dropdown.Separator className="menu-separator" />
          <Dropdown.Item className="menu-item" onSelect={app.toggleNoteList}>
            <span className="menu-check" />
            <span className="menu-text">Hide notes list</span>
          </Dropdown.Item>
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  )
}

/**
 * Hides the pane from assistive technology while it is collapsed. A modal menu inside the pane
 * (Sort and view options) removes aria-hidden from it when it closes, so keep re-applying it.
 */
function useAriaHidden(element: RefObject<HTMLElement | null>, hidden: boolean) {
  useEffect(() => {
    const node = element.current
    if (!node || !hidden) return
    const apply = () => {
      if (node.getAttribute('aria-hidden') !== 'true') node.setAttribute('aria-hidden', 'true')
    }
    apply()
    const observer = new MutationObserver(apply)
    observer.observe(node, { attributes: true, attributeFilter: ['aria-hidden'] })
    return () => {
      observer.disconnect()
      node.removeAttribute('aria-hidden')
    }
  }, [element, hidden])
}

type RowHandlers = {
  actions: (note: NavigationNote) => NoteAction[]
  consumeClick: () => boolean
  pointerDown: (event: PointerEvent<HTMLElement>, id: string) => void
  open: (id: string) => void
  preview: (id: string) => void
}

/** Memoized: list scrolling and unrelated app updates do not re-render visible rows. */
const NoteRow = memo(function NoteRow({
  note,
  notebooks,
  preview,
  selected,
  divider,
  placeholder,
  blocked,
  controls,
  handlers,
}: {
  note: NavigationNote
  /** Present when rows show their notebooks (All notes). */
  notebooks?: Notebook[]
  preview: boolean
  selected: boolean
  divider: boolean
  placeholder: boolean
  blocked: boolean
  controls: { onMenuTrackingChange: (open: boolean) => void; restoreFocus: () => void }
  handlers: RefObject<RowHandlers>
}) {
  const context = notebooks ? noteNotebookContext(note, notebooks) : undefined
  return (
    <LiveNoteRow noteId={note.id} preview={preview}>
      {(row) => (
        <NoteContextMenu
          tooltipLabel={context?.description}
          onTrackingChange={controls.onMenuTrackingChange}
          onRestoreFocus={controls.restoreFocus}
          actions={() => handlers.current.actions(note)}
          disabled={blocked}
        >
          <button
            className={[
              'note-row',
              selected && 'is-selected',
              placeholder && 'is-drag-placeholder',
              divider && 'has-divider',
            ]
              .filter(Boolean)
              .join(' ')}
            aria-label={row.title || 'Untitled note'}
            aria-current={selected || undefined}
            aria-description={
              [row.preview, context?.description].filter(Boolean).join('. ') || undefined
            }
            data-note-id={note.id}
            data-motion-key={note.id}
            onPointerDown={(event) => handlers.current.pointerDown(event, note.id)}
            onDragStart={(event) => event.preventDefault()}
            onClick={(event) => {
              if (handlers.current.consumeClick()) {
                event.preventDefault()
                return
              }
              if (event.metaKey || event.ctrlKey) handlers.current.open(note.id)
              else handlers.current.preview(note.id)
            }}
            onDoubleClick={() => handlers.current.open(note.id)}
          >
            <span className="note-row-title">
              {note.pinned && <Pin aria-label="Pinned" className="ui-icon note-row-pin" />}
              <span className="truncate">{row.title || 'Untitled note'}</span>
            </span>
            <span className="note-row-meta">
              <span className="note-row-date">{row.date}</span>
              {context && <NoteListNotebook context={context} />}
            </span>
            {preview && (
              <span className="note-row-preview">{row.preview || 'No text preview'}</span>
            )}
          </button>
        </NoteContextMenu>
      )}
    </LiveNoteRow>
  )
})

export default trackApp(function NoteListPane() {
  const app = useApp()
  const blocked = useBlocked()
  const pane = useRef<HTMLElement>(null)
  useAriaHidden(pane, !app.noteListVisible)
  const { view, query, filtered, selected, drag, notebooks } = app
  const items = drag.preview ?? filtered
  // Rows are memoized, so they call into the latest app state through this stable ref.
  const handlers = useRef<RowHandlers>(null!)
  handlers.current = {
    actions: (note) => [...app.actionsFor(note), ...app.orderActions(note)],
    consumeClick: drag.consumeClick,
    pointerDown: drag.onPointerDown,
    open: (id) => app.workspace.open(id, true),
    preview: (id) => app.workspace.preview(id),
  }
  const preview = app.noteListMode === 'preview'
  const cards = app.appearance.layout === 'cards'
  return (
    <section
      ref={pane}
      className="note-list"
      id="note-list"
      aria-label="Note list"
      data-pane="list"
      hidden={!!app.workspace.documentId}
      inert={!app.noteListVisible}
    >
      <header className="pane-bar list-bar" data-tauri-drag-region>
        <LeadingControls pane="list" />
        <h1 className="list-title" data-tauri-drag-region>
          {app.headingNotebook && (
            <NotebookIconGlyph
              icon={app.headingNotebook.icon}
              color={app.headingNotebook.color}
              aria-hidden={true}
            />
          )}
          <AppTooltip label={app.title}>
            <span className="truncate">{app.title}</span>
          </AppTooltip>
          {filtered.length > 0 && (
            <span className="count">{filtered.length.toLocaleString('en-US')}</span>
          )}
        </h1>
        <LinkedProjects />
        <ListMenu />
        <AppTooltip
          instant
          label="New note"
          shortcut={app.shortcutFor('new-note')}
          disabled={blocked}
        >
          <button
            className="icon-btn"
            aria-label="New note"
            disabled={blocked}
            onClick={() => app.addNote()}
          >
            <SquarePen aria-hidden="true" />
          </button>
        </AppTooltip>
      </header>
      <div className="list-filter">
        <label className="field-shell">
          <ListFilter aria-hidden="true" />
          <input
            ref={app.filterInput}
            aria-label="Filter this view"
            aria-description="Filter note titles and text in the selected view."
            placeholder="Filter"
            value={query}
            onChange={(event) => app.setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && query) {
                event.preventDefault()
                app.setQuery('')
              }
            }}
          />
          {query && (
            <button className="icon-btn" aria-label="Clear filter" onClick={() => app.setQuery('')}>
              <X aria-hidden="true" />
            </button>
          )}
        </label>
      </div>
      <div
        className={`note-rows ${preview ? 'is-preview' : ''}`}
        ref={app.rowsRef}
        onClickCapture={(event) => {
          if (drag.consumeClick()) {
            event.preventDefault()
            event.stopPropagation()
          }
        }}
      >
        <VirtualNoteRows
          items={items}
          scrollRef={app.rowsRef}
          apiRef={app.virtualRowsRef}
          retainedIds={[selected?.id, drag.draggedId]}
          estimatedSize={(preview ? 76 : 58) + (cards ? 2 : 0)}
          rowGap={cards ? 2 : 0}
          geometryKey={`${app.noteListMode}:${app.appearance.layout}`}
          renderRow={(note, index, controls) => {
            const next = items[index + 1]
            const isSelected = note.id === selected?.id
            return (
              <NoteRow
                note={note}
                notebooks={view === 'all' ? notebooks : undefined}
                preview={preview}
                selected={isSelected}
                divider={!isSelected && !!next && next.id !== selected?.id}
                placeholder={drag.draggedId === note.id}
                blocked={blocked}
                controls={controls}
                handlers={handlers}
              />
            )
          }}
        />
        {!filtered.length && (
          <div className="list-empty">
            <p className="list-empty-title">
              {query ? 'No matches in this view' : view === 'trash' ? 'Trash is empty' : 'No notes'}
            </p>
            <p>{query ? 'No titles or text match your filter.' : 'Notes you add appear here.'}</p>
            {query && view !== 'all' && (
              <button
                className="btn btn-sm"
                disabled={blocked}
                onClick={() => {
                  app.setView('all')
                  app.filterInput.current?.focus()
                }}
              >
                <Search aria-hidden="true" />
                Search all notes
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  )
})
