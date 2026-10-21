import * as Dropdown from '@radix-ui/react-dropdown-menu'
import { useEffect, useRef, type RefObject } from 'react'
import AppTooltip from '../components/AppTooltip'
import NoteContextMenu from '../components/NoteContextMenu'
import NoteListNotebook from '../components/NoteListNotebook'
import VirtualNoteRows from '../components/VirtualNoteRows'
import { NotebookIconGlyph } from '../notebookIcons'
import { noteListModes, noteNotebookContext, type NoteListMode } from '../noteListPresentation'
import { sortLabels, type NoteSortMode } from '../noteOrder'
import { LiveNoteRow } from '../storage/libraryReaders'
import { ArrowDownWideNarrow, Check, ListFilter, Pin, Search, SquarePen, X } from '../icons'
import { useApp, useBlocked } from './context'
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

export default function NoteListPane() {
  const app = useApp()
  const blocked = useBlocked()
  const pane = useRef<HTMLElement>(null)
  useAriaHidden(pane, !app.noteListVisible)
  const { view, query, filtered, selected, drag, notebooks } = app
  const items = drag.preview ?? filtered
  const preview = app.noteListMode === 'preview'
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
          estimatedSize={preview ? 60 : 44}
          geometryKey={app.noteListMode}
          renderRow={(note, index, controls) => {
            const context = view === 'all' ? noteNotebookContext(note, notebooks) : undefined
            const next = items[index + 1]
            const isSelected = note.id === selected?.id
            return (
              <LiveNoteRow noteId={note.id} preview={preview}>
                {(row) => (
                  <NoteContextMenu
                    key={note.id}
                    tooltipLabel={context?.description}
                    onTrackingChange={controls.onMenuTrackingChange}
                    onRestoreFocus={controls.restoreFocus}
                    actions={[...app.actionsFor(note), ...app.orderActions(note)]}
                    disabled={blocked}
                  >
                    <button
                      className={[
                        'note-row',
                        isSelected && 'is-selected',
                        drag.draggedId === note.id && 'is-drag-placeholder',
                        !isSelected && next && next.id !== selected?.id && 'has-divider',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      aria-label={row.title || 'Untitled note'}
                      aria-current={isSelected || undefined}
                      aria-description={
                        [row.preview, context?.description].filter(Boolean).join('. ') || undefined
                      }
                      data-note-id={note.id}
                      data-motion-key={note.id}
                      onPointerDown={(event) => drag.onPointerDown(event, note.id)}
                      onDragStart={(event) => event.preventDefault()}
                      onClick={(event) => {
                        if (drag.consumeClick()) {
                          event.preventDefault()
                          return
                        }
                        if (event.metaKey || event.ctrlKey) app.workspace.open(note.id, true)
                        else app.workspace.preview(note.id)
                      }}
                      onDoubleClick={() => app.workspace.open(note.id, true)}
                    >
                      <span className="note-row-title">
                        {note.pinned && (
                          <Pin aria-label="Pinned" className="ui-icon note-row-pin" />
                        )}
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
}
