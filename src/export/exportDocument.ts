import { generateHTML, type JSONContent } from '@tiptap/core'
import DOMPurify from 'dompurify'
import { drawingLabel, drawingPreview, readDrawing } from '../drawing/model'
import { writingExtensions } from '../editor/extensions'
import { serializeMarkdown } from '../editor/markdown'

/**
 * Export conversions. Markdown export is forgiving, unlike the lossless folder-notebook format:
 * whatever Markdown can't represent becomes the nearest thing it can, so exporting never fails.
 */

const markdownMarks = new Set(['bold', 'italic', 'strike', 'code', 'link', 'bodyTag'])
const styleAttrs = ['textAlign', 'backgroundColor', 'color', 'fontFamily', 'fontSize', 'width', 'height', 'numbered', 'colwidth']

const text = (value: string): JSONContent => ({ type: 'text', text: value })
const inlineTypes = new Set(['text', 'hardBreak', 'noteReference', 'taskReference', 'inlineCheckbox', 'image'])
const inline = (node: JSONContent): JSONContent[] =>
  inlineTypes.has(node.type ?? '') ? [node] : (node.content ?? []).flatMap(inline)
/** The inline content of each text block, in order, for flattening into one line. */
const textBlocks = (node: JSONContent): JSONContent[][] =>
  node.content?.some((child) => inlineTypes.has(child.type ?? ''))
    ? [node.content.flatMap(inline)]
    : (node.content ?? []).flatMap(textBlocks)
const withoutStyle = (attrs: Record<string, unknown> | undefined) => {
  if (!attrs) return undefined
  const kept = Object.fromEntries(Object.entries(attrs).filter(([key]) => !styleAttrs.includes(key)))
  return Object.keys(kept).length ? kept : undefined
}

/** One table cell's blocks as a single paragraph, since a Markdown cell holds one line. */
function cellParagraph(cell: JSONContent): JSONContent {
  const parts: JSONContent[] = []
  textBlocks(cell).forEach((block, index) => {
    if (index) parts.push(text(' '))
    parts.push(...block.map((node) => (node.type === 'hardBreak' ? text(' ') : node)))
  })
  return { type: 'paragraph', ...(parts.length ? { content: parts.flatMap(simplify) } : {}) }
}

/** Unmerges cells and makes the first row the header, as GFM tables require. */
function simplifyTable(table: JSONContent): JSONContent {
  const rows = (table.content ?? []).map((row) =>
    (row.content ?? []).flatMap((cell) => {
      const span = Math.max(1, Number(cell.attrs?.colspan ?? 1))
      const first = cellParagraph(cell)
      return [first, ...Array.from({ length: span - 1 }, () => ({ type: 'paragraph' }) as JSONContent)]
    }),
  )
  const width = Math.max(1, ...rows.map((row) => row.length))
  return {
    type: 'table',
    content: rows.map((cells, index) => ({
      type: 'tableRow',
      content: [...cells, ...Array.from({ length: width - cells.length }, () => ({ type: 'paragraph' }) as JSONContent)].map(
        (paragraph) => ({ type: index === 0 ? 'tableHeader' : 'tableCell', content: [paragraph] }),
      ),
    })),
  }
}

/** Where an exported image points: the identity, or a file the export writes beside the note. */
let mapImage: (src: string) => string = (src) => src

