import { useRef, useState } from 'react'
import { library } from './storage/useLibrary'
import {
  moveMembership,
  undoMembership,
  type MembershipChange,
  type MoveIntent,
} from './notebookMove'
import { notebookPath } from './notebooks'

// Retry only flushes the existing save queue: it must not apply the move twice.
export function useNotebookMove(animate: () => void) {
  const running = useRef(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ message: string; change?: MembershipChange } | null>(null)
  const [failure, setFailure] = useState<{ message: string; retry?: () => void } | null>(null)
  const blocked = () => {
    const state = library.getSnapshot()
    return running.current || state.syncing || state.converting || state.quitting
  }
  const persist = async (message: string, change?: MembershipChange) => {
    if (blocked()) return
    running.current = true
    setBusy(true)
    setFailure(null)
    try {
      await library.flush()
      setNotice({ message, change })
    } catch (error) {
      setFailure({
        message: `Notebook change has not been saved. ${String(error)}`,
        retry: () => void persist(message, change),
      })
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  const apply = (noteId: string, ids: string[]) => {
    animate()
    library.setNotes((notes) =>
      notes.map((n) => (n.id === noteId ? { ...n, notebookIds: ids, updated: Date.now() } : n)),
    )
  }
  const move = (intent: MoveIntent): boolean => {
    if (blocked() || failure) return false
    try {
      const state = library.getSnapshot()
      const note = state.notes.find((n) => n.id === intent.noteId)
      const result = moveMembership(note, state.notebooks, intent)
      if (!result.changed) return true
      setNotice(null)
      apply(intent.noteId, result.notebookIds)
      const book = state.notebooks.find((b) => b.id === intent.destination)
      const destination = book ? notebookPath(book, state.notebooks) : 'Uncategorized'
      const message = intent.destination
        ? `Moved “${note!.title || 'Untitled note'}” to ${destination}.`
        : `Removed “${note!.title || 'Untitled note'}” from its selected notebook.`
      void persist(message, result.change)
      return true
    } catch (error) {
      setFailure({ message: String(error) })
      return false
    }
  }
  const undo = () => {
    if (blocked() || failure || !notice?.change) return
    const change = notice.change
    try {
      const state = library.getSnapshot()
      const ids = undoMembership(
        state.notes.find((n) => n.id === change.noteId),
        state.notebooks,
        change,
      )
      apply(change.noteId, ids)
      setNotice(null)
      void persist('Notebook move undone.')
    } catch (error) {
      setFailure({ message: String(error) })
    }
  }
  return {
    move,
    undo,
    busy,
    notice,
    failure,
    dismiss: () => setNotice(null),
    dismissFailure: () => setFailure(null),
  }
}
