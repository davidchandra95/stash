import type { Editor, JSONContent } from '@tiptap/core'
import { Fragment } from '@tiptap/pm/model'
import { closeHistory } from '@tiptap/pm/history'
import { type Transaction } from '@tiptap/pm/state'

/** Track one insertion through later edits. Undo deletes only an unchanged capture. */
export function appendCapture(editor: Editor, content: JSONContent[]) {
  const fragment = Fragment.fromArray(content.map((node) => editor.schema.nodeFromJSON(node)))
  // The final paragraph belongs to subsequent writing, not to the quote being tracked.
  const trailing = fragment.lastChild
  const hasWritingParagraph = trailing?.type.name === 'paragraph' && trailing.content.size === 0
  const captured = hasWritingParagraph
    ? fragment.cut(0, fragment.size - trailing.nodeSize)
    : fragment
  let from = editor.state.doc.content.size
  let to = from + captured.size
  let valid = true
  const selection = editor.state.selection.getBookmark()
  const tr = closeHistory(editor.state.tr).insert(from, fragment)
  tr.setSelection(selection.resolve(tr.doc))
  editor.view.dispatch(tr)
  editor.view.dispatch(closeHistory(editor.state.tr))
  const map = ({ transaction }: { transaction: Transaction }) => {
    if (!valid || !transaction.docChanged) return
    for (const step of transaction.mapping.maps) {
      step.forEach((start, end) => {
        if ((start < to && end > from) || (start === end && start > from && start < to))
          valid = false
      })
      from = step.map(from, 1)
      to = step.map(to, -1)
    }
  }
  editor.on('transaction', map)
  const dispose = () => {
    editor.off('transaction', map)
  }
  const available = () =>
    valid &&
    !editor.isDestroyed &&
    from < to &&
    editor.state.doc.slice(from, to).content.eq(captured)
  return {
    editor,
    dispose,
    view() {
      if (!available()) throw Error('This capture has been edited or removed.')
      editor.commands.setTextSelection(Math.min(editor.state.doc.content.size - 1, to + 1))
      editor.commands.focus(undefined, { scrollIntoView: false })
      editor.commands.scrollIntoView()
    },
    undo() {
      if (!available())
        throw Error('This capture has been edited or removed. Use the note editor to change it.')
      if (!editor.isEditable) throw Error('This note cannot be edited right now.')
      dispose()
      const after = editor.state.doc.nodeAt(to)
      const end = hasWritingParagraph && after?.eq(trailing!) ? to + after.nodeSize : to
      const tr = closeHistory(editor.state.tr).delete(from, end)
      tr.setSelection(editor.state.selection.getBookmark().map(tr.mapping).resolve(tr.doc))
      editor.view.dispatch(tr)
      editor.view.dispatch(closeHistory(editor.state.tr))
      valid = false
    },
  }
}
export type CaptureReceipt = ReturnType<typeof appendCapture>
