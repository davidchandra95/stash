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

/** A task tag from what someone typed: lowercase, no leading #, no spaces, at most 50 characters. */
export function taskTagName(value: string): string | undefined {
  const name = value.trim().replace(/^#+/, '').trim().toLowerCase().replace(/\s+/g, '-')
  return [...name].slice(0, 50).join('') || undefined
}

/** Color tones for tags; themes that color tags define `--tone-<name>` for each. */
export const tagTones = ['indigo', 'blue', 'teal', 'green', 'gold', 'orange', 'pink', 'purple']

/** Tones someone can pick for a tag: the automatic ones plus slate. */
export const tagColorChoices = [...tagTones, 'slate'] as const
export type TagColor = (typeof tagColorChoices)[number]
export const tagColorLabels: Record<TagColor, string> = {
  indigo: 'Indigo',
  blue: 'Blue',
  teal: 'Teal',
  green: 'Green',
  gold: 'Gold',
  orange: 'Orange',
  pink: 'Pink',
  purple: 'Purple',
  slate: 'Slate',
}
export const isTagColor = (value: unknown): value is TagColor =>
  tagColorChoices.includes(value as TagColor)

/**
 * CSS that recolors tags someone picked a color for. Chips carry `data-tag` and tags in note
 * text `data-body-tag`; matching ignores case like tagTone, and beats the plain `[data-tone]`
 * rule, so every place a tag appears follows without re-rendering.
 */
export function tagColorRules(colors: Record<string, TagColor>) {
  return Object.entries(colors)
    .filter(([, tone]) => isTagColor(tone))
    .map(([tag, tone]) => {
      const name = JSON.stringify(tag)
      return `:is([data-tag=${name} i], [data-body-tag=${name} i])[data-tone] { --tone: var(--tone-${tone}); }`
    })
    .join('\n')
}

/** A stable tone for a tag, so it keeps its color everywhere it appears. */
export function tagTone(tag: string) {
  // FNV-1a spreads short, similar words across tones better than a plain rolling hash.
  let hash = 2166136261
  for (const char of tag.toLowerCase()) {
    hash ^= char.codePointAt(0)!
    hash = Math.imul(hash, 16777619) >>> 0
  }
  return tagTones[hash % tagTones.length]
}
