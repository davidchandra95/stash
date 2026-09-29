// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import type { Note } from '../model'
import { convertMarkdownNote } from './notebookConversion'
import { resolveFileLink } from './fileNavigation'
import { Editor } from '@tiptap/core'
import { writingExtensions } from './extensions'
const roots = [{ id: 'root', path: '/notes folder' }]
function note(id: string, path: string, markdown: string): Note {
  return {
    id,
    title: id,
    notebookIds: ['root'],
    quickAccess: false,
    tags: [],
    content: { type: 'doc', content: [] },
    text: '',
    pinned: false,
    trashed: false,
    updated: 1,
    source: { rootId: 'root', relativePath: path, fingerprint: 'hash', markdown },
  }
}
it('converts formatting, images, note links, heading fragments, and attachment paths', async () => {
  const a = note(
    'a',
    'a.md',
    '# Heading\n\n**Bold** and [next](child/b.md#next-heading).\n\n![photo](assets/pic.png)\n\n[PDF](files/a%20b.pdf)\n\n- [x] Done\n\n| A | B |\n| - | - |\n| 1 | 2 |',
  )
  const b = note('b', 'child/b.md', '# Next heading')
  const read = vi.fn(async () => 'data:image/png;base64,aW1hZ2U=')
  const result = await convertMarkdownNote(a, [a, b], roots, read)
  expect(read).toHaveBeenCalledWith('assets/pic.png')
  const json = JSON.stringify(result.content)
  expect(json).toContain('upnote2://note/b#next-heading')
  expect(json).toContain('file:///notes%20folder/files/a%20b.pdf')
  expect(json).toContain('data:image/png;base64,aW1hZ2U=')
  expect(json).toContain('"type":"bold"')
  expect(json).toContain('"type":"table"')
  expect(json).toContain('"checked":true')
  expect(json).not.toContain('originalMarkdown')
  const editor = new Editor({ extensions: writingExtensions, content: result.content })
  expect(editor.getHTML()).toContain('href="upnote2://note/b#next-heading"')
  expect(editor.getHTML()).toContain('href="file:///notes%20folder/files/a%20b.pdf"')
  editor.destroy()
})
it('keeps frontmatter and unsupported Markdown verbatim in editable code blocks', async () => {
  const source = '---\ntitle: My note\n---\n\n<div>Raw HTML</div>\n\nText with $math$.'
  const a = note('a', 'a.md', source)
  const result = await convertMarkdownNote(a, [a], roots, async () => {
    throw Error('unused')
  })
  expect(JSON.stringify(result.content)).not.toContain('rawMarkdown')
  const blocks = result.content.content!.filter((n) => n.type === 'codeBlock')
  expect(blocks.map((n) => n.content?.[0]?.text).join('\n')).toContain('title: My note')
  expect(blocks.map((n) => n.content?.[0]?.text).join('\n')).toContain('<div>Raw HTML</div>')
  expect(result.text).toContain('$math$')
})
it('preserves web links and remote images, converts self fragments, and propagates missing images', async () => {
  const a = note(
    'a',
    'a.md',
    '[Self](#heading) [Web](https://example.com)\n\n![Remote](https://example.com/a.png)',
  )
  const read = vi.fn()
  const result = await convertMarkdownNote(a, [a], roots, read)
  expect(read).not.toHaveBeenCalled()
  expect(JSON.stringify(result.content)).toContain('upnote2://note/a#heading')
  expect(JSON.stringify(result.content)).toContain('https://example.com/a.png')
  a.source!.markdown = '![Missing](missing.png)'
  await expect(
    convertMarkdownNote(a, [a], roots, async () => {
      throw Error('missing.png unavailable')
    }),
  ).rejects.toThrow('missing.png')
  expect(resolveFileLink(a, 'upnote2://note/b#hello%20world', [], [])).toEqual({
    id: 'b',
    fragment: 'hello world',
  })
})
