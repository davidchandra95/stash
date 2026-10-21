import { useEffect, useMemo, useState, type ComponentProps, type ReactNode } from 'react'
import { library, libraryActions, useLibrarySelector, shallowEqual } from './useLibrary'
import { libraryProjection, localDay } from './librarySelectors'
import type { LibraryState } from './library'
import type { View } from '../model'
import NoteEditor from '../components/NoteEditor'
import NoteTools from '../components/NoteTools'
import AddToNotebooksPopover from '../components/AddToNotebooksPopover'
import MoveNoteDialog from '../components/MoveNoteDialog'
import NoteOrganization from '../components/NoteOrganization'
import NotebookDeleteDialog from '../components/NotebookDeleteDialog'
import FileConflictDialog from '../components/FileConflictDialog'
import SyncConnection from '../components/SyncConnection'
import AppTooltip from '../components/AppTooltip'
import { MotionPresence, motion } from '../motion'
import { notePreview } from '../noteListPresentation'

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const weekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'long' })
const dayFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const fullDayFormat = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

/** Finder-style relative dates: time today, then Yesterday, weekday, and date. */
export function noteListDate(timestamp: number, now = Date.now()) {
  const date = new Date(timestamp)
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const days = Math.floor((today.getTime() - new Date(date).setHours(0, 0, 0, 0)) / 86_400_000)
  if (days <= 0) return timeFormat.format(date)
  if (days === 1) return 'Yesterday'
  if (days < 7) return weekdayFormat.format(date)
  if (date.getFullYear() === today.getFullYear()) return dayFormat.format(date)
  return fullDayFormat.format(date)
}

