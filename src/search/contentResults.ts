import type { Node } from '@tiptap/pm/model'
import type { DocumentMatch } from '../editor/searchText'
import type { ContentGroup } from '../search'

export type MatchAnchor = { noteId: string; doc: Node; from: number; offset: number; text: string }
export type ResultRow = {
  group: ContentGroup
  match?: DocumentMatch
  matchIndex: number
  rowIndex: number
  groupIndex: number
}
const documentIds = new WeakMap<Node, number>()
let nextDocumentId = 0

export function matchAnchor(group: ContentGroup, match: DocumentMatch): MatchAnchor {
  return {
    noteId: group.note.id,
    doc: group.doc,
    from: match.from,
    offset: match.offset,
    text: match.segment.text,
  }
}
export function resultKey(row: ResultRow) {
  let id = documentIds.get(row.group.doc)
  if (id === undefined) documentIds.set(row.group.doc, (id = ++nextDocumentId))
  return JSON.stringify([row.group.note.id, id, row.match?.from ?? 'heading', row.match?.offset])
}

function preceding(starts: number[], position: number) {
  let low = 0,
    high = starts.length - 1
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (starts[mid] <= position) low = mid
    else high = mid - 1
  }
  return low
}

// Index groups, not every occurrence. Even a very common query does not need a
// second flattened array with hundreds of thousands of row objects.
export class ContentResultIndex {
  readonly matches: number
  readonly rows: number
  private matchStarts: number[] = []
  private rowStarts: number[] = []
  private byId = new Map<string, number>()
  constructor(readonly groups: ContentGroup[]) {
    let matches = 0,
      rows = 0
    groups.forEach((group, i) => {
      this.byId.set(group.note.id, i)
      this.matchStarts.push(matches)
      this.rowStarts.push(rows)
      matches += group.matches.length
      rows += group.matches.length + 1
    })
    this.matches = matches
    this.rows = rows
  }
  match(position: number): ResultRow | undefined {
    if (position < 0 || position >= this.matches) return
    const groupIndex = preceding(this.matchStarts, position),
      group = this.groups[groupIndex]
    const local = position - this.matchStarts[groupIndex]
    return {
      group,
      match: group.matches[local],
      matchIndex: position,
      rowIndex: this.rowStarts[groupIndex] + local + 1,
      groupIndex,
    }
  }
  row(position: number): ResultRow | undefined {
    if (position < 0 || position >= this.rows) return
    const groupIndex = preceding(this.rowStarts, position),
      group = this.groups[groupIndex]
    const local = position - this.rowStarts[groupIndex] - 1
    return {
      group,
      match: local < 0 ? undefined : group.matches[local],
      matchIndex: this.matchStarts[groupIndex] + local,
      rowIndex: position,
      groupIndex,
    }
  }
  locate(anchor: MatchAnchor): number | undefined {
    const groupIndex = this.byId.get(anchor.noteId)
    if (groupIndex === undefined) return
    const group = this.groups[groupIndex]
    if (group.doc !== anchor.doc) return
    let low = 0,
      high = group.matches.length
    while (low < high) {
      const mid = (low + high) >>> 1,
        match = group.matches[mid]
      if (match.from < anchor.from || (match.from === anchor.from && match.offset < anchor.offset))
        low = mid + 1
      else high = mid
    }
    const match = group.matches[low]
    if (
      match?.from === anchor.from &&
      match.offset === anchor.offset &&
      match.segment.text === anchor.text
    )
      return this.matchStarts[groupIndex] + low
  }
  heading(noteId: string): number | undefined {
    const groupIndex = this.byId.get(noteId)
    return groupIndex === undefined ? undefined : this.rowStarts[groupIndex]
  }
}

// Sparse height corrections keep layout work proportional to measured rows,
// rather than allocating/rebuilding a height array for every search occurrence.
export class SearchRowLayout {
  private corrections = new Map<number, number>()
  constructor(
    readonly count: number,
    readonly estimate = 44,
  ) {}
  measure(row: number, height: number) {
    const delta = height - this.estimate
    for (let i = row + 1; i <= this.count; i += i & -i)
      this.corrections.set(i, (this.corrections.get(i) ?? 0) + delta)
  }
  offset(row: number) {
    let total = row * this.estimate
    for (let i = row; i > 0; i -= i & -i) total += this.corrections.get(i) ?? 0
    return total
  }
  at(offset: number) {
    let low = 0,
      high = this.count
    while (low < high) {
      const mid = (low + high + 1) >>> 1
      if (this.offset(mid) <= offset) low = mid
      else high = mid - 1
    }
    return Math.min(low, Math.max(0, this.count - 1))
  }
}
