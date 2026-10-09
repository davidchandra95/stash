import type { noteNotebookContext } from '../noteListPresentation'

export default function NoteListNotebook({
  context,
}: {
  context: ReturnType<typeof noteNotebookContext>
}) {
  return (
    <span className="note-list-notebook" aria-label={context.description}>
      <span>{context.name}</span>
      {context.extra > 0 && <span className="note-list-notebook-extra">+{context.extra}</span>}
    </span>
  )
}
