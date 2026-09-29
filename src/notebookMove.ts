import type { Note, Notebook, View } from './model'
import { notebookPath } from './notebooks'

export type MoveIntent = { noteId: string; destination: string; source: string | null }
export type MembershipChange = MoveIntent & { addedDestination: boolean }
export type MoveTarget = { id: string; allowed: boolean; hint: string }

export function moveSource(note: Note, view: View): string | null | undefined {
  if (view.startsWith('book:')) return view.slice(5)
  return note.notebookIds.length > 1 ? undefined : (note.notebookIds[0] ?? null)
}

export function moveUnavailable(
  note: Note | undefined,
  destination: string,
  books: Notebook[],
): string | null {
  if (!note || note.trashed) return 'This note cannot be moved.'
  if (note.source) return 'Linked files cannot be moved by dragging. Use Move file to notebook.'
  if (destination === '') return null
  const book = books.find((b) => b.id === destination)
  if (!book) return 'This notebook is no longer available.'
  return book.rootId ? 'Moving into linked folders is not available here.' : null
}

export function notebookMoveTarget(
  note: Note | undefined,
  view: View,
  destination: string,
  books: Notebook[],
): MoveTarget {
  const unavailable = moveUnavailable(note, destination, books)
  if (unavailable) return { id: destination, allowed: false, hint: unavailable }
  const source = moveSource(note!, view)
  const name = destination
    ? notebookPath(
        books.find((b) => b.id === destination)!,
        books,
      )
    : 'Uncategorized'
  if (
    source &&
    (!note!.notebookIds.includes(source) || !books.some((b) => b.id === source && !b.rootId))
  )
    return { id: destination, allowed: false, hint: 'The source notebook is no longer available.' }
  if (source === destination)
    return { id: destination, allowed: false, hint: 'Already in this notebook.' }
  if (source === undefined)
    return { id: destination, allowed: true, hint: 'Choose source to move here.' }
  const from = books.find((b) => b.id === source)
  const fromName = from ? notebookPath(from, books) : 'Uncategorized'
  return {
    id: destination,
    allowed: true,
    hint: note!.notebookIds.includes(destination)
      ? `Already in ${name}. Remove from ${fromName}.`
      : `Move from ${fromName} to ${name}`,
  }
}

export function moveMembership(note: Note | undefined, books: Notebook[], intent: MoveIntent) {
  const error = moveUnavailable(note, intent.destination, books)
  if (error) throw new Error(error)
  if (
    intent.source !== null &&
    (!books.some((b) => b.id === intent.source && !b.rootId) ||
      !note!.notebookIds.includes(intent.source))
  )
    throw new Error('The source notebook changed. Choose the source again.')
  if (intent.source === null && note!.notebookIds.length)
    throw new Error('This note now belongs to a notebook. Choose the source again.')
  const ids = note!.notebookIds
  const next =
    intent.source === intent.destination
      ? ids
      : [
          ...ids.filter((id) => id !== intent.source),
          ...(intent.destination && !ids.includes(intent.destination) ? [intent.destination] : []),
        ]
  return {
    notebookIds: next,
    changed: next.length !== ids.length || next.some((id, i) => id !== ids[i]),
    change: {
      ...intent,
      addedDestination: !!intent.destination && !ids.includes(intent.destination),
    },
  }
}

export function undoMembership(
  note: Note | undefined,
  books: Notebook[],
  change: MembershipChange,
): string[] {
  if (!note || note.trashed || note.source)
    throw new Error('This note can no longer be moved back.')
  if (change.source && !books.some((b) => b.id === change.source && !b.rootId))
    throw new Error('The original notebook is no longer available.')
  const ids = note.notebookIds.filter(
    (id) => !(change.addedDestination && id === change.destination),
  )
  return [...ids, ...(change.source && !ids.includes(change.source) ? [change.source] : [])]
}
