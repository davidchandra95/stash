import { Extension, Node, getSchema, type JSONContent, type MarkdownToken } from '@tiptap/core'
import { attachDomTooltip } from '../components/AppTooltip'
import { MarkdownManager } from '@tiptap/markdown'
import { Marked, type Token } from 'marked'
import { ShortcutStarterKit as StarterKit } from './shortcuts'
import Image from '@tiptap/extension-image'
import { TableKit } from '@tiptap/extension-table'
import { normalizeContent, plainPasteEditors } from './clipboard'
import { insertLiteral, pastePlain, canReadClipboard } from './plainPaste'
import { insertPastedContent } from './pasteContent'
import { Plugin } from '@tiptap/pm/state'
import { writingExtensions } from './extensions'
import { MixedList, MixedListItem } from './mixedLists'
import { markdownContexts } from './markdownContext'
import { NoteReference, referenceTitle } from './noteReferences'
import { findKey } from './noteTools'
import { documentMatches, literalMatches } from './searchText'

const RawMarkdown = Node.create({
  name: 'rawMarkdown',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes: () => ({ source: { default: '' }, label: { default: 'Markdown source' } }),
  parseHTML: () => [],
  renderHTML: ({ node }) => [
    'pre',
    { class: 'markdown-source-block', 'data-label': node.attrs.label },
    String(node.attrs.source),
  ],
  renderMarkdown: (node) => String(node.attrs?.source ?? ''),
  addNodeView() {
    return ({ node, editor, getPos }) => {
      let current = node,
        last = ''
      const dom = document.createElement('pre')
      dom.className = 'markdown-source-block'
      dom.contentEditable = 'false'
      const refresh = () => {
        const state = findKey.getState(editor.state)
        const source = String(current.attrs.source ?? ''),
          query = state?.query ?? ''
        const key = JSON.stringify([source, query, state?.active, getPos()])
        if (key === last) return
        last = key
        dom.dataset.label = current.attrs.label
        dom.replaceChildren()
        const selected =
          state &&
          documentMatches(editor.state.doc, query, (id, fallback) =>
            referenceTitle(editor, id, fallback),
          )[state.active]
        let offset = 0
        for (const match of literalMatches(source, query)) {
          dom.append(document.createTextNode(source.slice(offset, match.from)))
          const mark = document.createElement('mark')
          mark.className = `note-find-match ${selected && selected.from === getPos() && selected.offset === match.from ? 'current-match' : ''}`
          mark.dataset.searchOffset = String(match.from)
          mark.textContent = source.slice(match.from, match.to)
          dom.append(mark)
          offset = match.to
        }
        dom.append(document.createTextNode(source.slice(offset)))
      }
      editor.on('transaction', refresh)
      refresh()
      return {
        dom,
        update(next) {
          if (next.type !== current.type) return false
          current = next
          refresh()
          return true
        },
        ignoreMutation: () => true,
        destroy: () => editor.off('transaction', refresh),
      }
    }
  },
})
const SourceAttributes = Extension.create({
  name: 'markdownSource',
  priority: 1300,
  addKeyboardShortcuts() {
    return {
      'Mod-Shift-v': () => {
        plainPasteEditors.add(this.editor)
        if (canReadClipboard()) {
          plainPasteEditors.delete(this.editor)
          void pastePlain(this.editor)
          return true
        }
        return false
      },
    }
  },
  addGlobalAttributes: () => [
    {
      types: [
        'paragraph',
        'heading',
        'blockquote',
        'codeBlock',
        'mixedList',
        'table',
        'horizontalRule',
        'rawMarkdown',
      ],
      attributes: {
        originalMarkdown: { default: null, rendered: false },
        originalJSON: { default: null, rendered: false },
      },
    },
  ],
  addProseMirrorPlugins() {
    return [
      new Plugin({
        filterTransaction: (transaction) => {
          if (!transaction.docChanged) return true
          try {
            validateMarkdown(transaction.doc.toJSON())
            return true
          } catch (error) {
            queueMicrotask(() => {
              if (!this.editor.isDestroyed)
                this.editor.view.dom.dispatchEvent(
                  new CustomEvent('writing-error', { bubbles: true, detail: String(error) }),
                )
            })
            return false
          }
        },
        props: {
          handleClick: (_view, _pos, event) => {
            const link = (event.target as HTMLElement).closest('a[href]')
            if (!link) return false
            event.preventDefault()
            markdownContexts
              .get(this.editor)
              ?.open(link.getAttribute('href')!, event.metaKey || event.ctrlKey)
            return true
          },
          handlePaste: (_view, event) => {
            const files = Array.from(event.clipboardData?.files ?? []).filter((f) =>
              f.type.startsWith('image/'),
            )
            if (files.length) {
              void insertMarkdownImages(this.editor, files)
              return true
            }
            const data = event.clipboardData
            if (!data) return false
            const text = data.getData('text/plain'),
              html = data.getData('text/html')
            if (!text && !html) return false
            try {
              if (plainPasteEditors.has(this.editor) || this.editor.isActive('codeBlock'))
                insertLiteral(this.editor, text)
              else if (/^upnote2:\/\/note\/[a-zA-Z0-9_-]{1,128}$/.test(text.trim()))
                this.editor.commands.insertContent({
                  type: 'noteReference',
                  attrs: {
                    noteId: text.trim().slice('upnote2://note/'.length),
                    fallbackTitle: 'Note',
                  },
                })
              else {
                const content = html
                  ? normalizeContent(html, this.editor.options.extensions)
                  : parseMarkdown(text)
                validateMarkdown(content)
                insertPastedContent(this.editor, content)
              }
            } catch (error) {
              this.editor.view.dom.dispatchEvent(
                new CustomEvent('writing-error', { bubbles: true, detail: String(error) }),
              )
            }
            plainPasteEditors.delete(this.editor)
            return true
          },
          handleDrop: (_view, event) => {
            const files = Array.from(event.dataTransfer?.files ?? []).filter((f) =>
              f.type.startsWith('image/'),
            )
            if (!files.length) return false
            event.preventDefault()
            void insertMarkdownImages(this.editor, files)
            return true
          },
        },
      }),
    ]
  },
})
async function insertMarkdownImages(editor: import('@tiptap/core').Editor, files: File[]) {
  try {
    const context = markdownContexts.get(editor)
    if (!context) throw Error('This note is not ready for images yet.')
    for (const file of files) {
      const src = await context.saveImage(file)
      if (!editor.isDestroyed) editor.chain().focus().setImage({ src, alt: file.name }).run()
    }
  } catch (error) {
    if (editor.isDestroyed) return
    editor.view.dom.dispatchEvent(
      new CustomEvent('writing-error', { bubbles: true, detail: String(error) }),
    )
  }
}
const MarkdownImage = Image.configure({ inline: true, allowBase64: true }).extend({
  addNodeView() {
    return ({ node, editor }) => {
      const img = document.createElement('img')
      let tooltip: ReturnType<typeof attachDomTooltip> | undefined
      let alive = true
      let version = 0
      const update = (next: typeof node) => {
        if (next.type.name !== 'image') return false
        node = next
        const current = ++version
        tooltip?.destroy()
        tooltip = undefined
        const src = String(node.attrs.src ?? '')
        img.alt = String(node.attrs.alt ?? '')
        if (/^(https?:|data:|blob:)/i.test(src)) img.src = src
        else {
          img.removeAttribute('src')
          // Context is installed immediately after the editor mounts.
          queueMicrotask(() => {
            void markdownContexts
              .get(editor)
              ?.readImage(src)
              .then((url) => {
                if (alive && version === current) img.src = url
              })
              .catch((error) => {
                if (alive && version === current) {
                  tooltip = attachDomTooltip(img)
                  tooltip.update(String(error))
                }
              })
          })
        }
        return true
      }
      update(node)
      return {
        dom: img,
        update,
        destroy: () => {
          alive = false
          tooltip?.destroy()
        },
      }
    }
  },
})
function paragraphs(nodes: JSONContent[]): JSONContent[] {
  const result: JSONContent[] = []
  for (const node of nodes) {
    if (['text', 'image', 'hardBreak', 'noteReference'].includes(node.type ?? '')) {
      if (result.at(-1)?.type !== 'paragraph') result.push({ type: 'paragraph', content: [] })
      result.at(-1)!.content!.push(node)
    } else result.push(node)
  }
  if (result[0]?.type !== 'paragraph') result.unshift({ type: 'paragraph' })
  return result
}
const MarkdownList = MixedList.extend({
  markdownTokenName: 'list',
  parseMarkdown(token, helpers) {
    const items = (token.items ?? []) as MarkdownToken[]
    return helpers.createNode(
      'mixedList',
      { start: Number(token.start) || 1 },
      items.map((item) =>
        helpers.createNode(
          'mixedListItem',
          {
            kind: item.task ? 'task' : token.ordered ? 'number' : 'bullet',
            checked: !!item.checked,
          },
          paragraphs(helpers.parseChildren(item.tokens ?? [])),
        ),
      ),
    )
  },
  renderMarkdown(node, h) {
    let number = Number(node.attrs?.start) || 1
    return (node.content ?? [])
      .map((item) => {
        const marker =
          item.attrs?.kind === 'number'
            ? `${number++}. `
            : item.attrs?.kind === 'task'
              ? `- [${item.attrs.checked ? 'x' : ' '}] `
              : '- '
        const body = h.renderChildren(item.content ?? [], '\n\n').trimEnd()
        return marker + body.replace(/\n/g, '\n' + ' '.repeat(marker.length))
      })
      .join('\n')
  },
})
const MarkdownReference = NoteReference.extend({
  renderMarkdown: (node) =>
    `[${String(node.attrs?.fallbackTitle ?? 'Note').replace(/[[\]\\]/g, '\\$&')}](upnote2://note/${node.attrs?.noteId})`,
})
const excluded = new Set([
  'drawing',
  'starterKit',
  'tableKit',
  'writingClipboard',
  'mixedList',
  'mixedListItem',
  'image',
  'imageClipboard',
  'noteReference',
  'textStyleKit',
  'readableColor',
  'textAlign',
  'subscript',
  'superscript',
  'inlineCheckbox',
  'containerColors',
  'highlight',
  'typography',
  'collapsible',
  'collapsibleHeader',
  'collapsibleBody',
])
export const markdownExtensions = [
  ...writingExtensions.filter((e) => !excluded.has(e.name)),
  StarterKit.configure({
    codeBlock: false,
    code: false,
    bulletList: false,
    orderedList: false,
    listItem: false,
    underline: false,
    trailingNode: false,
    link: { openOnClick: false, protocols: ['file', 'upnote2'] },
  }),
  TableKit.configure({ table: { resizable: false } }),
  MarkdownList,
  MixedListItem,
  MarkdownImage,
  MarkdownReference,
  RawMarkdown,
  SourceAttributes,
]
const lexer = new Marked({ gfm: true, breaks: false })
const manager = new MarkdownManager({
  extensions: markdownExtensions,
  markedOptions: { gfm: true, breaks: false },
})
function clean(node: JSONContent): JSONContent {
  const attrs = Object.fromEntries(
    Object.entries(node.attrs ?? {}).filter(
      ([key, value]) => !['originalMarkdown', 'originalJSON'].includes(key) && value !== null,
    ),
  )
  return {
    type: node.type,
    ...(node.text !== undefined ? { text: node.text } : {}),
    ...(Object.keys(attrs).length ? { attrs } : {}),
    ...(node.marks?.length
      ? { marks: node.marks.map((m) => ({ ...clean(m), type: m.type })) }
      : {}),
    ...(node.content?.length ? { content: node.content.map(clean) } : {}),
  }
}
export const documentSignature = (doc: JSONContent) => JSON.stringify(clean(doc))
function unsafeToken(token: Token): boolean {
  if (['html', 'def'].includes(token.type)) return true
  if (
    token.type !== 'code' &&
    token.type !== 'codespan' &&
    /(?:\[\[.*?\]\]|\[\^[^\]]+\]|(?:^|\n)\s*(?:\$\$|:::|import .* from |export )|\$[^$\n]+\$|==[^=\n]+==|\{[.#][^}]+\})/.test(
      token.raw,
    )
  )
    return true
  const value = token as unknown as {
    tokens?: Token[]
    items?: Token[]
    header?: { tokens: Token[] }[]
    rows?: { tokens: Token[] }[][]
  }
  return [
    ...(value.tokens ?? []),
    ...(value.items ?? []),
    ...(value.header ?? []).flatMap((c) => c.tokens),
    ...(value.rows ?? []).flatMap((r) => r.flatMap((c) => c.tokens)),
  ].some(unsafeToken)
}
function raw(source: string, label = 'Preserved Markdown source'): JSONContent {
  return { type: 'rawMarkdown', attrs: { source, label } }
}
export function parseMarkdown(source: string): JSONContent {
  let remaining = source
  const content: JSONContent[] = []
  const header = /^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/.exec(remaining)
  if (header) {
    content.push(raw(header[0], 'Frontmatter'))
    remaining = remaining.slice(header[0].length)
  } else if (remaining.startsWith('\uFEFF')) {
    content.push(raw('\uFEFF', 'File encoding marker'))
    remaining = remaining.slice(1)
  }
  const tokens = lexer.lexer(remaining)
  const definitions = tokens
    .filter((t) => t.type === 'def')
    .map((t) => t.raw)
    .join('\n')
  for (const token of tokens) {
    if (token.type === 'space') {
      const previous = content.at(-1)
      if (previous)
        previous.attrs = {
          ...previous.attrs,
          originalMarkdown:
            String(previous.attrs?.originalMarkdown ?? previous.attrs?.source ?? '') + token.raw,
        }
      else content.push(raw(token.raw, 'Spacing'))
      continue
    }
    let nodes: JSONContent[]
    try {
      if (unsafeToken(token)) nodes = [raw(token.raw)]
      else {
        nodes = manager.parse(token.raw + (definitions ? '\n\n' + definitions : '')).content ?? []
        if (!nodes.length) nodes = [raw(token.raw)]
        // The Markdown manager can return a standalone inline image. Native
        // and linked documents both require inline content inside a paragraph.
        const blocks: JSONContent[] = []
        for (const node of nodes) {
          if (['text', 'image', 'hardBreak', 'noteReference'].includes(node.type ?? '')) {
            if (blocks.at(-1)?.type !== 'paragraph') blocks.push({ type: 'paragraph', content: [] })
            blocks.at(-1)!.content!.push(node)
          } else blocks.push(node)
        }
        nodes = blocks
        // Plain text carrying extension syntax stays verbatim until intentionally edited.
      }
      for (const node of nodes) {
        node.attrs = {
          ...node.attrs,
          originalMarkdown: nodes.length === 1 ? token.raw : null,
          originalJSON: documentSignature(node),
        }
        content.push(node)
      }
    } catch {
      content.push(raw(token.raw))
    }
  }
  const doc = { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] }
  const normalized = getSchema(markdownExtensions).nodeFromJSON(doc)
  normalized.check()
  // Capture signatures after schema defaults have been added.
  const result = normalized.toJSON() as JSONContent
  for (const node of result.content ?? [])
    if (node.attrs?.originalMarkdown !== null && node.attrs?.originalMarkdown !== undefined)
      node.attrs.originalJSON = documentSignature(node)
  return result
}
const nodeNames = new Set([
  'doc',
  'text',
  'paragraph',
  'heading',
  'blockquote',
  'codeBlock',
  'horizontalRule',
  'hardBreak',
  'mixedList',
  'mixedListItem',
  'table',
  'tableRow',
  'tableHeader',
  'tableCell',
  'image',
  'noteReference',
  'rawMarkdown',
])
const markNames = new Set(['bold', 'italic', 'strike', 'code', 'link'])
export function validateMarkdown(doc: JSONContent) {
  const visit = (n: JSONContent) => {
    if (
      n.type === 'table' &&
      n.content?.some((row, index) =>
        row.content?.some((cell) => cell.type !== (index === 0 ? 'tableHeader' : 'tableCell')),
      )
    )
      throw Error('Markdown tables require a single header row.')
    if (!nodeNames.has(n.type ?? ''))
      throw Error(`Markdown cannot preserve ${n.type}. Keep this note in an ordinary notebook.`)
    if (n.marks?.some((m) => !markNames.has(m.type)))
      throw Error(
        'Markdown cannot preserve this text formatting. Keep this note in an ordinary notebook.',
      )
    if (
      Object.entries(n.attrs ?? {}).some(
        ([key, value]) =>
          [
            'color',
            'backgroundColor',
            'fontFamily',
            'fontSize',
            'textAlign',
            'width',
            'height',
          ].includes(key) &&
          value !== null &&
          value !== undefined &&
          value !== '',
      )
    )
      throw Error('Markdown cannot preserve colors, sizing, or alignment.')
    if (
      ['tableCell', 'tableHeader'].includes(n.type ?? '') &&
      ((n.attrs?.colspan ?? 1) !== 1 ||
        (n.attrs?.rowspan ?? 1) !== 1 ||
        (n.content?.length ?? 0) > 1)
    )
      throw Error('Markdown tables require one paragraph per cell without merged cells.')
    n.content?.forEach(visit)
  }
  visit(doc)
}
export function serializeMarkdown(doc: JSONContent, original = ''): string {
  validateMarkdown(doc)
  let result = ''
  for (const node of doc.content ?? []) {
    const preserved =
      node.attrs?.originalMarkdown != null && node.attrs.originalJSON === documentSignature(node)
    const part = preserved
      ? String(node.attrs!.originalMarkdown)
      : node.type === 'rawMarkdown'
        ? String(node.attrs?.source ?? '')
        : manager.serialize({ type: 'doc', content: [node] })
    if (result && !result.endsWith('\n\n') && !result.endsWith('\r\n\r\n'))
      result += result.endsWith('\n') ? '\n' : '\n\n'
    result += part
  }
  const newline = original.includes('\r\n') ? '\r\n' : '\n'
  return result.replace(/\r?\n/g, newline)
}
