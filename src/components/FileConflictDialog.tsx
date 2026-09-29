import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { library } from '../storage/useLibrary'
import type { Note } from '../model'
import type { SavedNote } from '../storage/library'
export default function FileConflictDialog({
  note,
  error,
  onClose,
  dark,
  palette,
}: {
  note: Note | null
  error: string
  dark: boolean
  palette: string
  onClose: () => void
}) {
  const [loaded, setLoaded] = useState(false)
  const [disk, setDisk] = useState<SavedNote | null>(null),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState(''),
    [name, setName] = useState('')
  useEffect(() => {
    let current = true
    setDisk(null)
    setLoaded(false)
    setFailure('')
    setName(note?.title ?? '')
    if (note)
      void library
        .command<SavedNote | null>('inspect_file_conflict', { id: note.id })
        .then((n) => {
          if (current) {
            setDisk(n)
            setLoaded(true)
          }
        })
        .catch((e) => {
          if (current) setFailure(String(e))
        })
    return () => {
      current = false
    }
  }, [note?.id])
  const resolve = async (choice: 'disk' | 'copy' | 'overwrite') => {
    if (!note) return
    setBusy(true)
    setFailure('')
    try {
      await library.resolveConflict(note.id, choice, name !== note.title ? name : undefined)
      onClose()
    } catch (e) {
      setFailure(String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog.Root
      open={!!note}
      onOpenChange={(next) => {
        if (!next && !busy) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className="settings-dialog file-conflict-dialog"
          data-theme={dark ? 'dark' : 'light'}
          data-palette={palette}
        >
          <Dialog.Title>Resolve file changes</Dialog.Title>
          <Dialog.Description>
            {error.replace(/^(FILE_CONFLICT|NAME_COLLISION):\s*/, '')}
          </Dialog.Description>
          <div className="conflict-versions">
            <section>
              <h3>Your Stash edits</h3>
              <pre>{note?.text}</pre>
            </section>
            <section>
              <h3>Current file on disk</h3>
              <pre>
                {disk?.source?.markdown ??
                  disk?.text ??
                  (loaded ? 'No saved file exists yet.' : 'Loading…')}
              </pre>
            </section>
          </div>
          <label>
            Filename
            <input
              className="text-field"
              aria-label="Conflict filename"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
            />
          </label>
          {failure && (
            <p role="alert" className="folder-error">
              {failure}
            </p>
          )}
          <div className="dialog-buttons">
            <button className="quiet-button" disabled={busy} onClick={onClose}>
              Later
            </button>
            <button
              className="quiet-button"
              disabled={busy || !loaded}
              onClick={() => void resolve('disk')}
            >
              Load disk version
            </button>
            <button
              className="primary-button"
              disabled={busy || !loaded}
              onClick={() => void resolve('copy')}
            >
              Save my edits as a copy
            </button>
            <button
              className="quiet-button"
              disabled={busy || !disk}
              onClick={() => void resolve('overwrite')}
            >
              Overwrite disk version
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
