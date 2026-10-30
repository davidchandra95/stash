// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import { parseMarkdown, serializeMarkdown, markdownExtensions, validateMarkdown } from './markdown'
import { runCommand } from './commands'

describe('Markdown block boundaries', () => {
  it.each([
    ['', '', ''],
    ['', 'last', 'last'],
    ['first', 'last', 'first\n\nlast'],
    ['first\n', 'last', 'first\n\nlast'],
    ['first\n\n', 'last', 'first\n\nlast'],
    ['first\r\n', 'last', 'first\n\nlast'],
    ['first\r\n\r\n', 'last', 'first\n\nlast'],
    ['first\n\n\n', 'last', 'first\n\n\nlast'],
  ])('preserves spacing between raw blocks %j and %j', (first, last, expected) => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'rawMarkdown', attrs: { source: first } },
        { type: 'rawMarkdown', attrs: { source: last } },
      ],
    }
    expect(serializeMarkdown(doc)).toBe(expected)
    expect(serializeMarkdown(doc, '\r\n')).toBe(expected.replace(/\n/g, '\r\n'))
  })

  it('keeps separators when an empty block follows an unterminated block', () => {
    const doc = {
      type: 'doc',
      content: ['first', '', 'last', ''].map((source) => ({
        type: 'rawMarkdown', attrs: { source },
      })),
    }
    expect(serializeMarkdown(doc)).toBe('first\n\nlast\n\n')
  })

  it('preserves spacing around a lone carriage return', () => {
    const doc = {
      type: 'doc',
      content: ['first\n\n\r', '\n', 'last'].map((source) => ({
        type: 'rawMarkdown', attrs: { source },
      })),
    }
    expect(serializeMarkdown(doc)).toBe('first\n\n\n\n\nlast')
  })
})

describe('file-backed Markdown', () => {
  it.each(['*', '-', '1.', '- [x]'])(
    'renders links and inline formatting in tight %s list items',
    (marker) => {
      const source = `${marker} [Guide](https://example.com/guide) with **bold**, *italic*, and \`code\`\n`
      const editor = new Editor({ extensions: markdownExtensions, content: parseMarkdown(source) })
      try {
        const item = editor.view.dom.querySelector('li')!
        expect(item.querySelector('a')?.textContent).toBe('Guide')
        expect(item.querySelector('a')?.getAttribute('href')).toBe('https://example.com/guide')
        expect(item.querySelector('strong')?.textContent).toBe('bold')
        expect(item.querySelector('em')?.textContent).toBe('italic')
        expect(item.querySelector('code')?.textContent).toBe('code')
        expect(serializeMarkdown(editor.getJSON(), source)).toBe(source)
      } finally {
        editor.destroy()
      }
    },
  )

  it('renders links in nested and loose list paragraphs', () => {
    const source =
      '- [Top](top.md)\n  - **[Child](child.md)**\n\n    Continued *[guide](guide.md)*.\n\n- [x] [Done](done.md)\n'
    const editor = new Editor({ extensions: markdownExtensions, content: parseMarkdown(source) })
    try {
      expect([...editor.view.dom.querySelectorAll('li a')].map((a) => a.textContent)).toEqual([
        'Top',
        'Child',
        'guide',
        'Done',
      ])
      expect(editor.view.dom.querySelector('li li a[href="child.md"]')?.textContent).toBe('Child')
      expect(editor.view.dom.querySelector('li li strong')?.textContent).toBe('Child')
      expect(editor.view.dom.querySelector('li li a[href="guide.md"]')?.textContent).toBe('guide')
      expect(editor.view.dom.querySelector('li li em')?.textContent).toBe('guide')
      expect(serializeMarkdown(editor.getJSON(), source)).toBe(source)
    } finally {
      editor.destroy()
    }
  })

  it('keeps reference links in list items resolved without changing their source', () => {
    const source = '- [Guide][guide]\n\n[guide]: docs/guide.md "Guide"\n'
    const editor = new Editor({ extensions: markdownExtensions, content: parseMarkdown(source) })
    try {
      const link = editor.view.dom.querySelector('li a')!
      expect(link.textContent).toBe('Guide')
      expect(link.getAttribute('href')).toBe('docs/guide.md')
      expect(serializeMarkdown(editor.getJSON(), source)).toBe(source)
    } finally {
      editor.destroy()
    }
  })

  it('retains list formatting when a parsed link is edited, saved and undone', () => {
    const source = '- [Guide](docs/guide.md) and **bold**\r\n'
    const editor = new Editor({ extensions: markdownExtensions, content: parseMarkdown(source) })
    try {
      editor.commands.setTextSelection({ from: 3, to: 8 })
      editor.commands.insertContent('Updated guide')
      const saved = serializeMarkdown(editor.getJSON(), source)
      expect(saved).toContain('[Updated guide](docs/guide.md)')
      expect(saved).toContain('**bold**')
      const reopened = new Editor({ extensions: markdownExtensions, content: parseMarkdown(saved) })
      try {
        expect(reopened.view.dom.querySelector('li a')?.textContent).toBe('Updated guide')
        expect(reopened.view.dom.querySelector('li strong')?.textContent).toBe('bold')
      } finally {
        reopened.destroy()
      }
      expect(editor.commands.undo()).toBe(true)
      expect(serializeMarkdown(editor.getJSON(), source)).toBe(source)
    } finally {
      editor.destroy()
    }
  })

  it('reads rich Markdown including mixed lists, tasks, tables and Mermaid', () => {
    const source =
      '# Title\n\n- one\n- [x] done\n  - nested\n\n| A | B |\n| - | - |\n| one | two |\n\n```mermaid\ngraph TD\nA-->B\n```\n'
    const doc = parseMarkdown(source)
    const json = JSON.stringify(doc)
    expect(json).toContain('mixedList')
    expect(json).toContain('task')
    expect(json).toContain('table')
    expect(json).toContain('mermaid')
    const result = serializeMarkdown(doc, source)
    expect(result).toContain('- [x] done')
    expect(result).toContain('graph TD')
    expect(result).toContain('| A | B |')
  })
  it('preserves frontmatter, HTML and comments when a different paragraph changes', () => {
    const source =
      '---\r\ntitle: Keep me\r\n---\r\n\r\n<!-- do not drop -->\r\n\r\n<div class="x">Custom</div>\r\n\r\nChange this.\r\n'
    const doc = parseMarkdown(source)
    const paragraph = doc.content!.find((n) => n.type === 'paragraph')!
    paragraph.content = [{ type: 'text', text: 'Changed.' }]
    const saved = serializeMarkdown(doc, source)
    expect(saved).toContain('title: Keep me\r\n')
    expect(saved).toContain('<!-- do not drop -->')
    expect(saved).toContain('<div class="x">Custom</div>')
    expect(saved).toContain('Changed.')
    expect(saved.replace(/\r\n/g, '')).not.toContain('\n')
  })
  it('keeps reference links and definitions available', () => {
    const source = 'See [the guide][guide].\n\n[guide]: docs/guide.md "Guide"\n'
    const saved = serializeMarkdown(parseMarkdown(source), source)
    expect(saved).toContain('[the guide][guide]')
    expect(saved).toContain('[guide]: docs/guide.md "Guide"')
  })
  it('rejects lossy native conversion and blocks unsupported commands', () => {
    expect(() =>
      validateMarkdown({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'x', marks: [{ type: 'highlight' }] }],
          },
        ],
      }),
    ).toThrow('formatting')
    const editor = new Editor({ extensions: markdownExtensions, content: parseMarkdown('hello') })
    expect(runCommand(editor, 'underline')).toBe(false)
    expect(runCommand(editor, 'collapsible')).toBe(false)
    editor.commands.insertContent(' world')
    expect(serializeMarkdown(editor.getJSON())).toContain('world')
    editor.destroy()
  })
  it('keeps local image paths and links in editable nodes', () => {
    const doc = parseMarkdown('![Photo](assets/photo.png) and [Next](next.md#heading)\n')
    expect(JSON.stringify(doc)).toContain('assets/photo.png')
    expect(JSON.stringify(doc)).toContain('next.md#heading')
  })
})

