import type { JSONContent } from '@tiptap/core'
import type { LinkedRoot, Note } from '../model'
export const pendingFragments = new Map<string, string>()
function absolute(note: Note, roots: LinkedRoot[]) {
  const root = roots.find((r) => r.id === note.source?.rootId)
  return root && note.source ? `${root.path}/${note.source.relativePath}` : undefined
}
export function resolveFileLink(note: Note, href: string, notes: Note[], roots: LinkedRoot[]) {
  if (href.startsWith('upnote2://note/')) {
    try {
      const url = new URL(href)
      const id = url.pathname.slice(1)
      return /^[a-zA-Z0-9_-]{1,128}$/.test(id)
        ? { id, fragment: decodeURIComponent(url.hash.slice(1)) }
        : null
    } catch {
      return null
    }
  }
  const base = absolute(note, roots)
  if (!base) return null
  try {
    const url = new URL(href, `file://${base.split('/').map(encodeURIComponent).join('/')}`)
    if (url.protocol !== 'file:') return null
    const path = decodeURIComponent(url.pathname)
    const target = notes.find((n) => !n.trashed && absolute(n, roots) === path)
    return target ? { id: target.id, fragment: decodeURIComponent(url.hash.slice(1)) } : null
  } catch {
    return null
  }
}
export function relativeFileLink(from: Note, to: Note, roots: LinkedRoot[]) {
  const a = absolute(from, roots),
    b = absolute(to, roots)
  if (!a || !b) return `upnote2://note/${to.id}`
  const left = a.split('/').slice(0, -1),
    right = b.split('/')
  while (left.length && right.length && left[0] === right[0]) {
    left.shift()
    right.shift()
  }
  return [...left.map(() => '..'), ...right.map(encodeURIComponent)].join('/')
}
export function fileReferences(
  doc: JSONContent,
  from: Note,
  notes: Note[],
  roots: LinkedRoot[],
): JSONContent {
  if (doc.type === 'noteReference') {
    const target = notes.find((n) => n.id === doc.attrs?.noteId)
    if (target?.source)
      return {
        type: 'text',
        text: target.title || 'Untitled',
        marks: [{ type: 'link', attrs: { href: relativeFileLink(from, target, roots) } }],
      }
  }
  return {
    ...doc,
    ...(doc.content
      ? { content: doc.content.map((n) => fileReferences(n, from, notes, roots)) }
      : {}),
  }
}
export function headingSlug(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-')
}
