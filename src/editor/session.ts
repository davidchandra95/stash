import { platform } from '../platform'
import { Editor, type JSONContent } from '@tiptap/core'
import { writingExtensions } from './extensions'
import { markdownExtensions } from './markdown'
// One live document per note, kept in memory until reload. Remounting EditorContent
// changes its DOM host, not its document, selection, stored marks, or undo stack.
const callbacks = new Map<string, (content: JSONContent, text: string) => void>()
const sessions = new Map<string, Editor>()
export function getEditor(
  id: string,
  content: JSONContent,
  onChange?: (content: JSONContent, text: string) => void,
  markdown = false,
) {
  if (onChange) callbacks.set(id, onChange)
  let editor = sessions.get(id)
  if (!editor || editor.isDestroyed) {
    editor = new Editor({
      extensions: (markdown ? markdownExtensions : writingExtensions).filter(
        (extension) => !platform.mobile || extension.name !== 'writingCursorLayer',
      ),
      coreExtensionOptions: { clipboardTextSerializer: { blockSeparator: '\n' } },
      content,
      onUpdate: ({ editor: current }) => callbacks.get(id)?.(current.getJSON(), current.getText()),
      editorProps: { attributes: { 'aria-label': 'Note content', spellcheck: 'true' } },
    })
    sessions.set(id, editor)
  }
  return editor
}
export function resetSession(id: string) {
  sessions.get(id)?.destroy()
  sessions.delete(id)
  callbacks.delete(id)
}
export function clearSessions() {
  sessions.forEach((editor) => editor.destroy())
  sessions.clear()
  callbacks.clear()
}
if (import.meta.hot) import.meta.hot.dispose(clearSessions)
