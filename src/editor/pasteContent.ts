import type { Editor, JSONContent } from '@tiptap/core'
import { Fragment, Slice } from '@tiptap/pm/model'

// Paragraph edges join the text at the cursor, as in a normal editor paste.
// Structural blocks such as headings, lists, and tables keep their boundaries.
export function insertPastedContent(editor: Editor, content: JSONContent) {
  const nodes = (content.type === 'doc' ? (content.content ?? []) : [content]).map((node) =>
    editor.schema.nodeFromJSON(node),
  )
  if (!nodes.length) return
  const slice = new Slice(
    Fragment.fromArray(nodes),
    nodes[0].type.name === 'paragraph' ? 1 : 0,
    nodes.at(-1)?.type.name === 'paragraph' ? 1 : 0,
  )
  editor.view.dispatch(
    editor.state.tr.replaceSelection(slice).setMeta('paste', true).scrollIntoView(),
  )
}
