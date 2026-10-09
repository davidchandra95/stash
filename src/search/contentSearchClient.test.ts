import { afterEach, expect, it, vi } from 'vitest'
import { ContentSearchClient, type SearchSnapshot, type SearchWorker } from './contentSearchClient'
import { segmentMatches } from '../editor/searchText'
import type { MatchBatch, SearchUpdate } from './contentMatcher'

afterEach(() => vi.useRealTimers())
function setup() {
  const states: SearchSnapshot[] = [],
    requests: SearchUpdate[] = []
  const worker: SearchWorker = {
    postMessage: vi.fn((request: SearchUpdate) => requests.push(request)),
    terminate: vi.fn(),
    onmessage: null,
    onerror: null,
    onmessageerror: null,
  }
  const client = new ContentSearchClient(
    (state) => states.push(state),
    () => worker,
  )
  const deliver = (batch: MatchBatch) => {
    if (worker.onmessage)
      Reflect.apply(worker.onmessage, worker, [new MessageEvent('message', { data: batch })])
  }
  return { client, states, requests, worker, deliver }
}
const doc = (version = 1) => ({
  id: 'a',
  version,
  segments: [{ text: 'first second', from: 1, to: 13 }],
})

it('rejects old query and document versions and accepts valid earlier batches', () => {
  const { client, states, requests, deliver } = setup()
  client.update('first', [doc()], [])
  const old = requests.at(-1)!
  client.update('second', [], [])
  const current = requests.at(-1)!
  deliver({
    ...old,
    entries: [{ id: 'a', version: 1, matches: segmentMatches(doc().segments, 'first') }],
    complete: true,
  })
  expect(states.at(-1)?.matches.size).toBe(0)
  client.update('second', [doc(2)], [])
  const latest = requests.at(-1)!
  deliver({
    ...current,
    entries: [{ id: 'a', version: 1, matches: segmentMatches(doc().segments, 'second') }],
    complete: true,
  })
  expect(states.at(-1)?.matches.size).toBe(0)
  deliver({
    ...latest,
    entries: [{ id: 'a', version: 2, matches: segmentMatches(doc().segments, 'second') }],
    complete: true,
  })
  expect(states.at(-1)?.searching).toBe(false)
  expect(states.at(-1)?.matches.get('a')?.version).toBe(2)
  deliver({ ...current, entries: [], complete: true })
  expect(states.at(-1)?.searching).toBe(false)
  client.update('second', [], ['a'])
  deliver({ ...latest, entries: [{ id: 'a', version: 2, matches: [] }], complete: true })
  expect(states.at(-1)?.matches.size).toBe(0)
  client.dispose()
})

it('falls back to the same scheduled matcher after worker failure and ignores completion after close', async () => {
  vi.useFakeTimers()
  const { client, states, worker } = setup()
  client.update('second', [doc()], [])
  if (worker.onerror)
    Reflect.apply(worker.onerror, worker, [new Event('error', { cancelable: true })])
  await vi.runAllTimersAsync()
  expect(worker.terminate).toHaveBeenCalledOnce()
  expect(states.at(-1)?.matches.get('a')?.matches).toEqual(segmentMatches(doc().segments, 'second'))
  expect(states.at(-1)?.searching).toBe(false)
  client.update('first', [], [])
  const count = states.length
  client.dispose()
  await vi.runAllTimersAsync()
  expect(states).toHaveLength(count)
})
