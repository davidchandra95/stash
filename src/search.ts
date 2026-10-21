import type { Node } from '@tiptap/pm/model'
import type { Note, Notebook } from './model'
import { documentSchema } from './editor/documentSchema'
import {
  documentText,
  literalMatches,
  segmentMatches,
  type DocumentMatch,
  type TextSegment,
} from './editor/searchText'

export type SearchDocument = { note: Note; doc: Node }
export type ContentGroup = SearchDocument & { matches: DocumentMatch[] }
export type MatchNavigation = { noteId: string; query: string; doc: Node; match: DocumentMatch }
export type ReadSearchNote = (id: string) => Promise<Note>

export function notebookContext(note: Note, notebooks: Notebook[]): string {
  return (
    notebooks
      .filter((book) => note.notebookIds.includes(book.id))
      .map((book) => book.name)
      .join(', ') || 'Uncategorized'
  )
}

export type TitleRange = { from: number; to: number }
export type QuickOpenResult = { note: Note; ranges: TitleRange[] }

const titleCharacters = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

function titleMatch(title: string, query: string): { rank: number[]; ranges: TitleRange[] } | null {
  const text = title.toLocaleLowerCase(),
    term = query.toLocaleLowerCase()
  const hits: TitleRange[] = []
  let rank: number[]
  const contained = text.indexOf(term)
  if (contained >= 0) {
    rank = text === term ? [0, 0] : contained === 0 ? [1, 0] : [2, contained]
    hits.push({ from: contained, to: contained + term.length })
  } else {
    let position = 0,
      first = -1,
      last = -1
    for (const letter of term) {
      const found = text.indexOf(letter, position)
      if (found < 0) return null
      if (first < 0) first = found
      last = found
      position = found + letter.length
      hits.push({ from: found, to: position })
    }
    rank = [3, last - first - term.length + 1]
  }

  // Map case-folded offsets back to complete displayed characters, including
  // combining marks, emoji sequences, and characters whose lowercase expands.
  const ranges: TitleRange[] = []
  let foldedOffset = 0,
    hitIndex = 0
  for (const { segment, index } of titleCharacters.segment(title)) {
    const foldedEnd = foldedOffset + segment.toLocaleLowerCase().length
    while (hits[hitIndex] && hits[hitIndex].to <= foldedOffset) hitIndex++
    if (hits[hitIndex] && hits[hitIndex].from < foldedEnd) {
      const previous = ranges.at(-1)
      if (previous?.to === index) previous.to = index + segment.length
      else ranges.push({ from: index, to: index + segment.length })
    }
    foldedOffset = foldedEnd
  }
  return { rank, ranges }
}

export function quickOpenResults(
  notes: Note[],
  query: string,
  recentIds: string[],
): QuickOpenResult[] {
  const available = notes.filter((note) => !note.trashed)
  const term = query.trim()
  if (!term)
    return recentIds.flatMap((id) => {
      const note = available.find((note) => note.id === id)
      return note ? [{ note, ranges: [] }] : []
    })
  const recent = (id: string) => {
    const index = recentIds.indexOf(id)
    return index < 0 ? Infinity : index
  }
  return available
    .flatMap((note) => {
      const match = titleMatch(note.title || 'Untitled note', term)
      return match ? [{ note, ...match }] : []
    })
    .sort(
      (a, b) =>
        a.rank[0] - b.rank[0] ||
        a.rank[1] - b.rank[1] ||
        (recent(a.note.id) === recent(b.note.id)
          ? 0
          : recent(a.note.id) < recent(b.note.id)
            ? -1
            : 1) ||
        b.note.updated - a.note.updated ||
        a.note.id.localeCompare(b.note.id),
    )
    .map(({ note, ranges }) => ({ note, ranges }))
}

export type CommandMatch<T extends { label: string }> = { command: T; ranges: TitleRange[] }

export function commandResults<T extends { label: string; keywords?: string }>(
  commands: T[],
  query: string,
): CommandMatch<T>[] {
  const term = query.trim()
  if (!term) return commands.map((command) => ({ command, ranges: [] }))
  return commands
    .flatMap((command, order) => {
      const match = titleMatch(command.label, term)
      if (match) return [{ command, order, ...match }]
      const hidden = command.keywords && titleMatch(command.keywords, term)
      return hidden ? [{ command, order, rank: [4, hidden.rank[0]], ranges: [] }] : []
    })
    .sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1] || a.order - b.order)
    .map(({ command, ranges }) => ({ command, ranges }))
}

