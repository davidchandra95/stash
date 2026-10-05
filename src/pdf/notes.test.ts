// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { writingExtensions } from '../editor/extensions'
import { parseMarkdown, serializeMarkdown } from '../editor/markdown'
import { normalizeContent, safeHTML } from '../editor/clipboard'
import { validLinkAddress } from '../editor/links'
import { LibraryStore, type Transport, type SavedNote } from '../storage/library'
import { appendCapture } from './capture'
import { citationContent, pdfCitationHref, parsePdfCitation, resolvePdfCitation } from './citations'
import { initialReading, type PdfDocument } from './model'
import { normalizePdfNotes } from '../workspace'

const pdf: PdfDocument = {
  id: 'doc-1',
  name: 'Research.pdf',
  fingerprint: 'a'.repeat(64),
  size: 50,
  imported: 1,
  unavailable: false,
  reading: initialReading(),
}
const citation = {
  documentId: pdf.id,
  fingerprint: pdf.fingerprint,
  page: 2,
  regions: [{ page: 2, rects: [[10, 20, 80, 60] as [number, number, number, number]] }],
}
const editors: Editor[] = []
afterEach(() => editors.splice(0).forEach((e) => e.destroy()))
const editor = () => {
  const e = new Editor({ extensions: writingExtensions, content: '<p>Existing draft</p>' })
  editors.push(e)
  return e
}
describe('PDF citations', () => {
  it('places the short citation inline in the final quote paragraph', () => {
    const e = editor()
    e.commands.setContent({
      type: 'doc',
      content: citationContent(citation, 'First\nline\n\nLast paragraph'),
    })
    const quote = e.view.dom.querySelector('blockquote')!
    expect(quote.querySelectorAll('p')).toHaveLength(2)
    expect(quote.querySelector('br')).not.toBeNull()
    expect(quote.lastElementChild?.textContent).toBe('Last paragraph (p. 2)')
    expect(quote.querySelector('a')?.getAttribute('href')).toBe(pdfCitationHref(citation))
    expect(e.state.doc.lastChild?.type.name).toBe('paragraph')
    expect(e.state.doc.lastChild?.content.size).toBe(0)
  })
  it('uses short labels for single-page and multipage captures and standalone references', () => {
    const multi = {
      ...citation,
      regions: [...citation.regions, { page: 3, rects: citation.regions[0].rects }],
    }
    for (const [source, label] of [
      [citation, '(p. 2)'],
      [multi, '(pp. 2–3)'],
    ] as const) {
      for (const text of ['Excerpt', undefined]) {
        const e = editor()
        e.commands.setContent({ type: 'doc', content: citationContent(source, text) })
        expect(e.view.dom.querySelector('a')?.textContent).toBe(label)
        expect(e.view.dom.querySelector('blockquote') !== null).toBe(text !== undefined)
        expect(e.getText()).not.toContain(pdf.name)
      }
    }
  })

  it('round trips links through HTML clipboard and Markdown while keeping unsafe URLs blocked', () => {
    const href = pdfCitationHref(citation)
    expect(parsePdfCitation(href)).toEqual(citation)
    expect(validLinkAddress(href)).toBe(true)
    const content = {
      type: 'doc',
      content: citationContent(citation, 'literal hy-\nphen\n\nSecond paragraph'),
    }
    const e = editor()
    e.commands.setContent(content)
    const html = safeHTML(e.getHTML())
    expect(html).toContain('upnote2://pdf/v1/')
    expect(JSON.stringify(normalizeContent(html, writingExtensions))).toContain(href)
    const markdown = serializeMarkdown(content)
    expect(JSON.stringify(parseMarkdown(markdown))).toContain(href)
    for (const restored of [normalizeContent(html, writingExtensions), parseMarkdown(markdown)]) {
      const roundTrip = editor()
      roundTrip.commands.setContent(restored)
      expect(roundTrip.view.dom.querySelector('blockquote p:last-child')?.textContent).toBe(
        'Second paragraph (p. 2)',
      )
      expect(roundTrip.view.dom.querySelector('blockquote a')?.getAttribute('href')).toBe(href)
    }
    expect(
      safeHTML('<a href="javascript:alert(1)">bad</a><a href="upnote2://pdf/v2/bad">bad</a>'),
    ).not.toContain('href')
    expect(validLinkAddress('javascript:alert(1)')).toBe(false)
  })
  it('rejects unsupported versions, duplicate parameters, oversized and malformed geometry', () => {
    const href = pdfCitationHref(citation)
    for (const invalid of [
      href.replace('/v1/', '/v2/'),
      href + '&page=3',
      href.replace('page=2', 'page=0'),
      href.replace('page=2', 'page=2.5'),
      href + '#other',
      href.replace('doc-1', '../note'),
    ])
      expect(parsePdfCitation(invalid)).toBeNull()
    for (const regions of [
      null,
      [],
      [{ page: 2, rects: [[1, 1, 0, 0]] }],
      [{ page: 2, rects: [[0, 0, 1e10, 10]] }],
      [{ page: 3, rects: [[0, 0, 10, 10]] }],
    ]) {
      const u = new URL(href)
      u.searchParams.set('regions', JSON.stringify(regions))
      expect(parsePdfCitation(u.href)).toBeNull()
    }
  })
  it('resolves by ID then exact fingerprint, never filename, and flags a changed revision', () => {
    expect(resolvePdfCitation(citation, [pdf]).changed).toBe(false)
    expect(resolvePdfCitation(citation, [{ ...pdf, id: 'another' }]).document.id).toBe('another')
    expect(resolvePdfCitation(citation, [{ ...pdf, fingerprint: 'b'.repeat(64) }]).changed).toBe(
      true,
    )
    expect(() =>
      resolvePdfCitation(citation, [{ ...pdf, id: 'other', fingerprint: 'b'.repeat(64) }]),
    ).toThrow('unavailable')
    expect(() => resolvePdfCitation(citation, [{ ...pdf, unavailable: true }])).toThrow(
      'unavailable',
    )
  })
})
describe('capture transactions', () => {
  it('preserves the cursor, appends literal paragraphs, and is one normal undo step', () => {
    const e = editor()
    e.commands.setTextSelection(5)
    const before = e.getJSON()
    const receipt = appendCapture(e, citationContent(citation, 'hy-\nphen\n\nNext paragraph'))
    expect(e.state.selection.from).toBe(5)
    expect(e.getText()).toContain('Existing draft')
    expect(e.getText()).toContain('hy-\nphen')
    e.commands.undo()
    expect(e.getJSON()).toEqual(before)
    expect(() => receipt.undo()).toThrow('edited or removed')
    receipt.dispose()
  })
  it('feedback undo removes only its capture, preserving later writing and undo history', () => {
    const e = editor()
    const receipt = appendCapture(e, citationContent(citation, 'Captured excerpt'))
    e.commands.insertContentAt(1, 'Later writing. ')
    receipt.undo()
    expect(e.getText()).toBe('Later writing. Existing draft')
    e.commands.undo()
    expect(e.getText()).toContain('Captured excerpt')
    expect(e.getText()).toContain('Later writing.')
  })
  it('keeps thoughts typed in the paragraph after a capture when feedback Undo is used', () => {
    const e = editor()
    const receipt = appendCapture(e, citationContent(citation, 'Captured excerpt'))
    e.commands.insertContentAt(e.state.doc.content.size - 1, 'My later thoughts.')
    receipt.undo()
    expect(e.getText()).toContain('My later thoughts.')
    expect(e.getText()).toContain('Existing draft')
    expect(e.getText()).not.toContain('Captured excerpt')
  })
  it('refuses feedback undo once the captured text has been edited', () => {
    const e = editor()
    const from = e.state.doc.content.size
    const receipt = appendCapture(e, citationContent(citation, 'Captured excerpt'))
    e.commands.insertContentAt(from + 3, 'Changed')
    expect(() => receipt.undo()).toThrow('edited or removed')
    expect(e.getText()).toContain('Changed')
    receipt.dispose()
  })
})
it('preview companion ownership is idempotent, survives rename and Trash, and is not copied', async () => {
  const store = new LibraryStore(null)
  const [a, b] = await Promise.all([store.ensurePdfCompanion(pdf), store.ensurePdfCompanion(pdf)])
  expect(a).toBe(b)
  expect(store.getSnapshot().notes.find((n) => n.id === a)?.title).toBe('Research - Notes')
  store.setNotes((notes) =>
    notes.map((n) => (n.id === a ? { ...n, title: 'Renamed', trashed: true } : n)),
  )
  expect(await store.ensurePdfCompanion(pdf)).toBe(a)
  store.setNotes((notes) => notes.map((n) => (n.id === a ? { ...n, trashed: false } : n)))
  const copy = await store.duplicate(a)
  expect(Object.values(await store.listPdfCompanions())).not.toContain(copy)
  store.setNotes((notes) => notes.filter((n) => n.id !== a))
  expect(await store.ensurePdfCompanion(pdf)).not.toBe(a)
})
it('native creation flushes pending edits, preserves newer edits, and retries a failed creation', async () => {
  let release!: (note: SavedNote) => void
  const command = vi
    .fn()
    .mockRejectedValueOnce(Error('disk full'))
    .mockImplementation(
      () =>
        new Promise<SavedNote>((resolve) => {
          release = resolve
        }),
    )
  const transport: Transport = {
    open: async () => ({
      notes: [],
      notebooks: [],
      appearance: null,
      preferencesRevision: 0,
      path: 'test',
    }),
    load: vi.fn(),
    saveNote: vi.fn(async () => ({ revision: 1, updated: 1 })),
    savePreferences: vi.fn(async () => ({ revision: 1, updated: 1 })),
    quit: vi.fn(),
    command,
  }
  const store = new LibraryStore(transport)
  await store.open()
  await expect(store.ensurePdfCompanion(pdf)).rejects.toThrow('disk full')
  const creating = store.ensurePdfCompanion(pdf)
  await vi.waitFor(() => expect(command).toHaveBeenCalledTimes(2))
  const note: SavedNote = {
    id: 'companion',
    title: 'Newer draft',
    notebookIds: [],
    tags: [],
    quickAccess: false,
    pinned: false,
    trashed: false,
    updated: 2,
    text: 'newer',
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
    revision: 1,
    documentVersion: 1,
  }
  store.setNotes((notes) => [...notes, { ...note, content: note.content! }])
  release({ ...note, title: 'Old receipt' })
  await creating
  expect(store.getSnapshot().notes.find((n) => n.id === note.id)?.title).toBe('Newer draft')
  await store.flush()
})
it('loads older preferences and clamps invalid split and scroll values', () => {
  expect(normalizePdfNotes(undefined)).toEqual({})
  expect(normalizePdfNotes({ a: { ratio: 5, scroll: -1, open: true, pane: 'invalid' } })).toEqual({
    a: { ratio: 0.9, scroll: 0, open: true, pane: 'pdf' },
  })
})
