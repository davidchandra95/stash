import { afterEach, expect, it, vi } from 'vitest'
import { segmentMatches } from '../editor/searchText'
import { ContentMatcher, type IndexedDocument, type MatchBatch } from './contentMatcher'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})
const entry = (id: string, text: string, version = 1): IndexedDocument => ({
  id,
  version,
  segments: [{ text, from: 1, to: text.length + 1 }],
})

it('keeps literal Unicode matching and positions identical to the editor matcher', async () => {
  vi.useFakeTimers()
  const batches: MatchBatch[] = [],
    matcher = new ContentMatcher((batch) => batches.push(batch))
  const documents = [entry('a', '📘 fİx .*( literal K k'), entry('b', 'FIX fix')]
  for (const [i, query] of ['.*(', 'k', 'fix', '📘', 'İ', 'not here'].entries()) {
    matcher.update({
      queryId: i + 1,
      workId: i + 1,
      query,
      upserts: i ? [] : documents,
      removed: [],
    })
    await vi.runAllTimersAsync()
    const result = batches
      .filter((batch) => batch.queryId === i + 1)
      .flatMap((batch) => batch.entries)
    expect(result.map((value) => value.matches)).toEqual(
      documents.map((doc) => segmentMatches(doc.segments, query)),
    )
    expect(batches.at(-1)?.complete).toBe(true)
  }
  matcher.dispose()
})

it('publishes a partial batch, cancels obsolete queries, and matches only changed documents', async () => {
  vi.useFakeTimers()
  let now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => (now += 3))
  const batches: MatchBatch[] = [],
    matcher = new ContentMatcher((batch) => batches.push(batch))
  const documents = Array.from({ length: 8 }, (_, i) => entry(String(i), 'first second'))
  matcher.update({ queryId: 1, workId: 1, query: 'first', upserts: documents, removed: [] })
  vi.advanceTimersToNextTimer()
  expect(batches[0].complete).toBe(false)
  expect(batches[0].entries.length).toBeLessThan(documents.length)
  const before = batches.length
  matcher.update({ queryId: 2, workId: 2, query: 'second', upserts: [], removed: ['7'] })
  await vi.runAllTimersAsync()
  const fresh = batches.slice(before)
  expect(fresh.every((batch) => batch.queryId === 2)).toBe(true)
  expect(fresh.flatMap((batch) => batch.entries.map((value) => value.id))).toEqual([
    '0',
    '1',
    '2',
    '3',
    '4',
    '5',
    '6',
  ])
  const updateStart = batches.length
  matcher.update({
    queryId: 2,
    workId: 3,
    query: 'second',
    upserts: [entry('0', 'second changed', 2)],
    removed: [],
  })
  await vi.runAllTimersAsync()
  expect(
    batches
      .slice(updateStart)
      .flatMap((batch) => batch.entries.map((value) => [value.id, value.version])),
  ).toEqual([['0', 2]])
  matcher.dispose()
})

it('replaces queued documents and stops all publication after disposal', async () => {
  vi.useFakeTimers()
  const publish = vi.fn(),
    matcher = new ContentMatcher(publish)
  matcher.update({ queryId: 1, workId: 1, query: 'new', upserts: [entry('a', 'old')], removed: [] })
  matcher.update({
    queryId: 1,
    workId: 2,
    query: 'new',
    upserts: [entry('a', 'new', 2)],
    removed: [],
  })
  await vi.runAllTimersAsync()
  expect(publish.mock.calls[0][0].entries[0]).toMatchObject({
    id: 'a',
    version: 2,
    matches: [{ from: 1, to: 4 }],
  })
  matcher.update({ queryId: 2, workId: 3, query: 'old', upserts: [], removed: [] })
  matcher.dispose()
  await vi.runAllTimersAsync()
  expect(publish).toHaveBeenCalledOnce()
})

it('retries the whole current query after a failed matching pass', async () => {
  vi.useFakeTimers()
  const batches: MatchBatch[] = []
  const document = entry('a', 'first')
  let fail = true
  Object.defineProperty(document.segments[0], 'text', {
    get: () => {
      if (fail) throw Error('Synthetic matching failure')
      return 'first'
    },
  })
  const matcher = new ContentMatcher((batch) => batches.push(batch))
  matcher.update({ queryId: 1, workId: 1, query: 'first', upserts: [document], removed: [] })
  await vi.runAllTimersAsync()
  expect(batches.at(-1)?.error).toContain('Synthetic matching failure')
  fail = false
  matcher.update({ queryId: 1, workId: 2, query: 'first', upserts: [], removed: [] })
  await vi.runAllTimersAsync()
  expect(batches.at(-1)).toMatchObject({
    complete: true,
    entries: [{ id: 'a', matches: [{ from: 1, to: 6 }] }],
  })
  matcher.dispose()
})