it('serializes edited tables, nested tasks, emphasis, quotes, code and images', () => {
  const source =
    '# Heading\n\n**bold** and *italic* and ~~strike~~ and `code`\n\n> quote\n\n- [x] done\n  - nested\n\n1. first\n2. second\n\n| Left | Right |\n| :--- | ---: |\n| a | b |\n\n```mermaid\ngraph TD\nA-->B\n```\n\n![Image](assets/a.png) [Link](other.md)'
  const doc = parseMarkdown(source)
  const strip = (node: import('@tiptap/core').JSONContent) => {
    if (node.attrs) {
      delete node.attrs.originalMarkdown
      delete node.attrs.originalJSON
    }
    node.content?.forEach(strip)
  }
  strip(doc)
  const saved = serializeMarkdown(doc, source)
  const roundtrip = parseMarkdown(saved)
  const json = JSON.stringify(roundtrip)
  for (const type of [
    'heading',
    'bold',
    'italic',
    'strike',
    'code',
    'blockquote',
    'mixedList',
    'task',
    'table',
    'mermaid',
    'image',
    'other.md',
  ])
    expect(json).toContain(type)
  expect(saved).toContain('- [x] done')
  expect(saved).toContain('assets/a.png')
  expect(saved).toContain('A-->B')
})
it('labels unsupported syntax and keeps it when surrounding content changes', () => {
  const source = 'Math $x^2$ and [[Wiki link]]\n\n::: custom\nExtension block\n:::\n\nEditable'
  const doc = parseMarkdown(source)
  expect(doc.content!.filter((n) => n.type === 'rawMarkdown').length).toBeGreaterThanOrEqual(2)
  doc.content!.at(-1)!.content = [{ type: 'text', text: 'Changed' }]
  const saved = serializeMarkdown(doc, source)
  expect(saved).toContain('Math $x^2$ and [[Wiki link]]')
  expect(saved).toContain('::: custom\nExtension block\n:::')
  expect(saved).toContain('Changed')
})

it('rejects a table edit that Markdown cannot represent before it enters the document', () => {
  const editor = new Editor({
    extensions: markdownExtensions,
    content: parseMarkdown('| A | B |\n| - | - |\n| a | b |'),
  })
  const before = editor.getJSON()
  editor.commands.selectAll()
  editor.commands.insertContent({
    type: 'table',
    content: [
      {
        type: 'tableRow',
        content: [
          {
            type: 'tableHeader',
            attrs: { colspan: 2 },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Merged' }] }],
          },
        ],
      },
    ],
  })
  expect(editor.getJSON()).toEqual(before)
  editor.destroy()
})
