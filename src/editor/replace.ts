import type { Editor } from '@tiptap/core'
import { closeHistory } from '@tiptap/pm/history'
import { documentMatches, type TextMatch } from './searchText'

// Search includes source/reference labels. Only actual editable text is writable.
export function replaceBodyText(
  editor: Editor,
  query: string,
  replacement: string,
  target?: TextMatch,
) {
  if (editor.isDestroyed || !editor.isEditable) return null
  const matches = documentMatches(editor.state.doc, query).filter(
    (match) => !match.atom && (!target || (match.from === target.from && match.to === target.to)),
  )
  if (!matches.length) return null
  const tr = closeHistory(editor.state.tr)
  for (const match of [...matches].reverse()) {
    const marks = tr.doc.resolve(match.from).nodeAfter?.marks ?? []
    if (replacement) tr.replaceWith(match.from, match.to, editor.schema.text(replacement, marks))
    else tr.delete(match.from, match.to)
  }
  editor.view.dispatch(tr)
  editor.view.dispatch(closeHistory(editor.state.tr))
  return { count: matches.length, next: matches[0].from + replacement.length }
}
