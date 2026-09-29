import { notebookPath, orderedNotebooks } from '../notebooks'
import { useEffect, useRef, useState } from 'react'
import NotebookPopover, { type PopoverAnchor } from './NotebookPopover'
export type { PopoverAnchor } from './NotebookPopover'
import { Plus, Search, X } from '../icons'
import type { Appearance, Note, Notebook } from '../model'
import { NotebookIconGlyph } from '../notebookIcons'

export default function AddToNotebooksPopover({
  note,
  notes,
  notebooks,
  appearance,
  anchor,
  launcher,
  update,
  createNotebook,
  close,
  disabled,
}: {
  note: Note
  notes: Note[]
  notebooks: Notebook[]
  appearance: Appearance
  anchor: PopoverAnchor
  launcher: HTMLElement | null
  update: (patch: Partial<Note>) => void
  createNotebook: (book: Notebook) => void
  close: () => void
  disabled: boolean
}) {
  const nameInput = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const availableNotebooks = orderedNotebooks(notebooks).filter((book) => !book.rootId)
  const visibleNotebooks = availableNotebooks.filter((book) =>
    book.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  )

  useEffect(() => {
    if (creating) nameInput.current?.focus()
  }, [creating])

  return (
    <NotebookPopover
      anchor={anchor}
      launcher={launcher}
      noteId={note.id}
      appearance={appearance}
      close={close}
      title="Add to notebooks"
      className="add-notebooks-popover"
    >
      <div className="add-notebooks-heading">
        <h2 id="add-notebooks-title">Add to notebooks</h2>
        <button
          className="add-notebooks-create-trigger"
          type="button"
          aria-label="New notebook"
          title="New notebook"
          disabled={disabled}
          onClick={() => setCreating((open) => !open)}
        >
          {creating ? <X size={14} aria-hidden="true" /> : <Plus size={15} aria-hidden="true" />}
        </button>
      </div>
      {creating && (
        <form
          className="add-notebooks-create"
          onSubmit={(event) => {
            event.preventDefault()
            const trimmedName = name.trim()
            if (!trimmedName) return
            const id = crypto.randomUUID()
            createNotebook({
              id,
              name: trimmedName,
              color: '#82936f',
              icon: 'notebook',
            })
            update({ notebookIds: [...new Set([...note.notebookIds, id])] })
            setName('')
            setCreating(false)
            setQuery('')
          }}
        >
          <input
            ref={nameInput}
            className="text-field"
            aria-label="New notebook name"
            placeholder="Notebook name"
            maxLength={80}
            disabled={disabled}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <button className="primary-button" type="submit" disabled={disabled || !name.trim()}>
            Create
          </button>
        </form>
      )}
      <div className="add-notebooks-search">
        <Search size={15} aria-hidden="true" />
        <input
          className="text-field"
          aria-label="Search notebooks"
          placeholder="Search notebooks"
          disabled={disabled}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="add-notebooks-options">
        {visibleNotebooks.map((book) => {
          const member = note.notebookIds.includes(book.id)
          return (
            <label key={book.id} data-member={member || undefined}>
              <span className="notebook-swatch" style={{ color: book.color }}>
                <NotebookIconGlyph icon={book.icon} color={book.color} size={16} />
              </span>
              <span className="add-notebooks-name">
                <span>{notebookPath(book, notebooks)}</span>
                <small>
                  {
                    notes.filter((item) => !item.trashed && item.notebookIds.includes(book.id))
                      .length
                  }
                </small>
              </span>
              <input
                type="checkbox"
                checked={member}
                disabled={disabled || member}
                aria-label={`${member ? 'Already in' : 'Add to'} ${notebookPath(book, notebooks)}`}
                onChange={() =>
                  update({ notebookIds: [...new Set([...note.notebookIds, book.id])] })
                }
              />
            </label>
          )
        })}
        {!visibleNotebooks.length && <p className="muted">No notebooks found.</p>}
      </div>
    </NotebookPopover>
  )
}
