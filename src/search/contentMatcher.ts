import { segmentMatches, type DocumentMatch, type TextSegment } from '../editor/searchText'

export type IndexedDocument = { id: string; version: number; segments: TextSegment[] }
export type SearchUpdate = {
  queryId: number
  workId: number
  query: string
  upserts: IndexedDocument[]
  removed: string[]
}
export type MatchedDocument = { id: string; version: number; matches: DocumentMatch[] }
export type MatchBatch = {
  queryId: number
  workId: number
  entries: MatchedDocument[]
  complete: boolean
  error?: string
}

// The same scheduled matcher runs in a Worker and, when Workers are unavailable,
// in short main-thread slices. Its only input is immutable, positional text.
export class ContentMatcher {
  private documents = new Map<string, IndexedDocument>()
  private pending = new Map<string, IndexedDocument>()
  private query = ''
  private queryId = 0
  private workId = 0
  private failed = false
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(private publish: (batch: MatchBatch) => void) {}

  update(request: SearchUpdate) {
    this.workId = request.workId
    for (const id of request.removed) {
      this.documents.delete(id)
      this.pending.delete(id)
    }
    for (const entry of request.upserts) {
      this.documents.set(entry.id, entry)
      this.pending.set(entry.id, entry)
    }
    if (request.queryId !== this.queryId || this.failed) {
      this.query = request.query
      this.queryId = request.queryId
      this.pending = new Map(this.documents)
      this.failed = false
    }
    if (!this.query) this.pending.clear()
    if (this.timer === undefined) this.timer = setTimeout(this.run, 0)
  }

  dispose() {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    this.documents.clear()
    this.pending.clear()
  }

  private run = () => {
    this.timer = undefined
    const entries: MatchedDocument[] = []
    const started = performance.now()
    try {
      while (this.pending.size) {
        const [id, document] = this.pending.entries().next().value!
        this.pending.delete(id)
        entries.push({
          id,
          version: document.version,
          matches: segmentMatches(document.segments, this.query),
        })
        if (performance.now() - started >= 6) break
      }
      this.publish({
        queryId: this.queryId,
        workId: this.workId,
        entries,
        complete: !this.pending.size,
      })
      if (this.pending.size) this.timer = setTimeout(this.run, 0)
    } catch (error) {
      this.pending.clear()
      this.failed = true
      this.publish({
        queryId: this.queryId,
        workId: this.workId,
        entries,
        complete: false,
        error: String(error),
      })
    }
  }
}
