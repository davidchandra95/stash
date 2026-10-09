import {
  ContentMatcher,
  type IndexedDocument,
  type MatchedDocument,
  type MatchBatch,
  type SearchUpdate,
} from './contentMatcher'

export type SearchSnapshot = {
  query: string
  matches: ReadonlyMap<string, MatchedDocument>
  searching: boolean
  error: string
}
export type SearchWorker = Pick<
  Worker,
  'postMessage' | 'terminate' | 'onmessage' | 'onerror' | 'onmessageerror'
>

export class ContentSearchClient {
  private documents = new Map<string, IndexedDocument>()
  private matches = new Map<string, MatchedDocument>()
  private query = ''
  private queryId = 0
  private workId = 0
  private searching = false
  private error = ''
  private disposed = false
  private worker: SearchWorker | undefined
  private fallback: ContentMatcher | undefined

  constructor(
    private publish: (snapshot: SearchSnapshot) => void,
    createWorker: () => SearchWorker = () =>
      new Worker(new URL('./contentSearch.worker.ts', import.meta.url), { type: 'module' }),
  ) {
    try {
      this.worker = createWorker()
      this.worker.onmessage = (event: MessageEvent<MatchBatch>) => this.receive(event.data)
      this.worker.onerror = (event) => {
        event.preventDefault()
        this.useFallback()
      }
      this.worker.onmessageerror = () => this.useFallback()
    } catch {
      this.fallback = new ContentMatcher(this.receive)
    }
  }

  update(query: string, upserts: IndexedDocument[], removed: string[]) {
    if (this.disposed) return
    for (const id of removed) {
      this.documents.delete(id)
      this.matches.delete(id)
    }
    for (const entry of upserts) {
      this.documents.set(entry.id, entry)
      this.matches.delete(entry.id)
    }
    if (query !== this.query) {
      this.query = query
      this.queryId++
      this.matches.clear()
    }
    this.workId++
    this.publishSnapshot(!!query, '')
    this.send({ query, queryId: this.queryId, workId: this.workId, upserts, removed })
  }

  dispose() {
    this.disposed = true
    this.worker?.terminate()
    this.fallback?.dispose()
    this.documents.clear()
    this.matches.clear()
  }

  private send(request: SearchUpdate) {
    if (this.worker) {
      try {
        this.worker.postMessage(request)
      } catch {
        this.useFallback()
      }
    } else this.fallback!.update(request)
  }

  private useFallback() {
    if (this.disposed || this.fallback) return
    this.worker?.terminate()
    this.worker = undefined
    this.matches.clear()
    this.fallback = new ContentMatcher(this.receive)
    this.workId++
    this.publishSnapshot(!!this.query, '')
    this.fallback.update({
      query: this.query,
      queryId: this.queryId,
      workId: this.workId,
      upserts: [...this.documents.values()],
      removed: [],
    })
  }

  private receive = (batch: MatchBatch) => {
    if (this.disposed || batch.queryId !== this.queryId) return
    for (const entry of batch.entries) {
      if (this.documents.get(entry.id)?.version === entry.version) this.matches.set(entry.id, entry)
    }
    // Valid batches from an earlier update can still finish unchanged documents.
    // Only the newest update may declare the whole matching pass complete.
    const current = batch.workId === this.workId
    this.publishSnapshot(
      current ? !batch.complete : this.searching,
      current ? (batch.error ?? '') : this.error,
    )
  }

  private publishSnapshot(searching: boolean, error: string) {
    this.searching = searching && !error
    this.error = error
    this.publish({
      query: this.query,
      matches: new Map(this.matches),
      searching: this.searching,
      error,
    })
  }
}
