import { useEffect, useRef, useState } from 'react'
import { library } from './useLibrary'
import { libraryProjection } from './librarySelectors'
import type { LibraryState } from './library'
import type { Note } from '../model'
import { isEditorContent } from '../editor/session'

/** How long typing must pause before views other than the editor follow it. */
export const settleDelayMs = 300

// Fields that follow every keystroke. Editors already show their own edits.
const typedFields = new Set(['content', 'text', 'updated', 'tags'])
/** Equal unless something other than the editor's own typing changed the note. */
export function sameEditorNote(a: Note | undefined, b: Note | undefined) {
  if (a === b) return true
  if (!a || !b) return false
  // Only new content the editor produced counts as typing; other changes show at once.
  const typing = a.content !== b.content && isEditorContent(b.content)
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  return (
    typing &&
    [...keys].every((key) => typedFields.has(key) || a[key as keyof Note] === b[key as keyof Note])
  )
}
/** Lists that differ only by the editor's own typing. */
export function sameEditorNotes(a: readonly Note[], b: readonly Note[]) {
  return a.length === b.length && a.every((note, index) => sameEditorNote(note, b[index]))
}
/** Library states that differ only by the editor's own typing. */
export function sameEditorState(a: LibraryState, b: LibraryState) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...keys].every((key) =>
    key === 'notes'
      ? sameEditorNotes(a.notes, b.notes)
      : a[key as keyof LibraryState] === b[key as keyof LibraryState],
  )
}

// Every view waiting for typing to pause shares one timer, so they update in a single render.
const pending = new Set<() => void>()
let settleTimer: ReturnType<typeof setTimeout> | undefined
function applyWhenSettled(apply: () => void) {
  pending.add(apply)
  clearTimeout(settleTimer)
  settleTimer = setTimeout(() => {
    const ready = [...pending]
    pending.clear()
    ready.forEach((run) => run())
  }, settleDelayMs)
}

/**
 * A library value for views that need not follow each keystroke: panels, dialogs, lists.
 * When a change is only the editor's own typing (`typed`), the view follows once typing
 * pauses; any other change shows at once. `key` identifies what is selected, such as a note id.
 * Changes that `looksSame` reports as invisible to the view do not render it at all.
 */
export function useSettledLibrary<T>(
  select: (state: LibraryState) => T,
  typed: (previous: T, next: T) => boolean,
  key = '',
  looksSame: (previous: T, next: T) => boolean = Object.is,
) {
  const latest = useRef({ select, typed, looksSame })
  latest.current = { select, typed, looksSame }
  const [settled, setSettled] = useState(() => ({ key, value: select(library.getSnapshot()) }))
  useEffect(() => {
    let current = latest.current.select(library.getSnapshot())
    // What the view last rendered.
    let rendered = current
    const apply = () => {
      rendered = current
      setSettled({ key, value: current })
    }
    setSettled((previous) =>
      previous.key === key && Object.is(previous.value, current)
        ? previous
        : { key, value: current },
    )
    const unsubscribe = library.subscribe(() => {
      const next = latest.current.select(library.getSnapshot())
      if (Object.is(next, current)) return
      const deferred = latest.current.typed(current, next)
      current = next
      pending.delete(apply)
      if (latest.current.looksSame(rendered, next)) return
      if (deferred) applyWhenSettled(apply)
      else apply()
    })
    return () => {
      pending.delete(apply)
      unsubscribe()
    }
  }, [key])
  // A new key shows its own value at once, before the subscription catches up.
  return settled.key === key ? settled.value : select(library.getSnapshot())
}

export const useSettledNote = (id: string) =>
  useSettledLibrary((state) => libraryProjection.note(state, id), sameEditorNote, id)
const allNotes = (state: LibraryState) => state.notes
export const useSettledNotes = () => useSettledLibrary(allNotes, sameEditorNotes)
const wholeState = (state: LibraryState) => state
export const useSettledState = () => useSettledLibrary(wholeState, sameEditorState)
