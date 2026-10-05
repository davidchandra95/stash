// @vitest-environment jsdom
import { expect, it } from 'vitest'
import type { Note } from './model'
import {
  quickOpenNotes,
  quickOpenResults,
  quickTitleParts,
  searchContent,
  searchDocument,
  matchSnippet,
  resolveMatch,
} from './search'
import { normalizeRecentNotes } from './workspace'
import { documentMatches } from './editor/searchText'
import { parseMarkdown } from './editor/markdown'

export const note = (id: string, title: string, text: string, updated = 1): Note => ({
  id,
  title,
  text,
  updated,
  notebookIds: [],
  quickAccess: false,
  tags: [],
  pinned: false,
  trashed: false,
  content: {
    type: 'doc',
    content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }],
  },
})
it('ranks titles by exact/prefix/contained/fuzzy matches and uses recent opens for equal matches', () => {
  const notes = [
    note('fuzzy', 'Meeting', 'no body match'),
    note('contains', 'A mtg note', ''),
    note('prefix', 'mtg agenda', ''),
    note('exact', 'MTG', ''),
    note('body', 'Elsewhere', 'mtg'),
    { ...note('trash', 'mtg', ''), trashed: true },
  ]
  expect(quickOpenNotes(notes, ' mtg ', []).map((note) => note.id)).toEqual([
    'exact',
    'prefix',
    'contains',
    'fuzzy',
  ])
  const equal = [note('a', 'Meeting', ''), note('b', 'Meeting', '', 20)]
  expect(quickOpenNotes(equal, 'Meeting', ['a']).map((note) => note.id)).toEqual(['a', 'b'])
  expect(
    quickOpenNotes(notes, '', ['body', 'trash', 'missing', 'exact']).map((note) => note.id),
  ).toEqual(['body', 'exact'])
})
it.each([
  ['MTG', 'mtg', ['MTG']],
  ['Meeting agenda', 'meet', ['Meet']],
  ['A Meeting note', 'meeting', ['Meeting']],
  ['Meeting', 'mtg', ['M', 't', 'g']],
  ['Banana', 'bnn', ['B', 'n', 'n']],
  ['📘 Meeting', '📘mtg', ['📘', 'M', 't', 'g']],
  ['Cafe\u0301 notes', 'e', ['e\u0301']],
  ['👩‍💻 project', '👩', ['👩‍💻']],
  ['İdea', 'd', ['d']],
  ['İdea', 'i', ['İ']],
])(
  'highlights matching characters in %s for %s without changing the title',
  (title, query, highlighted) => {
    const result = quickOpenResults([note('a', title, '')], query, [])[0]
    const parts = quickTitleParts(title, result.ranges)
    expect(parts.filter((part) => part.matched).map((part) => part.text)).toEqual(highlighted)
    expect(parts.map((part) => part.text).join('')).toBe(title)
  },
)
it('leaves recent titles unhighlighted and uses the displayed untitled fallback', () => {
  const notes = [note('a', 'Meeting', ''), note('b', '', '')]
  expect(quickOpenResults(notes, '  ', ['b', 'a'])).toEqual([
    { note: notes[1], ranges: [] },
    { note: notes[0], ranges: [] },
  ])
  const result = quickOpenResults(notes, 'unt', [])[0]
  expect(result.note.id).toBe('b')
  expect(quickTitleParts('Untitled note', result.ranges)[0]).toEqual({ text: 'Unt', matched: true })
})
it('groups body-only literal matches in document order and highlights repeated targets', () => {
  const notes = [
    note('a', 'fix in title', 'nothing'),
    note('b', 'Other', 'fix the FIX. fix again', 3),
    { ...note('c', 'Deleted', 'fix', 9), trashed: true },
  ]
  const results = searchContent(
    notes.map((note) => ({ note, doc: searchDocument(note) })),
    ' FIX ',
    notes,
  )
  expect(results.map((group) => group.note.id)).toEqual(['b'])
  expect(results[0].matches.map((match) => match.offset)).toEqual([0, 8, 13])
  const parts = matchSnippet(results[0].matches[1], 'fix')
  expect(parts.filter((part) => part.highlighted)).toHaveLength(3)
  expect(parts.filter((part) => part.target).map((part) => part.text)).toEqual(['FIX'])
  expect(
    searchContent(
      notes.map((note) => ({ note, doc: searchDocument(note) })),
      '.',
      notes,
    )[0].matches,
  ).toHaveLength(1)
  expect(searchContent([], ' ', notes)).toEqual([])
})
it('maps formatted, table, code, hard-break, and collapsed content without creating editors', () => {
  const target = note('a', 'Title', '')
  target.content = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'f' },
          { type: 'text', text: 'ix', marks: [{ type: 'bold' }] },
          { type: 'hardBreak' },
          { type: 'text', text: 'fix' },
        ],
      },
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              {
                type: 'tableCell',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'fix' }] }],
              },
            ],
          },
        ],
      },
      { type: 'codeBlock', content: [{ type: 'text', text: 'fix()' }] },
      {
        type: 'collapsible',
        attrs: { collapsed: true },
        content: [
          { type: 'collapsibleHeader', content: [{ type: 'paragraph' }] },
          {
            type: 'collapsibleBody',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'fix' }] }],
          },
        ],
      },
    ],
  }
  const doc = searchDocument(target),
    before = doc.toJSON()
  const matches = documentMatches(doc, 'fix')
  expect(matches).toHaveLength(5)
  for (const match of matches) expect(doc.textBetween(match.from, match.to)).toBe('fix')
  expect(documentMatches(doc, 'fixfix')).toEqual([])
  expect(doc.toJSON()).toEqual(before)
})
it('searches displayed Markdown text, including preserved visible source, but not hidden URLs or markup', () => {
  const markdown =
    '# Visible heading\n\n**fix** and [fix](https://hidden.example/fix)\n\n```ts\nfix()\n```\n\n<div>visible source fix</div>\n'
  const target = {
    ...note('md', 'File', markdown),
    source: { rootId: 'root', relativePath: 'file.md', fingerprint: '1', markdown },
    content: parseMarkdown(markdown),
  }
  const doc = searchDocument(target)
  expect(documentMatches(doc, 'hidden.example')).toEqual([])
  expect(documentMatches(doc, '**')).toEqual([])
  const matches = documentMatches(doc, 'fix')
  expect(matches).toHaveLength(4)
  expect(matches.at(-1)?.atom).toBe(true)
})
it('revalidates exact occurrence navigation instead of selecting another repeated match', () => {
  const original = note('a', 'fix title', 'fix one fix two')
  const doc = searchDocument(original),
    match = documentMatches(doc, 'fix')[1]
  const request = { noteId: 'a', query: 'fix', doc, match }
  expect(resolveMatch(doc, request, [original])?.offset).toBe(8)
  const changed = note('a', original.title, 'fix different')
  expect(resolveMatch(searchDocument(changed), request, [changed])).toBeUndefined()
  expect(resolveMatch(doc, request, [{ ...original, trashed: true }])).toBeUndefined()
  const shifted = {
    ...original,
    content: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'new paragraph' }] },
        ...original.content.content!,
      ],
    },
  }
  expect(resolveMatch(searchDocument(shifted), request, [shifted])?.from).toBeGreaterThan(
    match.from,
  )
})
it('normalizes and bounds recent history without using edited timestamps', () => {
  const notes = Array.from({ length: 60 }, (_, i) => note(String(i), String(i), ''))
  expect(normalizeRecentNotes(undefined)).toEqual([])
  expect(normalizeRecentNotes(['1', '1', null, 'missing', '2'], notes)).toEqual(['1', '2'])
  expect(
    normalizeRecentNotes(
      notes.map((note) => note.id),
      notes,
    ),
  ).toHaveLength(50)
  expect(
    normalizeRecentNotes(
      ['1', '2'],
      notes.map((note) => ({ ...note, trashed: note.id === '1' })),
    ),
  ).toEqual(['2'])
})
