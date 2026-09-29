import { useState } from 'react'
import { LoaderCircle } from '../icons'
import * as Dialog from '@radix-ui/react-dialog'
import type { Appearance, Notebook } from '../model'

export default function NotebookConvertDialog({
  notebook,
  appearance,
  progress,
  onConfirm,
  onClose,
}: {
  notebook: Notebook
  appearance: Appearance
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
        <Dialog.Overlay className="dialog-overlay notebook-convert-overlay" data-busy={busy} />
        <Dialog.Content
          className="settings-dialog notebook-convert-dialog"
          data-busy={busy}
          data-theme={appearance.dark ? 'dark' : 'light'}
          data-palette={appearance.theme}
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
          {busy && (
            <LoaderCircle className="notebook-convert-spinner" size={28} aria-hidden="true" />
          )}
          <Dialog.Title>
            {busy ? 'Converting notebook…' : 'Convert to Stash notebook?'}
          </Dialog.Title>
          <Dialog.Description className="muted">
            {busy ? (
              `“${notebook.name}” is being saved in Stash.`
            ) : (
              <>
                “{notebook.name}” and all its sub-notebooks will become native Stash notebooks.
                Images will be embedded. PDFs and other file attachments will remain external links.
                The original folder and files will stay untouched, and Stash will stop syncing edits
                with them.
              </>
            )}
          </Dialog.Description>
          {busy ? (
            <p
              className="notebook-convert-progress"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {progress || 'Preparing conversion…'}
            </p>
          ) : (
            <p>
              Markdown that cannot be converted to rich text will be kept in editable code blocks.
            </p>
          )}
          {error && (
            <p role="alert" className="folder-error">
              {error}
            </p>
          )}
          {!busy && (
            <div className="dialog-buttons">
              <button className="quiet-button" disabled={busy} onClick={onClose}>
                Cancel
              </button>
              <button
                className="primary-button"
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
                {busy ? 'Converting…' : 'Convert notebook'}
              </button>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
