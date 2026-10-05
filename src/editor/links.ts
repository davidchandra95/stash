import { isPdfLink, parsePdfCitation } from '../pdf/citations'
import { getMarkRange, type ChainedCommands, type Editor } from '@tiptap/core'
import type { Mark } from '@tiptap/pm/model'
import {
  TextSelection,
  type Selection,
  type SelectionBookmark,
  type Transaction,
} from '@tiptap/pm/state'

export interface LinkTarget {
  bookmark: SelectionBookmark
  title: string
  href: string
  titleEditable: boolean
  marks: readonly Mark[]
}

function inlineText(selection: Selection) {
  if (!selection.$from.sameParent(selection.$to) || !selection.$from.parent.isTextblock)
    return false
  let textOnly = true
  selection.content().content.descendants((node) => {
    if (node.isInline && !node.isText) textOnly = false
  })
  return textOnly
}

export function captureLinkTarget(editor: Editor, selection = editor.state.selection): LinkTarget {
  const range = getMarkRange(selection.$from, editor.schema.marks.link)
  if (range && selection.to <= range.to)
    selection = TextSelection.create(editor.state.doc, range.from, range.to)
  const href =
    selection.$from.parent
      .childAfter(selection.$from.parentOffset)
      .node?.marks.find((mark) => mark.type.name === 'link')?.attrs.href ?? ''
  return {
    bookmark: selection.getBookmark(),
    title: selection.$from.doc.textBetween(selection.from, selection.to, ' '),
    href,
    titleEditable: inlineText(selection),
    marks: selection.empty
      ? (editor.state.storedMarks ?? selection.$from.marks())
      : (selection.$from.nodeAfter?.marks ?? selection.$from.marks()),
  }
}

export function mapLinkTarget(target: LinkTarget | null, transaction: Transaction) {
  return target ? { ...target, bookmark: target.bookmark.map(transaction.mapping) } : null
}

export function validLinkAddress(href: string, markdown = false) {
  if (isPdfLink(href)) return !!parsePdfCitation(href)
  return markdown
    ? !!href && !/^(?!https?:|mailto:|upnote2:)[a-z][a-z0-9+.-]*:/i.test(href)
    : /^(https?:\/\/|mailto:)/i.test(href)
}

export function applyLink(
  chain: ChainedCommands,
  target: LinkTarget,
  title: string,
  href: string,
  markdown = false,
) {
  return chain.command(({ tr, state, dispatch, editor }) => {
    if (!editor.isEditable || !validLinkAddress(href, markdown)) return false
    const selection = target.bookmark.map(tr.mapping).resolve(tr.doc)
    const { from, to } = selection
    const rename = target.titleEditable && inlineText(selection) && title !== target.title
    if (!dispatch) return true
    tr.setSelection(selection)
    if (selection.empty || rename) {
      const label = title || href
      const marks = target.marks.filter((mark) => mark.type.name !== 'link')
      marks.push(state.schema.marks.link.create({ href }))
      tr.replaceWith(from, to, state.schema.text(label, marks))
      tr.setSelection(TextSelection.create(tr.doc, from + label.length))
    } else tr.addMark(from, to, state.schema.marks.link.create({ href }))
    tr.scrollIntoView()
    return true
  })
}

export function removeLink(chain: ChainedCommands, target: LinkTarget) {
  return chain.command(({ tr, state, dispatch, editor }) => {
    if (!editor.isEditable) return false
    const selection = target.bookmark.map(tr.mapping).resolve(tr.doc)
    if (dispatch) {
      tr.setSelection(selection)
      tr.removeMark(selection.from, selection.to, state.schema.marks.link)
    }
    return true
  })
}
