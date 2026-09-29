// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import { parseMarkdown, serializeMarkdown, markdownExtensions, validateMarkdown } from './markdown'
import { runCommand } from './commands'
describe('file-backed Markdown', () => {
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
