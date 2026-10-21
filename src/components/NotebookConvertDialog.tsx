import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type { Notebook } from '../model'

export default function NotebookConvertDialog({
  notebook,
  progress,
  onConfirm,
  onClose,
}: {
  notebook: Notebook
  progress: string
  onConfirm: () => Promise<void>
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" data-busy={busy} />
        <Dialog.Content
          className="dialog"
          data-busy={busy}
          onCloseAutoFocus={(event) => {
            const trigger = [...document.querySelectorAll<HTMLElement>('.notebook-options')].find(
              (element) => element.dataset.notebookId === notebook.id,
            )
            if (trigger) {
              event.preventDefault()
              trigger.focus({ preventScroll: true })
            }
          }}
          onEscapeKeyDown={(event) => {
            if (busy) event.preventDefault()
          }}
          onPointerDownOutside={(event) => {
            if (busy) event.preventDefault()
          }}
        >
          <div className="dialog-header">
            <Dialog.Title className="dialog-title">
              {busy ? 'Converting notebook…' : `Convert “${notebook.name}” to a Stash notebook?`}
            </Dialog.Title>
            <Dialog.Description className="dialog-description">
              {busy
                ? `“${notebook.name}” is being saved in Stash.`
                : 'The notebook and its sub-notebooks become regular Stash notebooks. The original folder stays untouched, and Stash stops editing its files.'}
            </Dialog.Description>
          </div>
          <div className="dialog-body">
            {busy ? (
              <p className="convert-progress" role="status" aria-live="polite" aria-atomic="true">
                <span className="spinner" aria-hidden="true" />
                {progress || 'Preparing conversion…'}
              </p>
            ) : (
              <ul className="field-help convert-notes">
                <li>Images are embedded in the notes.</li>
                <li>PDFs and other attachments stay as links to the original files.</li>
                <li>Markdown that can’t become rich text is kept in editable code blocks.</li>
              </ul>
            )}
            {error && (
              <p role="alert" className="field-error">
                {error}
              </p>
            )}
          </div>
          {!busy && (
            <div className="dialog-footer">
              <button className="btn" disabled={busy} onClick={onClose}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  setError('')
                  try {
                    await onConfirm()
                    onClose()
                  } catch (cause) {
                    setError(String(cause))
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                Convert
              </button>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