export function quickOpenNotes(notes: Note[], query: string, recentIds: string[]): Note[] {
  return quickOpenResults(notes, query, recentIds).map(({ note }) => note)
}

export function quickTitleParts(
  title: string,
  ranges: TitleRange[],
): { text: string; matched: boolean }[] {
  const parts: { text: string; matched: boolean }[] = []
  let offset = 0
  for (const range of ranges) {
    if (range.from > offset) parts.push({ text: title.slice(offset, range.from), matched: false })
    parts.push({ text: title.slice(range.from, range.to), matched: true })
    offset = range.to
  }
  if (offset < title.length) parts.push({ text: title.slice(offset), matched: false })
  return parts
}

export function searchDocument(note: Note): Node {
  // The search hook owns document reuse and its bounded warm cache. A global
  // JSON-keyed cache would retain every parsed body while library JSON survives.
  const doc = documentSchema(!!note.source).nodeFromJSON(note.content)
  doc.check()
  return doc
}

const segmentCache = new WeakMap<
  Node,
  { references: { id: string; fallback: string; label: string }[]; segments: TextSegment[] }
>()

export function searchSegments(doc: Node, titles: ReadonlyMap<string, string>): TextSegment[] {
  const cached = segmentCache.get(doc)
  if (
    cached &&
    cached.references.every(({ id, fallback, label }) => (titles.get(id) ?? fallback) === label)
  )
    return cached.segments
  const references: { id: string; fallback: string; label: string }[] = []
  const segments = documentText(doc, (id, fallback) => {
    const label = titles.get(id) ?? fallback
    references.push({ id, fallback, label })
    return label
  })
  segmentCache.set(doc, { references, segments })
  return segments
}
export function searchContent(
  documents: SearchDocument[],
  query: string,
  notes: Note[],
): ContentGroup[] {
  const term = query.trim()
  if (!term) return []
  const titles = new Map(notes.map((note) => [note.id, note.title || 'Untitled note']))
  return documents
    .flatMap(({ note, doc }) => {
      if (note.trashed) return []
      const matches = segmentMatches(searchSegments(doc, titles), term)
      return matches.length ? [{ note, doc, matches }] : []
    })
    .sort((a, b) => b.note.updated - a.note.updated || a.note.id.localeCompare(b.note.id))
}

export type SnippetPart = { text: string; highlighted: boolean; target: boolean }
export function matchSnippet(match: DocumentMatch, query: string): SnippetPart[] {
  const text = match.segment.text
  let start = Math.max(0, match.offset - 55),
    end = Math.min(text.length, match.endOffset + 75)
  // Never cut an emoji between its UTF-16 surrogate halves.
  if (start > 0 && /[\uDC00-\uDFFF]/.test(text[start])) start--
  if (end < text.length && /[\uDC00-\uDFFF]/.test(text[end])) end++
  const parts: SnippetPart[] = []
  if (start) parts.push({ text: '…', highlighted: false, target: false })
  let offset = start
  for (const local of literalMatches(text.slice(start, end), query)) {
    const hit = { from: start + local.from, to: start + local.to }
    if (hit.from > offset)
      parts.push({ text: text.slice(offset, hit.from), highlighted: false, target: false })
    parts.push({
      text: text.slice(hit.from, hit.to),
      highlighted: true,
      target: hit.from === match.offset,
    })
    offset = hit.to
  }
  if (offset < end) parts.push({ text: text.slice(offset, end), highlighted: false, target: false })
  if (end < text.length) parts.push({ text: '…', highlighted: false, target: false })
  return parts
}

// A changed document must still contain the same occurrence context. Do not
// silently jump to a different repeated word after a refresh or edit.
export function resolveMatch(
  doc: Node,
  request: MatchNavigation,
  notes: Note[],
): DocumentMatch | undefined {
  const note = notes.find((note) => note.id === request.noteId && !note.trashed)
  if (!note) return undefined
  const groups = searchContent([{ note, doc }], request.query, notes)
  const matches = groups[0]?.matches ?? []
  if (doc.eq(request.doc))
    return matches.find(
      (match) => match.from === request.match.from && match.offset === request.match.offset,
    )
  const candidates = matches.filter(
    (match) =>
      match.segment.text === request.match.segment.text && match.offset === request.match.offset,
  )
  return candidates.length === 1 ? candidates[0] : undefined
}
