import type { MouseEvent } from 'react'
import { notebookPath } from '../notebooks'
import type { Notebook } from '../model'
import { noteLinkLabel, type Backlinks } from '../storage/backlinks'

export default function NoteInformation({
  note,
  notebooks,
  backlinks,
  open,
}: {
  note: { updated: number; text: string; notebookIds: string[] }
  notebooks: Notebook[]
  backlinks: Backlinks
  open: (id: string, newTab?: boolean) => void
}) {
  const label = (ids: string[]) =>
    notebooks
      .filter((b) => ids.includes(b.id))
      .map((b) => notebookPath(b, notebooks))
      .join(', ') || 'Uncategorized'
  const text = note.text.trim()
  const follow = (event: MouseEvent, id: string) => open(id, event.metaKey || event.ctrlKey)
  return (
    <dl className="note-info">
      <div>
        <dt>Updated</dt>
        <dd>{new Date(note.updated).toLocaleString()}</dd>
      </div>
      <div>
        <dt>Length</dt>
        <dd>
          {text ? text.split(/\s+/).length : 0} words · {note.text.length} characters
        </dd>
      </div>
      <div>
        <dt>Notebooks</dt>
        <dd>{label(note.notebookIds)}</dd>
      </div>
      <div>
        <dt>Backlinks</dt>
        <dd aria-live="polite">
          {backlinks.error ? (
            <span className="note-info-problem" role="alert">
              <span className="field-error">{backlinks.error}</span>
              <button className="btn btn-sm" onClick={backlinks.retry}>
                Try again
              </button>
            </span>
          ) : backlinks.notes === null ? (
            'Finding links…'
          ) : (
            <>
              {backlinks.notes.length ? (
                <ul className="note-info-links">
                  {backlinks.notes.map((source) => (
                    <li key={source.id}>
                      <button onClick={(event) => follow(event, source.id)}>
                        <span className="note-link-title">{noteLinkLabel(source.title)}</span>
                        <span className="note-link-detail">{label(source.notebookIds)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                !backlinks.unreadable && 'No notes link here.'
              )}
              {backlinks.unreadable > 0 && (
                <span className="field-error" role="alert">
                  {backlinks.unreadable === 1
                    ? 'One note could not be checked.'
                    : `${backlinks.unreadable} notes could not be checked.`}
                </span>
              )}
            </>
          )}
        </dd>
      </div>
    </dl>
  )
}
