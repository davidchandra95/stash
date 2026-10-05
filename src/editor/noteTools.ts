import { Extension, type Editor } from '@tiptap/core'
import type { Node } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export type HeadingEntry = { pos: number; level: number; title: string; children: HeadingEntry[] }
export function outline(doc: Node): HeadingEntry[] {
  const roots: HeadingEntry[] = [],
    stack: HeadingEntry[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'heading') return
    const entry = {
      pos,
      level: Number(node.attrs.level),
      title: node.textBetween(0, node.content.size, ' ', ' ').trim() || 'Untitled heading',
      children: [],
    }
    while (stack.length && stack.at(-1)!.level >= entry.level) stack.pop()
    ;(stack.at(-1)?.children ?? roots).push(entry)
    stack.push(entry)
  })
  return roots
}
export { literalMatches, documentMatches } from './searchText'
import { documentMatches } from './searchText'
import type { DocumentMatch } from './searchText'
import { referenceTitle } from './noteReferences'
type FindState = { query: string; active: number; decorations: DecorationSet }
export const findKey = new PluginKey<FindState>('findInNote')
export const FindInNote = Extension.create({
  name: 'findInNote',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: findKey,
        state: {
          init: () => ({ query: '', active: -1, decorations: DecorationSet.empty }),
          apply: (tr, previous) => {
            const value = tr.getMeta(findKey) ?? previous
            if (!tr.docChanged && value === previous) return previous
            return {
              ...value,
              decorations: DecorationSet.create(
                tr.doc,
                documentMatches(tr.doc, value.query, (id, fallback) =>
                  referenceTitle(this.editor, id, fallback),
                ).flatMap((match, i) =>
                  match.segment.nodeType === 'rawMarkdown'
                    ? []
                    : [
                        (match.atom ? Decoration.node : Decoration.inline)(match.from, match.to, {
                          class: `note-find-match ${i === value.active ? 'current-match' : ''}`,
                        }),
                      ],
                ),
              ),
            }
          },
        },
        props: { decorations: (state) => findKey.getState(state)!.decorations },
      }),
    ]
  },
})
// UI-only transactions must also skip Tiptap's automatic trailing paragraph.
export function setFind(editor: Editor, query: string, active: number) {
  if (editor.isDestroyed) return
  const old = findKey.getState(editor.state)
  if (old?.query === query && old.active === active) return
  editor.view.dispatch(
    editor.state.tr
      .setMeta(findKey, { query, active })
      .setMeta('addToHistory', false)
      .setMeta('skipTrailingNode', true),
  )
}
export const revealKey = new PluginKey<Set<number>>('navigationReveal')
export const NavigationReveal = Extension.create({
  name: 'navigationReveal',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: revealKey,
        state: {
          init: () => new Set<number>(),
          apply(tr, previous) {
            const action = tr.getMeta(revealKey)
            if (action?.clear) return new Set<number>()
            const next = new Set<number>()
            for (const pos of previous) {
              const mapped = tr.mapping.mapResult(pos)
              if (!mapped.deleted && tr.doc.nodeAt(mapped.pos)?.attrs.collapsed)
                next.add(mapped.pos)
            }
            if (action?.hide !== undefined) next.delete(action.hide)
            for (const pos of action?.reveal ?? []) next.add(pos)
            return next
          },
        },
        props: {
          decorations(state) {
            return DecorationSet.create(
              state.doc,
              [...revealKey.getState(state)!].flatMap((pos) => {
                const node = state.doc.nodeAt(pos)
                return node?.type.name === 'collapsible' && node.attrs.collapsed
                  ? [
                      Decoration.node(
                        pos,
                        pos + node.nodeSize,
                        { class: 'navigation-revealed' },
                        { navigationReveal: true },
                      ),
                    ]
                  : []
              }),
            )
          },
        },
      }),
    ]
  },
})
export function clearReveals(editor: Editor, pos?: number) {
  if (editor.isDestroyed) return
  if (!revealKey.getState(editor.state)?.size) return
  editor.view.dispatch(
    editor.state.tr
      .setMeta(revealKey, pos === undefined ? { clear: true } : { hide: pos })
      .setMeta('addToHistory', false)
      .setMeta('skipTrailingNode', true),
  )
}
// Decorations reveal hidden ancestors without changing saved collapse attributes.
export function revealPosition(editor: Editor, pos: number) {
  const resolved = editor.state.doc.resolve(pos)
  const reveal: number[] = []
  for (let depth = 1; depth <= resolved.depth; depth++) {
    const node = resolved.node(depth)
    if (node.type.name === 'collapsible' && node.attrs.collapsed)
      reveal.push(resolved.before(depth))
  }
  if (reveal.length)
    editor.view.dispatch(
      editor.state.tr
        .setMeta(revealKey, { reveal })
        .setMeta('addToHistory', false)
        .setMeta('skipTrailingNode', true),
    )
}
export function scrollToPosition(editor: Editor, pos: number) {
  revealPosition(editor, pos)
  const dom = editor.view.domAtPos(pos).node
  const element = dom instanceof Element ? dom : dom.parentElement
  element?.scrollIntoView({ block: 'center', behavior: 'instant' })
  const scroll = editor.view.dom.closest<HTMLElement>('.note-scroll')
  if (scroll) {
    const coords = editor.view.coordsAtPos(pos)
    const rect = scroll.getBoundingClientRect()
    scroll.scrollTop += coords.top - rect.top - scroll.clientHeight / 2
    if (coords.left < rect.left || coords.right > rect.right)
      scroll.scrollLeft += coords.left - rect.left - scroll.clientWidth / 2
  }
}

export function scrollToMatch(editor: Editor, match: DocumentMatch) {
  scrollToPosition(editor, match.from)
  if (match.segment.nodeType !== 'rawMarkdown') return
  const node = editor.view.nodeDOM(match.from)
  const mark =
    node instanceof Element
      ? node.querySelector<HTMLElement>(`[data-search-offset="${match.offset}"]`)
      : null
  const scroll = editor.view.dom.closest<HTMLElement>('.note-scroll')
  if (mark && scroll) {
    mark.scrollIntoView({ block: 'center', behavior: 'instant' })
    scroll.scrollTop +=
      mark.getBoundingClientRect().top -
      scroll.getBoundingClientRect().top -
      scroll.clientHeight / 2
  }
}
