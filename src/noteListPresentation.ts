import type { Note, Notebook } from './model'
import { notebookPath } from './notebooks'

export type NoteListMode = 'compact' | 'preview'
export const noteListModes: Record<NoteListMode, string> = {
  compact: 'Compact',
  preview: 'Preview',
}
export const normalizeNoteListMode = (value: unknown): NoteListMode =>
  value === 'preview' ? 'preview' : 'compact'

export function notePreview(text: string): string {
  return text.trim().replace(/\s+/g, ' ').slice(0, 280) || 'No text preview'
}

export function noteNotebookContext(note: Pick<Note, 'notebookIds'>, notebooks: Notebook[]) {
  const books = [...new Set(note.notebookIds)]
    .map((id) => notebooks.find((book) => book.id === id))
    .filter((book): book is Notebook => !!book)
  return {
    name: books[0]?.name ?? 'Uncategorized',
    extra: Math.max(0, books.length - 1),
    description: books.length
      ? `Notebooks: ${books.map((book) => notebookPath(book, notebooks)).join(', ')}`
      : 'Uncategorized',
  }
}
