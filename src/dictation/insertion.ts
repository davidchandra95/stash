import type { Editor } from '@tiptap/core'
import { closeHistory } from '@tiptap/pm/history'

/** Inserts at the note's cursor as it is now; the note stays editable while dictating. */
export function insertTranscript(editor: Editor, text: string) {
  if (editor.isDestroyed || !editor.isEditable)
    throw new Error('This note is no longer editable. Copy the text instead.')
  if (!text.trim()) throw new Error('The transcript is empty.')
  // insertText treats HTML and Markdown literally and inserts without deleting the selection.
  const position = editor.state.selection.from
  editor.view.dispatch(
    closeHistory(editor.state.tr).insertText(text, position, position).scrollIntoView(),
  )
  editor.view.dispatch(closeHistory(editor.state.tr))
}
