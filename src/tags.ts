const terminalPunctuation = new Set([
  '.',
  ',',
  '!',
  '?',
  ';',
  ':',
  ')',
  ']',
  '}',
  '>',
  '"',
  "'",
  '”',
  '’',
])

export type TagMatch = { tag: string; from: number; to: number }

const word = (value: string | undefined) => value !== undefined && /[\p{L}\p{N}_]/u.test(value)

/**
 * Finds body hashtags without changing the text that the user wrote. A tag is
 * any non-space token after #, except sentence punctuation at its end.
 */
export function tagMatches(text: string): TagMatch[] {
  const matches: TagMatch[] = []
  for (let from = 0; from < text.length; from++) {
    if (text[from] !== '#' || word(text[from - 1]) || text[from - 1] === '#') continue
    let end = from + 1
    while (end < text.length && !/\s/u.test(text[end])) end++
    let to = end
    while (to > from + 1 && terminalPunctuation.has(text[to - 1])) to--
    const raw = text.slice(from + 1, to)
    if (!raw || raw.startsWith('#')) continue
    matches.push({ tag: raw.toLowerCase(), from, to })
  }
  return matches
}

export function tagsFromText(text: string): string[] {
  return [...new Set(tagMatches(text).map((match) => match.tag))]
}

/** Converts pre-body tag labels to a safe, stable hashtag name. */
export function legacyTagName(value: string): string | undefined {
  const source = value.trim().replace(/^#+/, '').toLowerCase()
  if (!source) return undefined
  const normalized = source
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (normalized) return normalized
  const bytes = [...new TextEncoder().encode(source)]
  return `tag-${bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

export function tagFooter(tags: Iterable<string>): string {
  const unique = [...new Set([...tags].filter(Boolean))]
  return unique.length ? `Tags: ${unique.map((tag) => `#${tag}`).join(' ')}` : ''
}

/** Only explicit marks carry tag identity. Plain hashtags never enter the index. */
export function tagsFromContent(doc: import('@tiptap/core').JSONContent): string[] {
  const tags = new Set<string>()
  const visit = (node: import('@tiptap/core').JSONContent) => {
    let tag: string | undefined,
      text = ''
    const flush = () => {
      const matches = tagMatches(text)
      if (
        tag &&
        matches.length === 1 &&
        matches[0].from === 0 &&
        matches[0].to === text.length &&
        matches[0].tag === tag
      )
        tags.add(tag)
      tag = undefined
      text = ''
    }
    for (const child of node.content ?? []) {
      const next =
        child.type === 'text'
          ? child.marks?.find((m) => m.type === 'bodyTag')?.attrs?.tag
          : undefined
      if (!next || next !== tag) flush()
      if (next) {
        tag = next
        text += child.text ?? ''
      } else visit(child)
    }
    flush()
  }
  visit(doc)
  return [...tags]
}

export function tagFooterContent(tags: string[]): import('@tiptap/core').JSONContent {
  return {
    type: 'paragraph',
    content: [
      { type: 'text', text: 'Tags: ' },
      ...tags.flatMap((tag, index) => [
        ...(index ? [{ type: 'text', text: ' ' }] : []),
        { type: 'text', text: `#${tag}`, marks: [{ type: 'bodyTag', attrs: { tag } }] },
      ]),
    ],
  }
}
