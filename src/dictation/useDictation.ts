import { useState } from 'react'
import type { Editor } from '@tiptap/core'
import type { Note } from '../model'
import { peekEditor } from '../editor/session'
import { library } from '../storage/useLibrary'
import { supported } from './client'

export type Target = { editor: Editor; noteId: string; title: string }
export function noteAvailable(id: string) {
  const state = library.getSnapshot()
  const note = state.notes.find((n) => n.id === id)
  return (
    !!note &&
    state.loaded.has(id) &&
    !state.quitting &&
    !state.syncing &&
    !state.converting &&
    !note.trashed &&
    !note.source?.unavailable &&
    !note.source?.trashPath &&
    !state.conflicts[id]
  )
}
export function useDictation(
  active: Pick<Note, 'id' | 'title'> | undefined | null,
  busyNote: string | null,
  split = false,
) {
  const [target, setTarget] = useState<Target | null>(null)
  const canDictate = supported() && !!active && noteAvailable(active.id) && busyNote !== active.id
  const [stopRequest, setStopRequest] = useState(0)
  // The same button or shortcut starts dictation and then stops it for review.
  const startDictation = () => {
    if (target) return setStopRequest((count) => count + 1)
    if (!canDictate || !active) return
    const editor = peekEditor(active.id, split)
    if (!editor || !editor.isEditable || editor.isDestroyed) return
    setTarget({ editor, noteId: active.id, title: active.title })
  }
  return {
    dictationTarget: target,
    dictationStopRequest: stopRequest,
    canDictate,
    startDictation,
    closeDictation: () => setTarget(null),
  }
}
