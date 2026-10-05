import AppTooltip from './AppTooltip'
import { useEffect, useRef, useState } from 'react'
import { BookPlus, Search, X } from '../icons'
import NotebookPopover, { type NotebookPopoverPosition } from './NotebookPopover'
import type { Appearance, Note, Notebook, View } from '../model'
import { moveSource, moveUnavailable, type MoveIntent } from '../notebookMove'
import { notebookPath, orderedNotebooks } from '../notebooks'
import { NotebookIconGlyph } from '../notebookIcons'

export default function MoveNoteDialog({
  anchor,
  launcher,
  note,
  notebooks,
  appearance,
  view,
  destination: droppedDestination,
  move,
  close,
  disabled,
  createNotebook,
}: NotebookPopoverPosition & {
  note: Note
  notebooks: Notebook[]
  appearance: Appearance
  view: View
  destination?: string
  move: (intent: MoveIntent) => boolean
  close: () => void
  disabled: boolean
  createNotebook: (book: Notebook) => void
}) {
  const [destination, setDestination] = useState<string | null>(droppedDestination ?? null)
  const [source, setSource] = useState<string | null | undefined>(() => moveSource(note, view))
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const nameInput = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (creating) nameInput.current?.focus()
  }, [creating])
  const chooseSource = moveSource(note, view) === undefined
  const bookName = (id: string) => {
    const book = notebooks.find((b) => b.id === id)
    return book ? notebookPath(book, notebooks) : 'Unavailable notebook'
  }
  const unavailable = destination === null ? null : moveUnavailable(note, destination, notebooks)
  const staleSource =
    source !== undefined &&
    source !== null &&
    (!note.notebookIds.includes(source) || !notebooks.some((b) => b.id === source))
  return (
    <NotebookPopover
      anchor={anchor}
      launcher={launcher}
      noteId={note.id}
      appearance={appearance}
      close={close}
      title={
        droppedDestination !== undefined ? 'Move from which notebook?' : 'Move to another notebook'
      }
      className="move-notebooks-popover"
    >
      <div className="add-notebooks-heading">
        <h2>
          {droppedDestination !== undefined ? 'Move from which notebook?' : 'Move to notebook'}
        </h2>
        {droppedDestination === undefined && (
          <button
            type="button"
            className="add-notebooks-create-trigger"
            aria-label={creating ? 'Cancel creation' : 'New notebook'}
            disabled={disabled}
            onClick={() => setCreating(!creating)}
          >
            {creating ? <X size={14} /> : <BookPlus size={15} />}
          </button>
        )}
      </div>
      <div className="move-notebooks-fields">
        <div className="move-notebooks-body">
          <fieldset disabled={disabled}>
            <p className="muted move-notebooks-description">
              {note.title || 'Untitled note'}. Other notebook memberships will be kept.
            </p>
            {droppedDestination !== undefined ? (
              <p>
                Destination: <strong>{bookName(droppedDestination)}</strong>
              </p>
            ) : (
              <>
                {creating && (
                  <div className="add-notebooks-create">
                    <input
                      className="text-field"
                      ref={nameInput}
                      aria-label="New notebook name"
                      placeholder="Notebook name"
                      maxLength={80}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                    <button
                      type="button"
                      className="primary-button"
                      disabled={!name.trim()}
                      onClick={() => {
                        const id = crypto.randomUUID()
                        createNotebook({
                          id,
                          name: name.trim(),
                          color: '#82936f',
                          icon: 'notebook',
                        })
                        setDestination(id)
                        setCreating(false)
                        setName('')
                        setQuery('')
                      }}
                    >
                      Create
                    </button>
                  </div>
                )}
                <div className="add-notebooks-search text-field-shell">
                  <Search size={15} aria-hidden="true" />
                  <input
                    className="text-field"
                    aria-label="Search notebooks"
                    placeholder="Search notebooks"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                <div className="add-notebooks-options move-notebooks-options">
                  <label>
                    <span>Uncategorized</span>
                    <input
                      type="radio"
                      name="destination"
                      checked={destination === ''}
                      onChange={() => setDestination('')}
                    />
                  </label>
                  {!orderedNotebooks(notebooks).some((book) =>
                    notebookPath(book, notebooks).toLowerCase().includes(query.toLowerCase()),
                  ) && <p className="muted">No notebooks found.</p>}
                  {orderedNotebooks(notebooks)
                    .filter((b) =>
                      notebookPath(b, notebooks).toLowerCase().includes(query.toLowerCase()),
                    )
                    .map((book) => (
                      <AppTooltip
                        label={
                          book.rootId
                            ? 'Moving into linked folders is not available here.'
                            : undefined
                        }
                        key={book.id}
                      >
                        <label>
                          <span className="notebook-swatch" style={{ color: book.color }}>
                            <NotebookIconGlyph icon={book.icon} color={book.color} size={16} />
                          </span>
                          <span>
                            {notebookPath(book, notebooks)}
                            {book.rootId && <small>Linked folder · unavailable</small>}
                          </span>
                          <input
                            type="radio"
                            name="destination"
                            disabled={!!book.rootId}
                            checked={destination === book.id}
                            onChange={() => setDestination(book.id)}
                          />
                        </label>
                      </AppTooltip>
                    ))}
                </div>
              </>
            )}
            {chooseSource && (
              <fieldset className="move-source-options">
                <legend>Move from which notebook?</legend>
                {note.notebookIds.map((id) => (
                  <label key={id}>
                    <span>{bookName(id)}</span>
                    <input
                      type="radio"
                      name="source"
                      aria-label={`Move from ${bookName(id)}`}
                      checked={source === id}
                      onChange={() => setSource(id)}
                    />
                  </label>
                ))}
              </fieldset>
            )}
            {destination === '' && (
              <p className="muted">
                Remove only the selected source membership. The note becomes uncategorized only when
                no memberships remain.
              </p>
            )}
            {destination && note.notebookIds.includes(destination) && (
              <p className="muted">
                Already in {bookName(destination)}. Moving removes only the chosen source
                membership.
              </p>
            )}
            {(unavailable || staleSource) && (
              <p role="alert">
                {unavailable || 'The source notebook changed. Close this dialog and try again.'}
              </p>
            )}
          </fieldset>
        </div>
        <div className="move-notebooks-footer">
          <button type="button" className="quiet-button" onClick={close}>
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={
              disabled ||
              destination === null ||
              source === undefined ||
              source === destination ||
              !!unavailable ||
              staleSource
            }
            onClick={() => {
              if (
                destination !== null &&
                source !== undefined &&
                move({ noteId: note.id, destination, source })
              )
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
