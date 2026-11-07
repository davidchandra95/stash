import { Extension } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    headingNumbers: {
      /** Turns automatic numbering on or off for the headings in the selection. */
      toggleHeadingNumber: () => ReturnType
    }
  }
}

/**
 * Numbers for numbered top-level headings. Each level counts on its own, and a heading of a
 * higher level restarts the count below it, so every H3 section under an H2 starts at 1.
 * Headings without numbering keep their place in the outline but do not take a number.
 */
export function headingNumbers(doc: ProseMirrorNode) {
  const numbers = new Map<number, string>()
  const counts: number[] = []
  doc.forEach((node, pos) => {
    if (node.type.name !== 'heading') return
    const level = Number(node.attrs.level)
    counts.length = level
    if (!node.attrs.numbered) return
    counts[level - 1] = (counts[level - 1] ?? 0) + 1
    numbers.set(pos, `${counts[level - 1]}.`)
  })
  return numbers
}

const numbersKey = new PluginKey<DecorationSet>('headingNumbers')
function numberDecorations(doc: ProseMirrorNode) {
  return DecorationSet.create(
    doc,
    [...headingNumbers(doc)].map(([pos, number]) =>
      Decoration.widget(
        pos + 1,
        () => {
          const span = document.createElement('span')
          span.className = 'heading-number'
          span.contentEditable = 'false'
          span.textContent = number
          return span
        },
        { side: -1, ignoreSelection: true, key: `number-${number}` },
      ),
    ),
  )
}

export const HeadingNumbers = Extension.create({
  name: 'headingNumbers',
  addGlobalAttributes: () => [
    {
      types: ['heading'],
      attributes: {
        numbered: {
          default: false,
          parseHTML: (element) => element.dataset.numbered === 'true',
          renderHTML: (attributes) => (attributes.numbered ? { 'data-numbered': 'true' } : {}),
        },
      },
    },
  ],
  addCommands() {
    return {
      toggleHeadingNumber:
        () =>
        ({ state, tr, dispatch }) => {
          const headings: { pos: number; node: ProseMirrorNode }[] = []
          state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
            if (node.type.name === 'heading') headings.push({ pos, node })
            return node.isBlock && node.type.name !== 'heading'
          })
          if (!headings.length) return false
          const numbered = !headings.every(({ node }) => node.attrs.numbered)
          if (dispatch)
            for (const { pos, node } of headings)
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, numbered })
          return true
        },
    }
  },
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: numbersKey,
        state: {
          init: (_config, state) => numberDecorations(state.doc),
          apply: (tr, previous) => (tr.docChanged ? numberDecorations(tr.doc) : previous),
        },
        props: { decorations: (state) => numbersKey.getState(state) },
      }),
    ]
  },
})