/** One node in Markdown-safe form; may become several nodes or none. */
function simplify(node: JSONContent): JSONContent[] {
  switch (node.type) {
    case 'text': {
      const marks = node.marks?.filter((mark) => markdownMarks.has(mark.type))
      return [{ type: 'text', text: node.text, ...(marks?.length ? { marks } : {}) }]
    }
    case 'inlineCheckbox':
      return [text(node.attrs?.checked ? '☑ ' : '☐ ')]
    case 'drawing': {
      const data = readDrawing(node.attrs?.data)
      const preview = drawingPreview(data)
      return [
        preview
          ? { type: 'paragraph', content: [{ type: 'image', attrs: { src: mapImage(preview), alt: 'Drawing' } }] }
          : { type: 'paragraph', content: [text(drawingLabel(data))] },
      ]
    }
    case 'image':
      return [{ type: 'image', attrs: { src: mapImage(String(node.attrs?.src ?? '')), alt: node.attrs?.alt ?? null, title: node.attrs?.title ?? null } }]
    case 'collapsible': {
      const header = node.content?.find((child) => child.type === 'collapsibleHeader')
      const body = node.content?.find((child) => child.type === 'collapsibleBody')
      const title = header ? textBlocks(header).flatMap((block, i) => [...(i ? [{ type: 'hardBreak' }] : []), ...block]).flatMap(simplify) : []
      const bold = title.map((child) =>
        child.type === 'text' ? { ...child, marks: [...(child.marks ?? []), { type: 'bold' }] } : child,
      )
      return [
        ...(bold.length ? [{ type: 'paragraph', content: bold }] : []),
        ...(body?.content ?? []).flatMap(simplify),
      ]
    }
    case 'collapsibleHeader':
    case 'collapsibleBody':
      return (node.content ?? []).flatMap(simplify)
    case 'table':
      return [simplifyTable(node)]
    default: {
      const attrs = withoutStyle(node.attrs)
      return [
        {
          ...node,
          attrs,
          ...(node.content ? { content: node.content.flatMap(simplify) } : {}),
        },
      ].map((n) => {
        if (n.attrs === undefined) delete n.attrs
        return n
      })
    }
  }
}

/**
 * A note as Markdown, with a title heading when the body doesn't start with one. `image` maps
 * each image source, so an export can write embedded images to files and link them instead.
 */
export function noteMarkdown(title: string, doc: JSONContent, image?: (src: string) => string): string {
  mapImage = image ?? ((src) => src)
  let content: JSONContent[]
  try {
    content = (doc.content ?? []).flatMap(simplify)
  } finally {
    mapImage = (src) => src
  }
  const startsWithTitle = content[0]?.type === 'heading' && plain(content[0]).trim() === title.trim()
  const body = serializeMarkdown({ type: 'doc', content })
  return `${startsWithTitle || !title.trim() ? '' : `# ${title.trim()}\n\n`}${body}`.replace(/\s*$/, '\n')
}

const plain = (node: JSONContent): string =>
  node.type === 'text' ? (node.text ?? '') : (node.content ?? []).map(plain).join('')

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** A note as one self-contained HTML file; images stay embedded. */
export function noteHtml(title: string, doc: JSONContent): string {
  const body = DOMPurify.sanitize(generateHTML(doc, writingExtensions), {
    ADD_DATA_URI_TAGS: ['img'],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|upnote2:|stash:|data:image\/|#)/i,
  })
  const name = escapeHtml(title.trim() || 'Untitled')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${name}</title>
<style>
  :root { color-scheme: light dark; }
  body { max-width: 720px; margin: 40px auto; padding: 0 20px; font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  h1, h2, h3 { line-height: 1.25; }
  img { max-width: 100%; height: auto; }
  pre { padding: 12px; overflow-x: auto; border-radius: 6px; background: rgba(127, 127, 127, 0.12); }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em; }
  blockquote { margin-left: 0; padding-left: 16px; border-left: 3px solid rgba(127, 127, 127, 0.4); }
  table { border-collapse: collapse; }
  th, td { padding: 6px 10px; border: 1px solid rgba(127, 127, 127, 0.35); vertical-align: top; }
  ul[data-type] { padding-left: 24px; }
  li[data-kind="ordered"] { list-style: decimal; }
  li[data-kind="task"] { list-style: none; }
  li[data-kind="task"] > p::before { content: "☐"; display: inline-block; width: 1.4em; margin-left: -1.4em; }
  li[data-kind="task"][data-checked="true"] > p::before { content: "☑"; }
  li > p { margin: 0; }
</style>
</head>
<body>
<h1>${name}</h1>
${body}
</body>
</html>
`
}

/** A file or folder name: no path separators or characters other systems reject. */
export function fileName(title: string, fallback = 'Untitled') {
  const cleaned = [...title.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '-').replace(/\s+/g, ' ').trim().replace(/^\.+/, '')]
    .slice(0, 120)
    .join('')
    .trim()
  return cleaned || fallback
}

/** Gives each name in a folder a unique, case-insensitive spelling: "Notes", "Notes 2", … */
export function uniqueNames() {
  const used = new Set<string>()
  return (name: string, extension = '') => {
    let candidate = name
    for (let n = 2; used.has(`${candidate}${extension}`.toLowerCase()); n++) candidate = `${name} ${n}`
    used.add(`${candidate}${extension}`.toLowerCase())
    return `${candidate}${extension}`
  }
}
