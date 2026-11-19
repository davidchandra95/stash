import { useEffect, useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { generateHTML } from '@tiptap/core'
import DOMPurify from 'dompurify'
import { writingExtensions } from '../editor/extensions'
import { useSettledNote } from '../storage/settled'
import { listVersions, readVersion, restoreVersion, type NoteVersion, type VersionSummary } from './versions'

const when = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const day = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

function sizeLabel(bytes: number) {
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Earlier versions of one note: pick one to read it, then restore it if wanted. */
export default function VersionHistory({ noteId, onClose }: { noteId: string; onClose: () => void }) {
  const note = useSettledNote(noteId)
  const [versions, setVersions] = useState<VersionSummary[] | null>(null)
  const [selected, setSelected] = useState<number | 'current'>('current')
  const [version, setVersion] = useState<NoteVersion | null>(null)
  const [error, setError] = useState('')
  const [restoring, setRestoring] = useState(false)

  useEffect(() => {
    let live = true
    listVersions(noteId).then(
      (list) => live && setVersions(list),
      (failure) => live && setError(String(failure)),
    )
    return () => {
      live = false
    }
  }, [noteId])
  useEffect(() => {
    if (selected === 'current') return setVersion(null)
    let live = true
    setVersion(null)
    readVersion(selected).then(
      (found) => live && setVersion(found),
      (failure) => live && setError(String(failure)),
    )
    return () => {
      live = false
    }
  }, [selected])

  const shown = selected === 'current' ? note?.content : version?.content
  const html = useMemo(() => {
    if (!shown) return ''
    try {
      return DOMPurify.sanitize(generateHTML(shown, writingExtensions), { ADD_DATA_URI_TAGS: ['img'] })
    } catch (failure) {
      return `<p>${String(failure)}</p>`
    }
  }, [shown])

  const restore = async () => {
    if (!version) return
    setRestoring(true)
    setError('')
    try {
      await restoreVersion(version)
      onClose()
    } catch (failure) {
      setError(String(failure))
    } finally {
      setRestoring(false)
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog version-dialog">
          <div className="dialog-header">
            <Dialog.Title className="dialog-title">Version history</Dialog.Title>
            <Dialog.Description className="dialog-description">
              Earlier versions of “{note?.title || 'Untitled'}”, kept on this device when the note changes.
            </Dialog.Description>
          </div>
          <div className="version-body">
            <div className="version-list" role="listbox" aria-label="Versions">
              <button
                role="option"
                aria-selected={selected === 'current'}
                className="version-row"
                onClick={() => setSelected('current')}
              >
                <span className="version-when">Current version</span>
                <span className="version-meta">{note ? when.format(note.updated) : ''}</span>
              </button>
              {versions?.map((v, index) => {
                const label = day.format(v.saved)
                const heading = index === 0 || day.format(versions[index - 1]!.saved) !== label
                return (
                  <div key={v.id} role="presentation">
                    {heading && (
                      <div className="version-day" role="presentation">
                        {label}
                      </div>
                    )}
                    <button
                      role="option"
                      aria-selected={selected === v.id}
                      className="version-row"
                      onClick={() => setSelected(v.id)}
                    >
                      <span className="version-when">{when.format(v.saved)}</span>
                      <span className="version-meta">
                        {v.title !== note?.title ? `${v.title || 'Untitled'} · ` : ''}
                        {sizeLabel(v.size)}
                      </span>
                      <span className="version-preview-text">{v.preview || 'Empty note'}</span>
                    </button>
                  </div>
                )
              })}
              {versions && !versions.length && (
                <p className="version-empty">
                  No earlier versions yet. A version is kept when the note changes, at most every 10 minutes.
                </p>
              )}
            </div>
            <div className="version-preview" aria-label="Version preview" role="document">
              {selected !== 'current' && version && version.title !== note?.title && (
                <h1 className="version-title">{version.title || 'Untitled'}</h1>
              )}
              {selected !== 'current' && !version && !error ? (
                <p className="version-empty">Loading…</p>
              ) : (
                <div className="tiptap" dangerouslySetInnerHTML={{ __html: html }} />
              )}
            </div>
          </div>
          {error && (
            <p role="alert" className="field-error version-error">
              {error}
            </p>
          )}
          <div className="dialog-footer">
            <button className="btn" onClick={onClose}>
              Close
            </button>
            <button
              className="btn btn-primary"
              disabled={selected === 'current' || !version || restoring}
              onClick={() => void restore()}
            >
              Restore this version
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
