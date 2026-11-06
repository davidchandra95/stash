import { useCallback, useEffect, useState } from 'react'
import { library, useLibrarySelector } from './useLibrary'

export interface Backlinks {
  /** Null until the first search finishes. */
  notes: { id: string; title: string; notebookIds: string[] }[] | null
  unreadable: number
  error: string | null
  retry: () => void
}
export const noteLinkLabel = (title: string) => title || 'Untitled note'

export function useBacklinks(noteId: string): Backlinks {
  const notes = useLibrarySelector((state) => state.notes)
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{
    ids: string[] | null
    unreadable: number
    error: string | null
  }>({ ids: null, unreadable: 0, error: null })
  useEffect(() => {
    let cancelled = false
    library.backlinks(noteId).then(
      ({ ids, unreadable }) => {
        if (!cancelled) setResult({ ids, unreadable, error: null })
      },
      (error) => {
        if (!cancelled) setResult({ ids: null, unreadable: 0, error: String(error) })
      },
    )
    return () => {
      cancelled = true
    }
    // The summaries change whenever a note is saved, renamed, trashed or synced.
  }, [noteId, notes, attempt])
  const retry = useCallback(() => {
    setResult({ ids: null, unreadable: 0, error: null })
    setAttempt((value) => value + 1)
  }, [])
  return {
    notes:
      result.ids &&
      result.ids.flatMap((id) => {
        const note = notes.find((n) => n.id === id && !n.trashed)
        return note ? [note] : []
      }),
    unreadable: result.unreadable,
    error: result.error,
    retry,
  }
}
