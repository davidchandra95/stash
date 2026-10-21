import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { library } from '../storage/useLibrary'
import type { Note } from '../model'
import type { SavedNote } from '../storage/library'
export default function FileConflictDialog({
  note,
  error,
  onClose,
}: {
  note: Note | null
  error: string
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
        <Dialog.Content className="dialog conflict-dialog">
          <div className="dialog-header">
            <Dialog.Title className="dialog-title">Resolve file changes</Dialog.Title>
            <Dialog.Description className="dialog-description">
              {error.replace(/^(FILE_CONFLICT|NAME_COLLISION):\s*/, '')}
            </Dialog.Description>
          </div>
          <div className="dialog-body">
            <div className="conflict-versions">
              <section>
                <h3 className="field-label">Your edits in Stash</h3>
                <pre className="selectable">{note?.text}</pre>
              </section>
              <section>
                <h3 className="field-label">File on disk</h3>
                <pre className="selectable">
                  {disk?.source?.markdown ??
                    disk?.text ??
                    (loaded ? 'No saved file exists yet.' : 'Loading…')}
                </pre>
              </section>
            </div>
            <label className="field-label">
              Filename
              <input
                className="field"
                aria-label="Conflict filename"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={busy}
              />
            </label>
            {failure && (
              <p role="alert" className="field-error">
                {failure}
              </p>
            )}
          </div>
          <div className="dialog-footer">
            <button className="btn" disabled={busy} onClick={onClose}>
              Later
            </button>
            <span className="spacer" />
            <button
              className="btn"
              disabled={busy || !disk}
              onClick={() => void resolve('overwrite')}
            >
              Overwrite file
            </button>
            <button className="btn" disabled={busy || !loaded} onClick={() => void resolve('disk')}>
              Use file version
            </button>
            <button
              className="btn btn-primary"
              disabled={busy || !loaded}
              onClick={() => void resolve('copy')}
            >
              Save edits as copy
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
