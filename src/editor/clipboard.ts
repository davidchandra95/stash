import { isPdfLink, parsePdfCitation } from '../pdf/citations'
import { validNoteId } from './noteReferences'
import { canReadClipboard, pastePlain, insertLiteral } from './plainPaste'
import { insertPastedContent } from './pasteContent'
import { Extension, generateJSON, type JSONContent, type Editor } from '@tiptap/core'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { Plugin } from '@tiptap/pm/state'
import { DOMSerializer } from '@tiptap/pm/model'
import { ClipboardSerializer, clipboardText } from './copy'
import { closeHistory } from '@tiptap/pm/history'
import { copyDrawings, pasteDrawings } from '../drawing/clipboard'
export function safeHTML(html: string) {
  // Preserve only validated PDF targets; all other URLs keep DOMPurify's default policy.
  const template = document.createElement('template')
  template.innerHTML = html
  const links = new Map<string, string>()
  for (const anchor of template.content.querySelectorAll('a[href]')) {
    const href = anchor.getAttribute('href')!
    if (parsePdfCitation(href)) {
      const key = `https://pdf-citation.invalid/${crypto.randomUUID()}`
      links.set(key, href)
      anchor.setAttribute('href', key)
    } else if (isPdfLink(href)) anchor.removeAttribute('href')
  }
  const clean = DOMPurify.sanitize(template.innerHTML, {
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'style', 'form'],
    FORBID_ATTR: ['srcset'],
  })
  template.innerHTML = clean
  for (const anchor of template.content.querySelectorAll('a[href]')) {
    const href = links.get(anchor.getAttribute('href')!)
    if (href) anchor.setAttribute('href', href)
  }
  return template.innerHTML
}
export function markdownHTML(text: string) {
  return safeHTML(marked.parse(text, { async: false, breaks: false }) as string)
}
export const plainPasteEditors = new WeakSet<Editor>()
export const Clipboard = Extension.create({
  name: 'writingClipboard',
  priority: 1200,
  addProseMirrorPlugins() {
    const editor = this.editor
    const serializer = DOMSerializer.fromSchema(editor.schema)

    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            copy: (_view, event) => copyDrawings(editor, event, false),
            cut: (_view, event) => copyDrawings(editor, event, true),
          },
          clipboardSerializer: new ClipboardSerializer(serializer.nodes, serializer.marks),
          clipboardTextSerializer: () => clipboardText(editor),
          handleKeyDown: (_view, event) => {
            if (
              (event.metaKey || event.ctrlKey) &&
              event.shiftKey &&
              event.key.toLowerCase() === 'v'
            ) {
              plainPasteEditors.add(editor)
              if (canReadClipboard()) {
                plainPasteEditors.delete(editor)
                void pastePlain(editor)
                return true
              }
            } else plainPasteEditors.delete(editor)
            return false
          },
          handlePaste: (view, event) => {
            const data = event.clipboardData
            if (!data) return false
            const text = data.getData('text/plain'),
              html = data.getData('text/html')
            const literal = plainPasteEditors.has(editor) || editor.isActive('codeBlock')
            plainPasteEditors.delete(editor)
            if (!text && !html) return literal
            view.dispatch(closeHistory(view.state.tr))
            if (literal) {
              insertLiteral(editor, text)
            } else if (pasteDrawings(editor, data)) {
              // The private format preserves editable drawings; external HTML is a preview.
            } else if (
              /^upnote2:\/\/note\/[a-zA-Z0-9_-]{1,128}$/.test(text.trim()) &&
              validNoteId(text.trim().slice('upnote2://note/'.length))
            ) {
              editor.commands.insertContent({
                type: 'noteReference',
                attrs: {
                  noteId: text.trim().slice('upnote2://note/'.length),
                  fallbackTitle: 'Untitled note',
                },
              })
            } else
              insertPastedContent(
                editor,
                normalizeContent(html || markdownHTML(text), editor.options.extensions),
              )
            view.dispatch(closeHistory(view.state.tr))
            return true
          },
        },
      }),
    ]
  },
})
export function normalizeContent(
  input: JSONContent | string,
  extensions: Parameters<typeof generateJSON>[1],
): JSONContent {
  const json =
    typeof input === 'string' ? generateJSON(safeHTML(input), extensions) : structuredClone(input)
  const attrs = (values: Record<string, unknown>) => {
    const result = { ...values }
    for (const key of ['color', 'backgroundColor'])
      if (typeof result[key] === 'string' && result[key]) {
        const style = document.createElement('span').style
        style.color = result[key] as string
        if (style.color) result[key] = style.color
      }
    return result
  }
  const visit = (node: JSONContent): JSONContent => {
    node = {
      ...node,
      ...(node.attrs ? { attrs: attrs(node.attrs) } : {}),
      ...(node.marks
        ? {
            marks: node.marks.map((mark) => ({
              ...mark,
              ...(mark.attrs ? { attrs: attrs(mark.attrs) } : {}),
            })),
          }
        : {}),
    }
    if (!node.content) return node
    const content: JSONContent[] = []
    for (const child of node.content.map(visit)) {
      const previous = content.at(-1)
      if (previous?.type === 'mixedList' && child.type === 'mixedList')
        previous.content = [...(previous.content ?? []), ...(child.content ?? [])]
      else content.push(child)
    }
    return { ...node, content }
  }
  return visit(json)
}
