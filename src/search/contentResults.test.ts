// @vitest-environment jsdom
import { expect, it } from 'vitest'
import type { Note } from '../model'
const note = (id: string, title: string, text: string, updated = 1): Note => ({
  id,
  title,
  text,
  updated,
  tags: [],
  notebookIds: [],
  pinned: false,
  quickAccess: false,
  trashed: false,
  content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
})
import { searchContent, searchDocument } from '../search'
import { ContentResultIndex, SearchRowLayout, matchAnchor } from './contentResults'

it('indexes groups without flattening matches and keeps the selected occurrence through inserts', () => {
  const a = note('a', 'A', 'fix first fix second', 1),
    b = note('b', 'B', 'fix newer', 3)
  const group = searchContent([{ note: a, doc: searchDocument(a) }], 'fix', [a])[0]
  const anchor = matchAnchor(group, group.matches[1])
  const newer = searchContent([{ note: b, doc: searchDocument(b) }], 'fix', [a, b])[0]
  const index = new ContentResultIndex([newer, group])
  expect(index.matches).toBe(3)
  expect(index.rows).toBe(5)
  expect(index.locate(anchor)).toBe(2)
  expect(index.match(2)?.match?.offset).toBe(10)
  expect(index.row(3)?.match?.offset).toBe(0)
  expect(index.row(2)?.match).toBeUndefined()
  expect(index.match(-1)).toBeUndefined()
  expect(index.row(5)).toBeUndefined()
  const changed = note('a', 'A', 'fix changed', 4)
  expect(
    new ContentResultIndex(
      searchContent([{ note: changed, doc: searchDocument(changed) }], 'fix', [changed]),
    ).locate(anchor),
  ).toBeUndefined()
})

it('maps variable row heights to scroll positions without a full row array', () => {
  const layout = new SearchRowLayout(700000, 44)
  layout.measure(0, 80)
  layout.measure(20, 100)
  expect(layout.offset(1)).toBe(80)
  expect(layout.at(79)).toBe(0)
  expect(layout.at(80)).toBe(1)
  expect(layout.offset(21)).toBe(21 * 44 + 92)
  expect(layout.at(layout.offset(400000) + 20)).toBe(400000)
  expect(layout.at(layout.offset(700000))).toBe(699999)
})
