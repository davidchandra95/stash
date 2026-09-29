import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { AlertTriangle } from '../icons'
import type { Appearance, Note, Notebook } from '../model'
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
  appearance,
  onConfirm,
  onClose,
}: {
  open: boolean
  notebook: Notebook
  notebooks: Notebook[]
  notes: Note[]
  appearance: Appearance
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
          className="settings-dialog notebook-delete-dialog"
          style={{ fontFamily: 'var(--ui-font)' }}
          data-theme={appearance.dark ? 'dark' : 'light'}
          data-palette={appearance.theme}
          onCloseAutoFocus={(event) => {
            const trigger = [...document.querySelectorAll<HTMLElement>('.notebook-options')].find(
              (element) => element.dataset.notebookId === notebook.id,
            )
            if (!trigger) return
            event.preventDefault()
            trigger.focus({ preventScroll: true })
          }}
        >
          <Dialog.Title>Delete notebook?</Dialog.Title>
          <Dialog.Description className="muted">
            {`${notebookPath(notebook, notebooks)} will be removed from Stash.`}
          </Dialog.Description>
          {linkedTarget && (
            <p role="alert" className="folder-error">
              Folder-linked notebooks cannot be deleted from Stash.
            </p>
          )}
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
            <fieldset className="notebook-delete-fieldset" disabled={busy || linkedTarget}>
              <legend>Which notebooks should be removed?</legend>
              <label className="notebook-choice">
                <input
                  type="radio"
                  name="notebook-delete-scope"
                  checked={!includeChildren}
                  onChange={() => setIncludeChildren(false)}
                />
                <span>
                  <strong>Delete only this notebook and promote child notebooks</strong>
                  <small>
                    {descendantCount
                      ? `${descendantCount} child ${descendantCount === 1 ? 'notebook' : 'notebooks'} will move up one level.`
                      : 'There are no child notebooks to promote.'}
                  </small>
                </span>
              </label>
              <label className={`notebook-choice ${hasLinkedDescendant ? 'disabled' : ''}`}>
                <input
                  type="radio"
                  name="notebook-delete-scope"
                  checked={includeChildren}
                  disabled={hasLinkedDescendant}
                  onChange={() => setIncludeChildren(true)}
                />
                <span>
                  <strong>Delete this notebook and all child notebooks</strong>
                  <small>
                    {hasLinkedDescendant
                      ? 'Not available because a child notebook is linked to a folder on disk.'
                      : descendantCount
                        ? `This removes this notebook and its ${descendantCount} child ${descendantCount === 1 ? 'notebook' : 'notebooks'}.`
                        : 'There are no child notebooks to remove.'}
                  </small>
                </span>
              </label>

              <div className="notebook-group-label">What should happen to notes?</div>
              <label className="notebook-choice">
                <input
                  type="radio"
                  name="notebook-delete-notes"
                  checked={!deleteNotes}
                  onChange={() => setDeleteNotes(false)}
                />
                <span>
                  <strong>Keep notes</strong>
                  <small>
                    {noteCount
                      ? `${noteCount} ${noteCount === 1 ? 'note keeps' : 'notes keep'} any surviving notebook memberships.`
                      : 'No notes are currently in this notebook scope.'}
                  </small>
                </span>
              </label>
              <label className="notebook-choice">
                <input
                  type="radio"
                  name="notebook-delete-notes"
                  checked={deleteNotes}
                  onChange={() => setDeleteNotes(true)}
                />
                <span>
                  <strong>Move notes to Trash</strong>
                  <small>
                    Notes remain recoverable. Shared notes keep memberships in surviving notebooks.
                  </small>
                </span>
              </label>
            </fieldset>
            {noteCount > 0 && (
              <p className="muted notebook-delete-note">
                Notes with no surviving notebook membership will appear in Uncategorized when
                restored.
              </p>
            )}
            {error && (
              <p role="alert" className="folder-error">
                <AlertTriangle size={15} /> {error}
              </p>
            )}
            <div className="dialog-buttons">
              <button type="button" className="quiet-button" disabled={busy} onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="destructive-button" disabled={busy || linkedTarget}>
                {busy
                  ? 'Deleting…'
                  : deleteNotes
                    ? 'Delete notebook and move notes to Trash'
                    : 'Delete notebook'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
