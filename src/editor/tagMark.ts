import { marked } from 'marked'
import { Mark } from '@tiptap/core'
import { tagMatches } from '../tags'

export function confirmedTag(text: string, tag: unknown): tag is string {
  const match = tagMatches(text)
  return (
    typeof tag === 'string' &&
    match.length === 1 &&
    match[0].from === 0 &&
    match[0].to === text.length &&
    match[0].tag === tag
  )
}
export const tagSpanPattern = /^<span data-confirmed-tag="([^"]+)">([^<]*)<\/span>/
export function readTagSpan(source: string) {
  const match = tagSpanPattern.exec(source)
  if (!match) return null
  try {
    const tag = decodeURIComponent(match[1])
    const element = document.createElement('span')
    element.innerHTML = marked.parseInline(match[2], { async: false }) as string
    const text = element.textContent ?? ''
    return confirmedTag(text, tag) ? { raw: match[0], tag, text, inner: match[2] } : null
  } catch {
    return null
  }
}
export const BodyTagMark = Mark.create({
  name: 'bodyTag',
  // Keep one outer span when the tag contains several formatting runs.
  priority: 1500,
  inclusive: false,
  addAttributes: () => ({ tag: { default: null, rendered: false } }),
  parseHTML: () => [
    {
      tag: 'span[data-confirmed-tag]',
      getAttrs: (element) => {
        try {
          const tag = decodeURIComponent(element.getAttribute('data-confirmed-tag') ?? '')
          return confirmedTag(element.textContent ?? '', tag) ? { tag } : false
        } catch {
          return false
        }
      },
    },
  ],
  renderHTML: ({ mark }) => [
    'span',
    { 'data-confirmed-tag': encodeURIComponent(mark.attrs.tag) },
    0,
  ],
  markdownTokenName: 'bodyTag',
  markdownTokenizer: {
    name: 'bodyTag',
    level: 'inline',
    start: (source) => source.indexOf('<span data-confirmed-tag="'),
    tokenize: (source, _tokens, helpers) => {
      const match = readTagSpan(source)
      return match
        ? { type: 'bodyTag', ...match, tokens: helpers.inlineTokens(match.inner) }
        : undefined
    },
  },
  parseMarkdown: (token, helpers) =>
    helpers.applyMark('bodyTag', helpers.parseInline(token.tokens ?? []), { tag: token.tag }),
  renderMarkdown: (node, helpers) => {
    const tag =
      node.marks?.find((mark: { type: string }) => mark.type === 'bodyTag')?.attrs?.tag ??
      node.attrs?.tag
    return `<span data-confirmed-tag="${encodeURIComponent(tag)}">${helpers.renderChildren(node)}</span>`
  },
})
