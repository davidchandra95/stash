import { ContentMatcher, type MatchBatch, type SearchUpdate } from './contentMatcher'

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<SearchUpdate>) => void) | null
  postMessage: (batch: MatchBatch) => void
}
const matcher = new ContentMatcher((batch) => scope.postMessage(batch))
scope.onmessage = (event) => matcher.update(event.data)
