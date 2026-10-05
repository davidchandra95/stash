import type { Node } from '@tiptap/pm/model'

export type TextMatch = { from: number; to: number }
export type TextSegment = {
  text: string
  from: number
  to: number
  atom?: boolean
  nodeType?: string
}
export type DocumentMatch = TextMatch & {
  segment: TextSegment
  offset: number
  endOffset: number
  atom?: boolean
}
export type ReferenceLabel = (id: string, fallback: string) => string

export function literalMatches(text: string, query: string): TextMatch[] {
  if (!query) return []
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu')
  return [...text.matchAll(pattern)].map((m) => ({ from: m.index!, to: m.index! + m[0].length }))
}

// Each segment is a searchable run with stable document positions. Formatting
// does not split text; blocks, hard breaks, and inline atoms do.
export function documentText(doc: Node, referenceLabel?: ReferenceLabel): TextSegment[] {
  const segments: TextSegment[] = []
  const atom = (node: Node, pos: number) => {
    const text =
      node.type.name === 'rawMarkdown'
        ? String(node.attrs.source ?? '')
        : node.type.name === 'noteReference'
          ? (referenceLabel?.(node.attrs.noteId, node.attrs.fallbackTitle) ??
            node.attrs.fallbackTitle)
          : ''
    if (text)
      segments.push({
        text,
        from: pos,
        to: pos + node.nodeSize,
        atom: true,
        nodeType: node.type.name,
      })
  }
  doc.descendants((node, pos) => {
    if (node.isAtom && !node.isText) {
      atom(node, pos)
      return false
    }
    if (!node.isTextblock) return
    let text = '',
      start = pos + 1
    const flush = () => {
      if (text) segments.push({ text, from: start, to: start + text.length })
      text = ''
    }
    node.forEach((child, offset) => {
      if (child.isText) {
        if (!text) start = pos + 1 + offset
        text += child.text!
      } else {
        flush()
        atom(child, pos + 1 + offset)
      }
    })
    flush()
    return false
  })
  return segments
}

export function segmentMatches(segments: TextSegment[], query: string): DocumentMatch[] {
  return segments.flatMap((segment) =>
    literalMatches(segment.text, query).map((match) => ({
      from: segment.atom ? segment.from : segment.from + match.from,
      to: segment.atom ? segment.to : segment.from + match.to,
      segment,
      offset: match.from,
      endOffset: match.to,
      ...(segment.atom ? { atom: true } : {}),
    })),
  )
}

export function documentMatches(
  doc: Node,
  query: string,
  referenceLabel?: ReferenceLabel,
): DocumentMatch[] {
  return query ? segmentMatches(documentText(doc, referenceLabel), query) : []
}
