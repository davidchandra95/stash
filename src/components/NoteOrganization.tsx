import { notebookPath, orderedNotebooks } from '../notebooks'
import { useState } from 'react'
import { Search } from '../icons'
import NotebookPopover, { type NotebookPopoverPosition } from './NotebookPopover'
import type { Note, Notebook } from '../model'
import { NotebookIconGlyph } from '../notebookIcons'

export default function NoteOrganization({
  anchor,
  launcher,
  note,
  notes,
  notebooks,
  update,
  close,
  disabled,
}: NotebookPopoverPosition & {
  note: Note
  notes: Note[]
  notebooks: Notebook[]
  update: (patch: Partial<Note>) => void
  close: () => void
  disabled: boolean
}) {
  const [query, setQuery] = useState('')
  const [destination, setDestination] = useState<string | null>(null)
  const title = note.source ? 'Move file to notebook' : 'Move to another notebook'
  const availableNotebooks = orderedNotebooks(notebooks).filter((book) =>
    note.source ? !!book.rootId : true,
  )
  const visibleNotebooks = availableNotebooks.filter((book) =>
    book.name.toLowerCase().includes(query.toLowerCase()),
  )
  return (
    <NotebookPopover
      anchor={anchor}
      launcher={launcher}
      noteId={note.id}
      close={close}
      title={title}
      className="move-notebooks-popover"
    >
      <div className="picker-header">
        <h2 className="popover-title">{title}</h2>
      </div>
      <div className="picker-body">
        <div className="picker-scroll">
          <fieldset disabled={disabled}>
            <p className="picker-note">{note.title || 'Untitled note'}</p>
            <div className="field-shell picker-search">
              <Search aria-hidden="true" />
              <input
                autoFocus
                aria-label="Search notebooks"
                placeholder="Search notebooks"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="picker-list">
              {!note.source && (
                <label>
                  <span>Uncategorized</span>
                  <input
                    type="radio"
                    name="destination"
                    checked={destination === ''}
                    onChange={() => setDestination('')}
                  />
                </label>
              )}
              {visibleNotebooks.map((book) => (
                <label key={book.id}>
                  <span className="picker-icon" style={{ color: book.color }}>
                    <NotebookIconGlyph icon={book.icon} color={book.color} />
                  </span>
                  <span>
                    {notebookPath(book, notebooks)}{' '}
                    <small>
                      {notes.filter((n) => !n.trashed && n.notebookIds.includes(book.id)).length}
                    </small>
                  </span>
                  <input
                    type="radio"
                    name="destination"
                    checked={destination === book.id}
                    onChange={() => setDestination(book.id)}
                  />
                </label>
              ))}
              {!visibleNotebooks.length && <p className="picker-empty">No notebooks found.</p>}
            </div>
          </fieldset>
        </div>
        <div className="picker-footer">
          <button type="button" className="btn" onClick={close}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={disabled || destination === null}
            onClick={() => {
              update({
                notebookIds: destination
                  ? note.source
                    ? [
                        ...note.notebookIds.filter(
                          (id) => !notebooks.find((b) => b.id === id)?.rootId,
                        ),
                        destination,
                      ]
                    : [destination]
                  : [],
              })
              close()
            }}
          >
            Move
          </button>
        </div>
      </div>
    </NotebookPopover>
  )
}
