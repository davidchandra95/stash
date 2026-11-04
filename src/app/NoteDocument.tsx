import AppTooltip from '../components/AppTooltip'
import { fileTitleError, notebookPath } from '../notebooks'
import { getEditor, getSplitEditor, noteScrollPositions, splitScrollPositions } from '../editor/session'
import { observeEditorScrollSpace } from '../editorScrollSpace'
import { libraryProjection } from '../storage/librarySelectors'
import { LiveNoteEditor as NoteEditor, NoteStatistics, SaveStatus } from '../storage/libraryReaders'
import { library as libraryStore } from '../storage/useLibrary'
import NoteNotebooksMenu from '../components/NoteNotebooksMenu'
import { notebookColorValue } from '../notebookColors'
import { Feather, SquarePen, X } from '../icons'
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { useLibrarySelector } from '../storage/useLibrary'
import type { EditorGroupId } from '../workspace'
import { useApp, useBlocked } from './context'

const noteDate = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

function EmptyState() {
  const app = useApp()
  const blocked = useBlocked()
  return (
    <div className="editor-empty">
      <Feather aria-hidden="true" className="editor-empty-icon" />
      <h2>{app.query ? 'No note selected' : 'Nothing open'}</h2>
      <p>
        {app.query
          ? 'Choose a different filter, or start something new.'
          : 'Choose a note from the list, or start a new one.'}
      </p>
      <div className="editor-empty-actions">
        <button className="btn btn-primary" disabled={blocked} onClick={() => app.addNote()}>
          <SquarePen aria-hidden="true" />
          New note
        </button>
        {!app.notes.length && (
          <button className="btn" disabled={blocked} onClick={app.library.addSamples}>
            Add sample notes
          </button>
        )}
      </div>
      <SaveStatus empty />
    </div>
  )
}

