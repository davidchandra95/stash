import type { Note, View } from './model'
import { tagFooter, tagFooterContent } from './tags'
import { library } from './storage/useLibrary'

// Both shells use the same mutations and save queue; navigation belongs to the shell.
export function useNoteActions(beforeUpdate?: () => void) {
  const update = (id: string, patch: Partial<Note>) => {
    if (['pinned', 'trashed', 'quickAccess', 'notebookIds'].some((key) => key in patch))
      beforeUpdate?.()
    library.patchNote(id, { ...patch, updated: Date.now() })
  }
  const create = (view: View, requestedNotebookId?: string, title = '') => {
    const state = library.getSnapshot()
    if (state.syncing || state.converting || state.quitting) return undefined
    const notebookId = requestedNotebookId ?? (view.startsWith('book:') ? view.slice(5) : undefined)
    const tags = !requestedNotebookId && view.startsWith('tag:') ? [view.slice(4)] : []
    const text = tagFooter(tags)
    const note: Note = {
      id: crypto.randomUUID(),
      title,
      notebookIds: notebookId ? [notebookId] : [],
      quickAccess: false,
      tags,
      text,
      pinned: false,
      trashed: false,
      updated: Date.now(),
      content: {
        type: 'doc',
        content: [tags.length ? tagFooterContent(tags) : { type: 'paragraph' }],
      },
    }
    beforeUpdate?.()
    library.setNotes((old) => [note, ...old])
    return note
  }
  return { update, create, duplicate: library.duplicate }
}
