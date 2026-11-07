// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { generateJSON, type JSONContent } from '@tiptap/core'
import { writingExtensions } from '../editor/extensions'
import { richWritingFixture } from '../editor/fixtures'
import { drawingFixture, previewFixture } from '../drawing/fixtures'
import { fileName, noteHtml, noteMarkdown, uniqueNames } from './exportDocument'

const p = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content })
const t = (text: string, marks?: JSONContent['marks']): JSONContent => ({ type: 'text', text, ...(marks ? { marks } : {}) })

it('exports the richest sample note as Markdown without failing', () => {
  const doc = generateJSON(richWritingFixture, writingExtensions)
  const markdown = noteMarkdown('A garden journal', doc, (src) => (src.startsWith('data:') ? 'images/1.png' : src))
  expect(markdown.startsWith('# A garden journal\n\n')).toBe(true)
  // The collapsible's header becomes a bold line, its body follows, and checkboxes become text.
  expect(markdown).toMatch(/\*\*☐ +Garden journal/)
  expect(markdown).toContain('Water Check soil Record growth')
  expect(markdown).toContain('A small experiment can hold many ideas.')
  expect(markdown).toMatch(/\| Plant\s+\| Next step\s+\|/)
  expect(markdown).toContain('☑')
  // Colors are dropped rather than refused.
  expect(markdown).not.toContain('background-color')
})

it('keeps Markdown formatting and turns rich nodes into their nearest form', () => {
  const doc: JSONContent = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1, textAlign: 'center', numbered: true }, content: [t('Trip')] },
      p(t('bold', [{ type: 'bold' }]), t(' and '), t('under', [{ type: 'underline' }, { type: 'highlight' }])),
      { type: 'drawing', attrs: { id: 'd', data: { ...drawingFixture(), preview: previewFixture, previewRevision: drawingFixture().revision } } },
      { type: 'drawing', attrs: { id: 'e', data: null } },
      {
        type: 'table',
        content: [
          { type: 'tableRow', content: [{ type: 'tableHeader', attrs: { colspan: 2 }, content: [p(t('Wide'))] }] },
          {
            type: 'tableRow',
            content: [
              { type: 'tableCell', content: [p(t('one')), p(t('two'))] },
              { type: 'tableCell', content: [p(t('three'))] },
            ],
          },
        ],
      },
      p({ type: 'noteReference', attrs: { noteId: 'n1', fallbackTitle: 'Other note' } }),
    ],
  }
  const markdown = noteMarkdown('Trip', doc)
  // The body's own title heading is kept instead of adding a second one.
  expect(markdown.startsWith('# Trip\n')).toBe(true)
  expect(markdown.match(/# Trip/g)).toHaveLength(1)
  expect(markdown).toContain('**bold** and under')
  expect(markdown).toMatch(/!\[Drawing\]\(data:image\//)
  expect(markdown).toMatch(/\| Wide\s+\|\s+\|/)
  expect(markdown).toMatch(/\| one two \| three \|/)
  expect(markdown).toContain('[Other note](upnote2://note/n1)')
  expect(noteMarkdown('', { type: 'doc', content: [] })).toBe('\n')
  // An export can point images at files it writes.
  expect(noteMarkdown('Trip', doc, () => 'Trip images/1.png')).toContain('![Drawing](Trip images/1.png)')
})

it('exports HTML as one standalone page and strips scripts', () => {
  const doc: JSONContent = {
    type: 'doc',
    content: [
      p(t('Hi '), t('link', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }])),
      p({ type: 'image', attrs: { src: 'data:image/png;base64,AAAA', alt: 'pic' } }),
    ],
  }
  const html = noteHtml('A <b>title</b>', doc)
  expect(html).toContain('<title>A &lt;b&gt;title&lt;/b&gt;</title>')
  expect(html).toContain('<h1>A &lt;b&gt;title&lt;/b&gt;</h1>')
  expect(html).toContain('src="data:image/png;base64,AAAA"')
  expect(html).not.toContain('javascript:')
  expect(noteHtml('Rich', generateJSON(richWritingFixture, writingExtensions))).toContain('Garden journal')
})

it('makes safe, unique file names', () => {
  expect(fileName('a/b: c?')).toBe('a-b- c-')
  expect(fileName('  ...hidden ')).toBe('hidden')
  expect(fileName('   ')).toBe('Untitled')
  expect([...fileName('x'.repeat(300))]).toHaveLength(120)
  const unique = uniqueNames()
  expect([unique('Note', '.md'), unique('note', '.md'), unique('Note', '.md'), unique('Note')]).toEqual([
    'Note.md',
    'note 2.md',
    'Note 3.md',
    'Note',
  ])
})
