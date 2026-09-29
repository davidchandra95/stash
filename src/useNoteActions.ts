import type { Note, View } from './model'
import { tagFooter, tagsFromText } from './tags'
import { library } from './storage/useLibrary'

// Both shells use the same mutations and save queue; navigation belongs to the shell.
export function useNoteActions(beforeUpdate?: () => void) {
  const update = (id: string, patch: Partial<Note>) => {
    if (['pinned', 'trashed', 'quickAccess', 'notebookIds'].some((key) => key in patch))
      beforeUpdate?.()
    const previous = library.getSnapshot().notes.find((n) => n.id === id)
    library.setNotes((old) =>
      old.map((n) => (n.id === id ? { ...n, ...patch, updated: Date.now() } : n)),
    )
    if (previous?.source && ['title', 'trashed', 'notebookIds'].some((key) => key in patch))
      void library.flush().catch(() => {})
  }
  const create = (view: View, requestedNotebookId?: string, title = '') => {
    const state = library.getSnapshot()
    if (state.syncing || state.converting || state.quitting) return undefined
    const notebookId = requestedNotebookId ?? (view.startsWith('book:') ? view.slice(5) : undefined)
    const text = !requestedNotebookId && view.startsWith('tag:') ? tagFooter([view.slice(4)]) : ''
    const note: Note = {
      id: crypto.randomUUID(),
      title,
      notebookIds: notebookId ? [notebookId] : [],
      quickAccess: false,
      tags: tagsFromText(text),
      text,
      pinned: false,
      trashed: false,
      updated: Date.now(),
      content: {
        type: 'doc',
        content: [{ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) }],
      },
    }
    beforeUpdate?.()
    library.setNotes((old) => [note, ...old])
    return note
  }
  return { update, create, duplicate: library.duplicate }
}
