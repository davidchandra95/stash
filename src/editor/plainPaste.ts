import { insertPastedContent } from './pasteContent'
import type { Editor } from '@tiptap/core'
import type { Transaction } from '@tiptap/pm/state'
import { closeHistory } from '@tiptap/pm/history'
import { readText } from '@tauri-apps/plugin-clipboard-manager'
export function insertLiteral(editor: Editor, text: string) {
  editor.view.dispatch(closeHistory(editor.state.tr))
  if (editor.isActive('codeBlock') || !/[\r\n]/.test(text))
    editor.view.dispatch(editor.state.tr.insertText(text))
  else
    insertPastedContent(editor, {
      type: 'doc',
      content: text.split(/\r\n?|\n/).map((line) => ({
        type: 'paragraph',
        content: line ? [{ type: 'text', text: line }] : [],
      })),
    })
  editor.view.dispatch(closeHistory(editor.state.tr))
}
export function canReadClipboard() {
  return '__TAURI_INTERNALS__' in window || !!navigator.clipboard?.readText
}
export async function pastePlain(
  editor: Editor,
  read = () => ('__TAURI_INTERNALS__' in window ? readText() : navigator.clipboard.readText()),
) {
  let bookmark = editor.state.selection.getBookmark()
  const map = ({ transaction }: { transaction: Transaction }) => {
    bookmark = bookmark.map(transaction.mapping)
  }
  editor.on('transaction', map)
  try {
    const text = await read()
    if (!editor.isDestroyed && text) {
      editor.view.dispatch(editor.state.tr.setSelection(bookmark.resolve(editor.state.doc)))
      insertLiteral(editor, text)
    }
  } catch {
    if (!editor.isDestroyed)
      editor.view.dom.dispatchEvent(
        new CustomEvent('writing-error', {
          detail: 'Could not read the clipboard. Try Edit > Paste.',
          bubbles: true,
        }),
      )
  } finally {
    editor.off('transaction', map)
  }
}
