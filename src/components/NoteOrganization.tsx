import { notebookPath, orderedNotebooks } from '../notebooks'
import { useState } from 'react'
import { Search } from '../icons'
import NotebookPopover, { type NotebookPopoverPosition } from './NotebookPopover'
import type { Appearance, Note, Notebook } from '../model'
import { NotebookIconGlyph } from '../notebookIcons'

export default function NoteOrganization({
  anchor,
  launcher,
  note,
  notes,
  notebooks,
  appearance,
  update,
  close,
  disabled,
}: NotebookPopoverPosition & {
  note: Note
  notes: Note[]
  notebooks: Notebook[]
  appearance: Appearance
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
      appearance={appearance}
      close={close}
      title={title}
      className="move-notebooks-popover"
    >
      <div className="add-notebooks-heading">
        <h2>{title}</h2>
      </div>
      <div className="move-notebooks-fields">
        <div className="move-notebooks-body">
          <fieldset disabled={disabled}>
            <p className="muted move-notebooks-description">{note.title || 'Untitled note'}</p>
            <div className="add-notebooks-search">
              <Search size={15} aria-hidden="true" />
              <input
                autoFocus
                className="text-field"
                aria-label="Search notebooks"
                placeholder="Search notebooks"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="add-notebooks-options move-notebooks-options">
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
                  <span className="notebook-swatch" style={{ color: book.color }}>
                    <NotebookIconGlyph icon={book.icon} color={book.color} size={16} />
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
              {!visibleNotebooks.length && <p className="muted">No notebooks found.</p>}
            </div>
          </fieldset>
        </div>
        <div className="move-notebooks-footer">
          <button type="button" className="quiet-button" onClick={close}>
            Cancel
          </button>
          <button
            className="primary-button"
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
