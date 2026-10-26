import Settings from './Settings'
import NotebookConvertDialog from '../components/NotebookConvertDialog'
import NotebookDialog from '../components/NotebookDialog'
import {
  LiveAddToNotebooks as AddToNotebooksPopover,
  LiveFileConflictDialog as FileConflictDialog,
  LiveMoveNoteDialog as MoveNoteDialog,
  LiveNotebookDeleteDialog as NotebookDeleteDialog,
  LiveNoteOrganization as NoteOrganization,
  LiveSyncConnection as SyncConnection,
  SaveFeedback,
} from '../storage/libraryReaders'
import { library as libraryStore } from '../storage/useLibrary'
import { X } from '../icons'
import { trackApp, useApp, useBlocked } from './context'

/** Transient status at the bottom of the window: errors, undo and progress. */
function Notices() {
  const app = useApp()
  const blocked = useBlocked()
  const { notebookMove, actionError, drag, library } = app
  return (
    <div className="notices">
      <SaveFeedback syncNow={app.syncNow} />
      {actionError && (
        <div className="notice" role="alert">
          <span>{actionError.message}</span>
          <button className="btn" onClick={actionError.retry}>
            Retry
          </button>
          <button className="btn" onClick={() => app.setActionError(null)}>
            Dismiss
          </button>
        </div>
      )}
      {drag.draggedId && (
        <div className="notice" role="status" aria-live="polite">
          <span>{drag.target?.hint ?? 'Drag to a notebook to move.'}</span>
        </div>
      )}
      {notebookMove.notice && (
        <div className="notice" role="status" aria-live="polite">
          <span>{notebookMove.notice.message}</span>
          {notebookMove.notice.change && (
            <button
              className="btn"
              disabled={notebookMove.busy || !!notebookMove.failure || blocked}
              onClick={notebookMove.undo}
            >
              Undo
            </button>
          )}
          <button
            className="icon-btn icon-btn-sm"
            aria-label="Dismiss move notice"
            onClick={notebookMove.dismiss}
          >
            <X aria-hidden="true" />
          </button>
        </div>
      )}
      {notebookMove.busy && (
        <div className="notice" role="status">
          <span>Saving notebook change…</span>
        </div>
      )}
      {notebookMove.failure && (
        <div className="notice" role="alert">
          <span>{notebookMove.failure.message}</span>
          {notebookMove.failure.retry ? (
            <button
              className="btn"
              disabled={
                notebookMove.busy || library.syncing || library.converting || library.quitting
              }
              onClick={notebookMove.failure.retry}
            >
              Retry
            </button>
          ) : (
            <button className="btn" onClick={notebookMove.dismissFailure}>
              Dismiss
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default trackApp(function Overlays() {
  const app = useApp()
  const blocked = useBlocked()
  // Notes are read only when a note popover is open, so title edits do not re-render dialogs.
  const { notebooks, appearance, organization, addOrganization, noteContext, library } = app
  return (
    <>
      <Notices />
      {noteContext && (
        <div
          className="menu note-link-context"
          role="menu"
          style={{
            position: 'fixed',
            left: Math.min(noteContext.x, window.innerWidth - 210),
            top: Math.min(noteContext.y, window.innerHeight - 40),
          }}
        >
          <button
            autoFocus
            role="menuitem"
            className="menu-item"
            onClick={() => {
              app.workspace.open(noteContext.id, true)
              app.setNoteContext(null)
            }}
          >
            <span className="menu-text">Open in new tab</span>
          </button>
        </div>
      )}
      {addOrganization && app.notes.some((n) => n.id === addOrganization.id && !n.trashed) && (
        <AddToNotebooksPopover
          key={`add:${addOrganization.id}`}
          noteId={addOrganization.id}
          notebooks={notebooks}
          anchor={addOrganization.anchor}
          launcher={addOrganization.launcher}
          update={(patch) => app.updateNotebookMembership(addOrganization.id, patch)}
          createNotebook={(book) => app.setNotebooks((old) => [...old, book])}
          close={() => app.setAddOrganization(null)}
          disabled={blocked}
        />
      )}
      {organization &&
        app.notes.some((n) => n.id === organization.id && !n.trashed && !n.source) && (
          <MoveNoteDialog
            key={`move:${organization.id}:${organization.destination ?? 'choose'}`}
            anchor={organization.anchor}
            launcher={organization.launcher}
            noteId={organization.id}
            notebooks={notebooks}
            view={organization.view}
            destination={organization.destination}
            move={app.notebookMove.move}
            createNotebook={(book) => app.setNotebooks((old) => [...old, book])}
            close={() => app.setOrganization(null)}
            disabled={
              blocked || !!app.busyNote || app.notebookMove.busy || !!app.notebookMove.failure
            }
          />
        )}
      {organization &&
        app.notes.some((n) => n.id === organization.id && !n.trashed && n.source) && (
          <NoteOrganization
            key={`move-file:${organization.id}`}
            anchor={organization.anchor}
            launcher={organization.launcher}
            noteId={organization.id}
            notebooks={notebooks}
            update={(patch) => app.updateNotebookMembership(organization.id, patch)}
            close={() => app.setOrganization(null)}
            disabled={blocked}
          />
        )}
      <Settings
        onSync={app.syncNow}
        initialCategory={app.settingsCategory}
        syncSettings={app.appearanceOpen ? <SyncConnection /> : undefined}
        open={app.appearanceOpen}
        onOpenChange={app.setAppearanceOpen}
        value={appearance}
        onChange={app.setAppearance}
      />
      <NotebookDialog
        open={app.bookOpen}
        onOpenChange={(open) => {
          app.setBookOpen(open)
          if (!open) {
            app.setBookParent(undefined)
            app.setBookEditing(undefined)
          }
        }}
        parent={app.bookParent}
        notebook={app.bookEditing}
        onCreated={(id) => app.navigate(`book:${id}`)}
        onUpdated={(id, patch) => libraryStore.updateNotebook(id, patch)}
      />
      {app.bookToDelete && notebooks.some((book) => book.id === app.bookToDelete!.id) && (
        <NotebookDeleteDialog
          open
          notebook={app.bookToDelete}
          notebooks={notebooks}
          onConfirm={(options) => app.deleteNotebook(app.bookToDelete!, options)}
          onClose={() => app.setBookToDelete(null)}
        />
      )}
      {app.bookToConvert && (
        <NotebookConvertDialog
          notebook={app.bookToConvert}
          progress={library.conversionProgress}
          onConfirm={() => libraryStore.convertNotebook(app.bookToConvert!.id)}
          onClose={() => app.setBookToConvert(null)}
        />
      )}
      <FileConflictDialog
        noteId={app.conflictId}
        error={app.conflictId ? (library.conflicts[app.conflictId] ?? '') : ''}
        onClose={() => app.setConflictId(null)}
      />
    </>
  )
})
