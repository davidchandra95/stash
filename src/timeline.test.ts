import { expect, it } from 'vitest'
import { emptyTimeline, recordPlace, stepIndex, type Place } from './timeline'

const note = (noteId: string, tabId = 't1', query = ''): Place => ({
  kind: 'tab',
  tabId,
  location: { noteId, view: 'all', query, scroll: 0 },
})
const page = (view: string, taskId: string | null = null): Place => ({
  kind: 'project',
  view,
  taskId,
})
const record = (...places: Place[]) => places.reduce(recordPlace, emptyTimeline)

it('crosses areas in one order and drops what is ahead when branching', () => {
  const timeline = record(note('a'), page('inbox'), page('inbox', 'x'), note('b'))
  expect(timeline.index).toBe(3)
  expect(stepIndex(timeline, -1, () => true)).toBe(2)
  const branched = recordPlace({ ...timeline, index: 1 }, note('c'))
  expect(branched.entries).toEqual([note('a'), page('inbox'), note('c')])
})
it('refreshes the current stop instead of adding a duplicate', () => {
  const timeline = record(note('a'), note('a', 't1', 'filter'))
  expect(timeline.entries).toEqual([note('a', 't1', 'filter')])
})
it('treats the same note in another tab as a separate stop', () => {
  expect(record(note('a'), note('a', 't2')).entries).toHaveLength(2)
})
it('folds a closed task panel into its page', () => {
  expect(record(page('inbox'), page('inbox', 'x'), page('inbox')).entries).toEqual([page('inbox')])
  expect(record(note('a'), page('inbox', 'x'), page('inbox')).entries).toEqual([
    note('a'),
    page('inbox'),
  ])
})
it('skips stops that can no longer be visited', () => {
  const timeline = record(note('a'), { kind: 'empty' }, note('b'))
  const canVisit = (place: Place) => place.kind !== 'empty'
  expect(stepIndex(timeline, -1, canVisit)).toBe(0)
  expect(stepIndex(timeline, 1, canVisit)).toBeUndefined()
  expect(stepIndex(record(note('a')), -1, canVisit)).toBeUndefined()
})
it('caps its length', () => {
  let timeline = emptyTimeline
  for (let i = 0; i < 250; i++) timeline = recordPlace(timeline, note(String(i)))
  expect(timeline.entries).toHaveLength(200)
  expect(timeline.index).toBe(199)
})
