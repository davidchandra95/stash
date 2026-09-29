import { matchesView, type Note, type View } from './model'

export type NoteSortMode = 'lastEdited' | 'title' | 'custom'
export type NoteListPreferences = { mode: NoteSortMode; order: string[] }
export const sortLabels: Record<NoteSortMode, string> = {
  lastEdited: 'Last edited',
  title: 'Title',
  custom: 'Custom',
}
export function sortNotes(notes: Note[], preferences?: NoteListPreferences): Note[] {
  const rank = new Map((preferences?.order ?? []).map((id, index) => [id, index]))
  return [...notes].sort((a, b) => {
    const pinned = Number(b.pinned) - Number(a.pinned)
    if (pinned) return pinned
    if (preferences?.mode === 'title')
      return a.title.localeCompare(b.title) || a.id.localeCompare(b.id)
    if (preferences?.mode === 'custom') {
      const ar = rank.get(a.id),
        br = rank.get(b.id)
      if (ar !== undefined || br !== undefined) return (ar ?? -1) - (br ?? -1)
    }
    return b.updated - a.updated || a.id.localeCompare(b.id)
  })
}
/** Retain absent IDs in their saved slots, while updating the visible sequence. */
export function retainAbsent(order: string[], current: string[]): string[] {
  const present = new Set(current)
  const result = [...current]
  order.forEach((id, index) => {
    if (!present.has(id)) result.splice(Math.min(index, result.length), 0, id)
  })
  return [...new Set(result)]
}
export function moveNote(visible: Note[], id: string, target: string): Note[] {
  const from = visible.findIndex((n) => n.id === id),
    to = visible.findIndex((n) => n.id === target)
  if (from < 0 || to < 0 || visible[from].pinned !== visible[to].pinned) return visible
  const next = [...visible]
  next.splice(to, 0, ...next.splice(from, 1))
  return next
}
export function reorderSlots(all: Note[], visible: Note[], previous: string[] = []): string[] {
  const ids = new Set(visible.map((n) => n.id))
  let index = 0
  return retainAbsent(
    previous,
    all.map((n) => (ids.has(n.id) ? visible[index++].id : n.id)),
  )
}

/** Library snapshots include trashed and temporarily unavailable linked notes. */
export function reconcileNoteLists(
  lists: Record<string, NoteListPreferences>,
  notes: Note[],
  notebookIds: string[],
): Record<string, NoteListPreferences> {
  const known = new Set(notes.map((note) => note.id))
  const books = new Set(notebookIds)
  return Object.fromEntries(
    Object.entries(lists)
      .filter(([view]) => !view.startsWith('book:') || books.has(view.slice(5)))
      .map(([view, preferences]) => {
        const order = preferences.order.filter((id) => known.has(id))
        return [
          view,
          {
            ...preferences,
            order:
              preferences.mode === 'custom'
                ? retainAbsent(
                    order,
                    sortNotes(
                      notes.filter((note) => matchesView(note, view as View)),
                      { ...preferences, order },
                    ).map((note) => note.id),
                  )
                : order,
          },
        ]
      }),
  )
}