export default function NoteDocument({ group = 'main' }: { group?: EditorGroupId }) {
  const app = useApp()
  const blocked = useBlocked()
  const { library, notebooks, titleDraft, busyNote } = app
  // The focused group follows the controller, which also handles a PDF's companion note.
  const focused = app.workspace.focusedGroup === group
  const selected = focused ? app.selected : app.noteInGroup(group)
  const loaded = useLibrarySelector((state) => !!selected && state.loaded.has(selected.id))
  const active = focused ? app.active : loaded ? selected : undefined
  const scrollPositions = group === 'split' ? splitScrollPositions : noteScrollPositions
  const scrollRef = useRef<HTMLDivElement>(null)
  const attachScroll = useCallback((element: HTMLDivElement | null) => {
    scrollRef.current = element
    return observeEditorScrollSpace(element)
  }, [])
  useEffect(() => {
    if (!focused && selected) void library.activate(selected.id)
  }, [focused, selected?.id])
  // A group that isn't focused still opens at its own place after a restart.
  useLayoutEffect(() => {
    if (!focused && active && scrollRef.current)
      scrollRef.current.scrollTop = scrollPositions.get(active.id) ?? 0
  }, [active?.id])

  if (!active && selected)
    return (
      <div className="note-scroll is-opening">
        {library.noteErrors[selected.id] ? (
          <div className="editor-empty">
            <h2>Couldn’t open this note</h2>
            <p role="alert">{library.noteErrors[selected.id]}</p>
            <button className="btn" onClick={() => void library.load(selected.id)}>
              Try again
            </button>
          </div>
        ) : (
          <div className="editor-empty is-loading" role="status" aria-live="polite">
            <p>Opening note…</p>
          </div>
        )}
      </div>
    )
  if (!active) return <EmptyState />

  const readOnly =
    library.quitting ||
    (!!app.activePdf && active.trashed) ||
    library.syncing ||
    library.converting ||
    !!active.source?.unavailable ||
    !!library.conflicts[active.id] ||
    !!active.source?.trashPath ||
    busyNote === active.id
  const titleError =
    active.source && titleDraft?.id === active.id ? fileTitleError(titleDraft.value) : ''
  const memberships = notebooks.filter((book) => active.notebookIds.includes(book.id))

  return (
    <div
      className="note-scroll"
      ref={attachScroll}
      key={active.id}
      data-note-id={active.id}
      onScroll={(event) => {
        const scroll = event.currentTarget.scrollTop
        scrollPositions.set(active.id, scroll)
        if (focused && app.pairedDocumentId) app.setPdfPreferences({ scroll }, app.pairedDocumentId)
      }}
    >
      {active.trashed && (
        <div className="pane-banner">
          <span>This note is in Trash.</span>
          <button className="btn btn-sm" onClick={() => app.update(active.id, { trashed: false })}>
            Restore note
          </button>
        </div>
      )}
      <article className="note-article">
        <div className="note-meta">
          <span>{noteDate.format(active.updated)}</span>
          <span aria-hidden="true">·</span>
          <NoteStatistics noteId={active.id} />
          <SaveStatus />
        </div>
        <div className="note-title-wrap">
          <div className="note-title-highlights" aria-hidden="true" />
          <input
            ref={focused ? app.titleInput : undefined}
            className="note-title"
            aria-label="Note title"
            placeholder="Untitled"
            spellCheck={app.appearance.spellcheck}
            value={active.source && titleDraft?.id === active.id ? titleDraft.value : active.title}
            readOnly={!!active.source?.unavailable || !!library.conflicts[active.id]}
            aria-invalid={!!titleError || undefined}
            onChange={(event) => {
              app.workspace.keepNoteOpen(active.id)
              if (active.source) app.setTitleDraft({ id: active.id, value: event.target.value })
              else app.update(active.id, { title: event.target.value })
            }}
            onBlur={() => {
              if (titleDraft?.id === active.id) {
                if (fileTitleError(titleDraft.value)) return
                app.update(active.id, { title: titleDraft.value })
                app.setTitleDraft(null)
              }
            }}
            onKeyDown={(event) => {
              if (
                !['Enter', 'ArrowDown'].includes(event.key) ||
                event.nativeEvent.isComposing ||
                library.syncing ||
                library.converting ||
                !!active.source?.unavailable ||
                !!library.conflicts[active.id] ||
                !!active.source?.trashPath ||
                busyNote === active.id ||
                !!titleError
              )
                return
              event.preventDefault()
              ;(group === 'split' ? getSplitEditor : getEditor)(
                active.id,
                libraryProjection.note(libraryStore.getSnapshot(), active.id)!.content,
              ).commands.focus('start')
            }}
            onScroll={(event) => {
              const highlights =
                event.currentTarget.parentElement?.querySelector('.note-title-highlights')
              if (highlights) highlights.scrollLeft = event.currentTarget.scrollLeft
            }}
          />
        </div>
        {titleError && (
          <p className="field-error" role="alert">
            {titleError}
          </p>
        )}
        <div className="note-chips" ref={focused ? app.chipsRef : undefined}>
          {memberships.map((book) => {
            const path = notebookPath(book, notebooks)
            return (
              <AppTooltip key={book.id} label={book.rootId ? `File folder: ${path}` : path}>
                <button
                  data-motion-key={`book:${book.id}`}
                  className="chip note-chip"
                  style={{ '--chip-color': notebookColorValue(book.color) } as React.CSSProperties}
                  aria-label={book.rootId ? `File folder: ${path}` : `Remove from ${path}`}
                  disabled={!!book.rootId}
                  onClick={() =>
                    app.update(active.id, {
                      notebookIds: active.notebookIds.filter((id) => id !== book.id),
                    })
                  }
                >
                  <span
                    className="swatch"
                    style={{ '--swatch': notebookColorValue(book.color) } as React.CSSProperties}
                  />
                  <span className="truncate">{path}</span>
                  {!book.rootId && <X aria-hidden="true" className="ui-icon note-chip-remove" />}
                </button>
              </AppTooltip>
            )
          })}
          <NoteNotebooksMenu
            noteId={active.id}
            file={!!active.source}
            disabled={blocked}
            onAdd={(launcher) => app.openAddToNotebooks(active.id, launcher)}
            onMove={(launcher) => app.setOrganization({ id: active.id, launcher })}
            onError={app.setActionError}
          />
        </div>
        {active.source && (
          <div className="note-file">
            <AppTooltip label={active.source.relativePath}>
              <span className="truncate">{active.source.relativePath}</span>
            </AppTooltip>
            <button
              className="btn btn-plain btn-sm"
              onClick={() => void libraryStore.activate(active.id)}
            >
              Reload file
            </button>
          </div>
        )}
        {active.source?.unavailable && (
          <div role="alert" className="note-file is-error">
            <span>{active.source.unavailable}</span>
            <button
              className="btn btn-plain btn-sm"
              onClick={() => void libraryStore.activate(active.id)}
            >
              Retry
            </button>
            <button
              className="btn btn-plain btn-sm"
              onClick={() => void app.locateFolder(active.source!.rootId)}
            >
              Locate folder
            </button>
          </div>
        )}
        {library.conflicts[active.id] && (
          <div role="alert" className="note-file is-warning">
            <span>This note has conflicting file changes.</span>
            <button className="btn btn-plain btn-sm" onClick={() => app.setConflictId(active.id)}>
              Resolve changes
            </button>
          </div>
        )}
        <NoteEditor
          appearance={app.appearance}
          readOnly={readOnly}
          key={`${active.id}:${library.syncGeneration}`}
          noteId={active.id}
          noteLinks={app.noteLinks}
          onOpenTag={(tag) => app.navigate(`tag:${tag}`)}
          cursorSettings={app.cursorSettings}
          onChange={(content, text) => {
            app.workspace.keepNoteOpen(active.id)
            app.update(active.id, { content, text, hasTasks: undefined })
          }}
        />
      </article>
    </div>
  )
}
