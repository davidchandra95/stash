import { getSchema, type JSONContent } from '@tiptap/core'
import type { LinkedRoot, Note } from '../model'
import { writingExtensions } from './extensions'
import { parseMarkdown } from './markdown'

export function fileUrl(note: Note, roots: LinkedRoot[]) {
  const root = roots.find((r) => r.id === note.source?.rootId)
  if (!root || !note.source) throw Error('The linked folder is no longer available.')
  return new URL(
    `file://${`${root.path}/${note.source.relativePath}`.split('/').map(encodeURIComponent).join('/')}`,
  )
}

export async function convertMarkdownNote(
  note: Note,
  notes: Note[],
  roots: LinkedRoot[],
  readImage: (href: string) => Promise<string>,
): Promise<{ id: string; content: JSONContent; text: string }> {
  if (note.source?.markdown === undefined) throw Error(`${note.title}: Markdown was not loaded.`)
  const base = fileUrl(note, roots)
  const targets = new Map<string, Note>()
  // Prefer the live note when a trashed note has the same original path.
  for (const target of [...notes].sort((a, b) => Number(b.trashed) - Number(a.trashed))) {
    if (target.source) targets.set(fileUrl(target, roots).href, target)
  }
  const link = (href: string) => {
    if (/^[a-z][a-z\d+.-]*:/i.test(href) && !/^file:/i.test(href)) return href
    const url = new URL(href, base)
    const fragment = url.hash
    url.hash = ''
    const target = href.startsWith('#') ? note : targets.get(url.href)
    return target ? `upnote2://note/${target.id}${fragment}` : `${url.href}${fragment}`
  }
  const visit = async (node: JSONContent): Promise<JSONContent> => {
    if (node.type === 'rawMarkdown') {
      const source = String(node.attrs?.source ?? '')
      return {
        type: 'codeBlock',
        attrs: { language: 'markdown' },
        ...(source ? { content: [{ type: 'text', text: source }] } : {}),
      }
    }
    const attrs = { ...node.attrs }
    delete attrs.originalMarkdown
    delete attrs.originalJSON
    if (node.type === 'image') {
      const src = String(attrs.src ?? '')
      attrs.src = /^(https?:|data:image\/)/i.test(src) ? src : await readImage(src)
    }
    return {
      ...node,
      ...(node.attrs ? { attrs } : {}),
      ...(node.marks
        ? {
            marks: node.marks.map((mark) =>
              mark.type === 'link'
                ? { ...mark, attrs: { ...mark.attrs, href: link(String(mark.attrs?.href ?? '')) } }
                : mark,
            ),
          }
        : {}),
      ...(node.content ? { content: await Promise.all(node.content.map(visit)) } : {}),
    }
  }
  const content = await visit(parseMarkdown(note.source.markdown))
  const native = getSchema(writingExtensions).nodeFromJSON(content)
  native.check()
  return {
    id: note.id,
    content: native.toJSON(),
    text: native.textBetween(0, native.content.size, '\n'),
  }
}