function shellState(state: LibraryState) {
  const {
    notes: _,
    loaded: _loaded,
    status: _status,
    error: _error,
    quitFailed: _quitFailed,
    syncError: _syncError,
    syncProgress: _progress,
    ...shell
  } = state
  return shell
}
export function useLibraryShell() {
  const shell = useLibrarySelector(shellState, shallowEqual)
  const notes = useLibrarySelector(libraryProjection.navigation)
  return { ...shell, notes, ...libraryActions }
}
function useLocalDay() {
  const [day, setDay] = useState(localDay)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const refresh = () => {
      clearTimeout(timer)
      const now = new Date()
      setDay(localDay(now.getTime()))
      const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime()
      timer = setTimeout(refresh, Math.max(1, next - now.getTime()))
    }
    refresh()
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])
  return day
}
export function useNoteIds(
  view: View,
  query: string,
  preferences?: import('../noteOrder').NoteListPreferences,
) {
  const day = useLocalDay()
  const select = useMemo(
    () => libraryProjection.list(view, query, preferences),
    [view, query, preferences, day],
  )
  return useLibrarySelector(select)
}
function useNote(id: string) {
  return useLibrarySelector((state) => libraryProjection.note(state, id))
}
export function LiveNoteEditor({
  noteId,
  ...props
}: Omit<ComponentProps<typeof NoteEditor>, 'note'> & { noteId: string }) {
  const note = useNote(noteId)
  return note ? <NoteEditor {...props} note={note} /> : null
}
export function LiveNoteTools({
  noteId,
  ...props
}: Omit<ComponentProps<typeof NoteTools>, 'note' | 'searchNotes'> & { noteId: string }) {
  const note = useNote(noteId)
  const searchNotes = useLibrarySelector((state) =>
    props.searchNavigation ? state.notes : undefined,
  )
  return note ? <NoteTools {...props} note={note} searchNotes={searchNotes} /> : null
}
export function LiveNoteRow({
  noteId,
  preview,
  children,
}: {
  noteId: string
  preview: boolean
  children: (row: { title: string; preview?: string; date: string }) => ReactNode
}) {
  const row = useLibrarySelector((state) => {
    const note = libraryProjection.note(state, noteId)
    return {
      title: note?.title ?? '',
      preview: preview && note ? notePreview(note.text) : undefined,
      date: note ? noteListDate(note.updated) : '',
    }
  }, shallowEqual)
  return children(row)
}
export function NoteStatistics({ noteId }: { noteId: string }) {
  const text = useLibrarySelector((state) => libraryProjection.note(state, noteId)?.text ?? '')
  const trimmed = text.trim()
  const words = trimmed ? trimmed.split(/\s+/).length : 0
  return (
    <AppTooltip label={`${text.length.toLocaleString('en-US')} characters`}>
      <span>
        {words.toLocaleString('en-US')} {words === 1 ? 'word' : 'words'}
      </span>
    </AppTooltip>
  )
}
export function SaveStatus({ empty = false }: { empty?: boolean }) {
  const state = useLibrarySelector(
    ({ status, path, preview, conflicts }) => ({
      failed: status === 'error',
      path,
      preview,
      conflicts,
    }),
    shallowEqual,
  )
  const label = state.preview
    ? 'Browser preview · session only'
    : !empty && Object.keys(state.conflicts).length
      ? 'File changes need attention'
      : state.failed
        ? 'Couldn’t save'
        : null
  if (!label) return null
  return empty ? (
    <p role="status">{label}</p>
  ) : (
    <AppTooltip label={state.path}>
      <span role="status" className="note-save-status">
        {label}
      </span>
    </AppTooltip>
  )
}
export function SaveFeedback({ syncNow }: { syncNow: () => void }) {
  const state = useLibrarySelector(
    ({ error, quitFailed, syncError, syncStatus, quitting, syncing, syncProgress }) => ({
      error,
      quitFailed,
      syncError,
      syncStatus,
      quitting,
      syncing,
      syncProgress,
    }),
    shallowEqual,
  )
  const syncFailure = !state.error && !state.quitFailed && !!state.syncError
  return (
    <>
      <MotionPresence
        open={!!(state.error || state.quitFailed || state.syncError)}
        duration={motion.notice}
      >
        <div className="notice" role="alert">
          <span>
            <strong>{syncFailure ? 'Couldn’t sync.' : 'Couldn’t save.'}</strong>{' '}
            {state.error || (state.quitFailed ? 'Quit was cancelled.' : state.syncError)}
          </span>
          <button
            className="btn"
            onClick={() =>
              syncFailure
                ? syncNow()
                : void (state.quitFailed ? library.requestQuit() : library.flush().catch(() => {}))
            }
          >
            {syncFailure
              ? state.syncStatus?.configured
                ? 'Retry sync'
                : 'Sync settings'
              : state.quitFailed
                ? 'Retry and quit'
                : 'Retry'}
          </button>
          {state.quitFailed && (
            <button className="btn" onClick={library.keepEditing}>
              Keep editing
            </button>
          )}
        </div>
      </MotionPresence>
      {(state.quitting || state.syncing) && (
        <div className="notice" role="status">
          <span className="spinner" aria-hidden="true" />
          <span>
            {state.syncing ? state.syncProgress || 'Syncing…' : 'Saving before quitting…'}
          </span>
        </div>
      )}
    </>
  )
}
export function LiveSyncConnection() {
  const state = useLibrarySelector(library.getSnapshot)
  return <SyncConnection state={state} />
}
export function LiveAddToNotebooks({
  noteId,
  ...props
}: Omit<ComponentProps<typeof AddToNotebooksPopover>, 'note' | 'notes'> & { noteId: string }) {
  const note = useNote(noteId)
  const notes = useLibrarySelector((state) => state.notes)
  return note ? <AddToNotebooksPopover {...props} note={note} notes={notes} /> : null
}
export function LiveMoveNoteDialog({
  noteId,
  ...props
}: Omit<ComponentProps<typeof MoveNoteDialog>, 'note'> & { noteId: string }) {
  const note = useNote(noteId)
  return note ? <MoveNoteDialog {...props} note={note} /> : null
}
export function LiveNoteOrganization({
  noteId,
  ...props
}: Omit<ComponentProps<typeof NoteOrganization>, 'note' | 'notes'> & { noteId: string }) {
  const note = useNote(noteId)
  const notes = useLibrarySelector((state) => state.notes)
  return note ? <NoteOrganization {...props} note={note} notes={notes} /> : null
}
export function LiveNotebookDeleteDialog(
  props: Omit<ComponentProps<typeof NotebookDeleteDialog>, 'notes'>,
) {
  const notes = useLibrarySelector((state) => state.notes)
  return <NotebookDeleteDialog {...props} notes={notes} />
}

export function LiveFileConflictDialog({
  noteId,
  ...props
}: Omit<ComponentProps<typeof FileConflictDialog>, 'note'> & { noteId: string | null }) {
  const note = useNote(noteId ?? '')
  return <FileConflictDialog {...props} note={note ?? null} />
}
