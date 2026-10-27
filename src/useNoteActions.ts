import type { Note, View } from './model'
import { tagFooter, tagFooterContent } from './tags'
import { library } from './storage/useLibrary'
import {
  followFirstLine,
  followsFirstLine,
  stopFollowingFirstLine,
  titleFromFirstLine,
} from './noteTitles'

// Both shells use the same mutations and save queue; navigation belongs to the shell.
export function useNoteActions(beforeUpdate?: () => void) {
  const update = (id: string, patch: Partial<Note>) => {
    if (['pinned', 'trashed', 'quickAccess', 'notebookIds'].some((key) => key in patch))
      beforeUpdate?.()
    if ('title' in patch) stopFollowingFirstLine(id)
    else if (patch.content && followsFirstLine(id))
      patch = { ...patch, title: titleFromFirstLine(patch.content) }
    library.patchNote(id, { ...patch, updated: Date.now() })
  }
  const create = (view: View, requestedNotebookId?: string, title = '') => {
    const state = library.getSnapshot()
    if (state.syncing || state.converting || state.quitting) return undefined
    const { appearance, notebooks } = state
    // The default notebook applies outside notebook views, except where it would hide the note.
    const fallbackId =
      view === 'uncategorized'
        ? undefined
        : notebooks.find((book) => book.id === appearance.defaultNotebookId)?.id
    const notebookId =
      requestedNotebookId ?? (view.startsWith('book:') ? view.slice(5) : fallbackId)
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
    // Notes in linked folders are files named by their title, so they keep the title field.
    const linked = notebooks.some((book) => book.id === notebookId && book.rootId)
    if (!title && !linked && appearance.newNoteTitle === 'firstLine') followFirstLine(note.id)
    beforeUpdate?.()
    library.setNotes((old) => [note, ...old])
    return note
  }
  return { update, create, duplicate: library.duplicate }
}
