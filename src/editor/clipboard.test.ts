// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { getEditor, clearSessions } from './session'
import type { Editor } from '@tiptap/core'
import { plainPasteEditors } from './clipboard'
import { insertLiteral } from './plainPaste'

Element.prototype.scrollIntoView = vi.fn()
Range.prototype.getClientRects = () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () => new DOMRect()
window.scrollBy = vi.fn()
afterEach(clearSessions)

const markdown = '# Title\n\n**Bold**'

function paste(text: string, html = '', markdownNote = false) {
  const editor = getEditor(
    'paste-test',
    { type: 'doc', content: [{ type: 'paragraph' }] },
    undefined,
    markdownNote,
  )
  pasteInto(editor, text, html)
  return editor
}

function pasteInto(editor: Editor, text: string, html = '') {
  const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
  Object.defineProperty(event, 'clipboardData', {
    value: {
      getData: (type: string) => (type === 'text/html' ? html : type === 'text/plain' ? text : ''),
      files: [],
    },
  })
  if (html) editor.view.pasteHTML(html, event)
  else editor.view.pasteText(text, event)
}

it.each([false, true])(
  'renders plain-text Markdown on paste (Markdown note: %s)',
  (markdownNote) => {
    const editor = paste(markdown, '', markdownNote)
    expect(editor.view.dom.querySelector('h1')?.textContent).toBe('Title')
    expect(editor.view.dom.querySelector('strong')?.textContent).toBe('Bold')
  },
)

for (const markdownNote of [false, true]) {
  it(`renders the roadmap clipboard format (Markdown note: ${markdownNote})`, () => {
    const lines = [
      '### 6-Week Roadmap: Fintech & Crypto Backend Engineering',
      '',
      '| Topic | Priority | Target knowledge |',
      '| --- | --- | --- |',
      '| Financial ledger and accounting | Critical | Double-entry, debit/credit, immutable records |',
      '',
      '* [TigerBeetle: Financial Accounting](https://docs.tigerbeetle.com/coding/financial-accounting/)',
    ]
    const html = lines
      .map(
        (line, index) =>
          `<p ${index === 0 ? 'data-pm-slice="0 0 []"' : ''} style="color: rgb(255, 255, 255); font-weight: 400; text-align: start">${line || '<br>'}</p>`,
      )
      .join('')
    const editor = paste(lines.join('\n'), html, markdownNote)
    expect(editor.view.dom.querySelector('h3')?.textContent).toBe(lines[0].slice(4))
    expect(editor.view.dom.querySelectorAll('table')).toHaveLength(1)
    expect(editor.view.dom.querySelectorAll('tr')).toHaveLength(2)
    expect(editor.view.dom.querySelector('td')?.textContent).toBe('Financial ledger and accounting')
    expect(editor.view.dom.querySelector('li')?.textContent).toContain(
      'TigerBeetle: Financial Accounting',
    )
    expect(editor.view.dom.querySelector('a')?.textContent).toBe(
      'TigerBeetle: Financial Accounting',
    )
  })

  it(`preserves literal Markdown copied inside Stash (Markdown note: ${markdownNote})`, () => {
    const source = paste('', '', markdownNote)
    insertLiteral(source, '**literal**')
    source.commands.selectAll()
    const copied = source.view.serializeForClipboard(source.state.selection.content())
    expect(copied.dom.querySelector('[data-stash-copy]')).not.toBeNull()
    const target = getEditor(
      'internal-paste',
      { type: 'doc', content: [{ type: 'paragraph' }] },
      undefined,
      markdownNote,
    )
    pasteInto(target, copied.text, copied.dom.innerHTML)
    expect(target.getText()).toBe('**literal**')
    expect(target.view.dom.querySelector('strong')).toBeNull()
  })

  it.each([
    ['<p><strong>**literal**</strong></p>', 'strong', '**literal**'],
    ['<pre><code>**literal**</code></pre>', 'pre code', '**literal**'],
    ['<p data-stash-copy="true" data-pm-slice="1 1 []">**literal**</p>', 'p', '**literal**'],
    ['<p><span style="font-style: italic">**literal**</span></p>', 'em', '**literal**'],
  ])(`preserves authored HTML %s (Markdown note: ${markdownNote})`, (html, selector, text) => {
    const editor = paste(text, html, markdownNote)
    expect(editor.view.dom.querySelector(selector)?.textContent).toBe(text)
    expect(editor.getText().trimEnd()).toBe(text)
  })

  it(`keeps line boundaries in ordinary HTML text (Markdown note: ${markdownNote})`, () => {
    const editor = paste('one\ntwo', '<p>one</p><p>two</p>', markdownNote)
    expect([...editor.view.dom.querySelectorAll('p')].map((p) => p.textContent)).toEqual([
      'one',
      'two',
    ])
  })

  it(`renders inline Markdown from a wrapper (Markdown note: ${markdownNote})`, () => {
    const editor = paste(
      '**Bold** and [link](https://example.com)',
      '<span>**Bold** and [link](https://example.com)</span>',
      markdownNote,
    )
    expect(editor.view.dom.querySelector('strong')?.textContent).toBe('Bold')
    expect(editor.view.dom.querySelector('a')?.getAttribute('href')).toBe('https://example.com')
  })

  it(`keeps plain paste and code literal (Markdown note: ${markdownNote})`, () => {
    const editor = paste('', '', markdownNote)
    plainPasteEditors.add(editor)
    pasteInto(editor, markdown, '<p># Title</p><p>**Bold**</p>')
    expect(editor.getText()).toContain('**Bold**')
    expect(editor.view.dom.querySelector('h1')).toBeNull()
    editor.commands.setContent('<pre><code></code></pre>')
    editor.commands.setTextSelection(1)
    pasteInto(editor, markdown, '<h1>Title</h1><p><strong>Bold</strong></p>')
    expect(editor.view.dom.querySelector('pre code')?.textContent).toBe(markdown)
  })
}

it('keeps Markdown literal when copied HTML has paragraph formatting', () => {
  const editor = paste('**literal**', '<p style="text-align: center">**literal**</p>')
  expect(editor.getText()).toBe('**literal**')
})

it('undoes a converted wrapper paste in one step without undoing earlier typing', () => {
  const editor = paste('')
  editor.commands.insertContent('Before')
  pasteInto(editor, markdown, '<p># Title</p><p>**Bold**</p>')
  expect(editor.view.dom.querySelector('h1')?.textContent).toBe('Title')
  expect(editor.commands.undo()).toBe(true)
  expect(editor.getText()).toBe('Before')
  expect(editor.commands.redo()).toBe(true)
  expect(editor.view.dom.querySelector('strong')?.textContent).toBe('Bold')
})

it.each([false, true])(
  'renders Markdown copied with an unformatted HTML wrapper (Markdown note: %s)',
  (markdownNote) => {
    const editor = paste(
      markdown,
      '<div><span># Title</span></div><div><br></div><div><span>**Bold**</span></div>',
      markdownNote,
    )
    expect(editor.view.dom.querySelector('h1')?.textContent).toBe('Title')
    expect(editor.view.dom.querySelector('strong')?.textContent).toBe('Bold')
  },
)
