import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type { Note, Notebook } from '../model'
import { notebookDeleteScope, notebookPath } from '../notebooks'

export type NotebookDeleteOptions = {
  includeChildren: boolean
  deleteNotes: boolean
}

export default function NotebookDeleteDialog({
  open,
  notebook,
  notebooks,
  notes,
  onConfirm,
  onClose,
}: {
  open: boolean
  notebook: Notebook
  notebooks: Notebook[]
  notes: Note[]
  onConfirm: (options: NotebookDeleteOptions) => void | Promise<void>
  onClose: () => void
}) {
  const [includeChildren, setIncludeChildren] = useState(false)
  const [deleteNotes, setDeleteNotes] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const scope = notebookDeleteScope(notebook.id, notebooks, true)
  const descendantCount = Math.max(0, scope.length - 1)
  const linkedTarget = !!notebook.rootId
  const hasLinkedDescendant = scope.slice(1).some((book) => !!book.rootId)
  const scopeIds = new Set(scope.map((book) => book.id))
  const noteCount = notes.filter((note) => note.notebookIds.some((id) => scopeIds.has(id))).length

  useEffect(() => {
    if (!open) return
    setIncludeChildren(false)
    setDeleteNotes(false)
    setBusy(false)
    setError('')
  }, [open, notebook.id])

  const choice = (
    name: string,
    checked: boolean,
    onChange: () => void,
    title: string,
    detail: string,
    disabled = false,
  ) => (
    <label className={`radio-choice ${disabled ? 'is-disabled' : ''}`}>
      <input type="radio" name={name} checked={checked} disabled={disabled} onChange={onChange} />
      <span>
        <span className="radio-choice-title">{title}</span>
        <span className="field-help">{detail}</span>
      </span>
    </label>
  )

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className="dialog"
          onCloseAutoFocus={(event) => {
            const trigger = [...document.querySelectorAll<HTMLElement>('.notebook-options')].find(
              (element) => element.dataset.notebookId === notebook.id,
            )
            if (!trigger) return
            event.preventDefault()
            trigger.focus({ preventScroll: true })
          }}
        >
          <form
            onSubmit={async (event) => {
              event.preventDefault()
              if (busy) return
              setBusy(true)
              setError('')
              try {
                await onConfirm({ includeChildren, deleteNotes })
                onClose()
              } catch (confirmError) {
                setError(String(confirmError))
              } finally {
                setBusy(false)
              }
            }}
          >
            <div className="dialog-header">
              <Dialog.Title className="dialog-title">
                Delete “{notebookPath(notebook, notebooks)}”?
              </Dialog.Title>
              <Dialog.Description className="dialog-description">
                The notebook will be removed from Stash.
              </Dialog.Description>
            </div>
            <div className="dialog-body">
              {linkedTarget && (
                <p role="alert" className="field-error">
                  Folder-linked notebooks cannot be deleted from Stash.
                </p>
              )}
              <fieldset className="radio-group" disabled={busy || linkedTarget}>
                <legend className="field-label">Sub-notebooks</legend>
                {choice(
                  'notebook-delete-scope',
                  !includeChildren,
                  () => setIncludeChildren(false),
                  'Keep sub-notebooks',
                  descendantCount
                    ? `${descendantCount} ${descendantCount === 1 ? 'sub-notebook moves' : 'sub-notebooks move'} up one level.`
                    : 'This notebook has no sub-notebooks.',
                )}
                {choice(
                  'notebook-delete-scope',
                  includeChildren,
                  () => setIncludeChildren(true),
                  'Delete sub-notebooks too',
                  hasLinkedDescendant
                    ? 'Unavailable because a sub-notebook is linked to a folder on disk.'
                    : descendantCount
                      ? `Also removes ${descendantCount} ${descendantCount === 1 ? 'sub-notebook' : 'sub-notebooks'}.`
                      : 'This notebook has no sub-notebooks.',
                  hasLinkedDescendant,
                )}
              </fieldset>
              <fieldset className="radio-group" disabled={busy || linkedTarget}>
                <legend className="field-label">Notes</legend>
                {choice(
                  'notebook-delete-notes',
                  !deleteNotes,
                  () => setDeleteNotes(false),
                  'Keep notes',
                  noteCount
                    ? `${noteCount} ${noteCount === 1 ? 'note keeps' : 'notes keep'} their other notebooks, or become Uncategorized.`
                    : 'No notes are in this notebook.',
                )}
                {choice(
                  'notebook-delete-notes',
                  deleteNotes,
                  () => setDeleteNotes(true),
                  'Move notes to Trash',
                  'Notes stay recoverable. Notes in other notebooks keep those memberships.',
                )}
              </fieldset>
              {error && (
                <p role="alert" className="field-error">
                  {error}
                </p>
              )}
            </div>
            <div className="dialog-footer">
              <button type="button" className="btn" disabled={busy} onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="btn btn-danger" disabled={busy || linkedTarget}>
                {busy ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
