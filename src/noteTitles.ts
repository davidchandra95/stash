import type { JSONContent } from '@tiptap/core'

const maxTitleLength = 100
// Notes created with "First line" titles keep following their first line until the title is
// edited by hand. This lasts for the session; after a restart the derived title stays as saved.
const firstLineNotes = new Set<string>()

export const followFirstLine = (id: string) => firstLineNotes.add(id)
export const stopFollowingFirstLine = (id: string) => firstLineNotes.delete(id)
export const followsFirstLine = (id: string) => firstLineNotes.has(id)

const textOf = (node: JSONContent): string => node.text ?? (node.content ?? []).map(textOf).join('')

// The "Tags: #a #b" paragraph added to notes created from a tag view.
const isTagFooter = (node: JSONContent) =>
  node.type === 'paragraph' &&
  node.content?.[0]?.text === 'Tags: ' &&
  node.content
    .slice(1)
    .every((child) => !child.text?.trim() || child.marks?.some((mark) => mark.type === 'bodyTag'))

/** The text of the first non-empty text block, ignoring a tag footer. */
export function titleFromFirstLine(doc: JSONContent): string {
  const visit = (node: JSONContent): string => {
    if (isTagFooter(node)) return ''
    if (node.content?.some((child) => child.type === 'text' || child.type === 'hardBreak')) {
      const line = (node.content ?? [])
        .map((child) => (child.type === 'hardBreak' ? '\n' : textOf(child)))
        .join('')
        .split('\n')
        .find((part) => part.trim())
      return line?.trim().slice(0, maxTitleLength).trim() ?? ''
    }
    for (const child of node.content ?? []) {
      const title = visit(child)
      if (title) return title
    }
    return ''
  }
  return visit(doc)
}
