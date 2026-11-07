import { Extension, type Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state'
import { ReplaceStep } from '@tiptap/pm/transform'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

/**
 * Folding under top-level headings. A folded heading hides the blocks after it up to the next
 * heading of the same or a higher level. Folding is view state: it never changes the document,
 * the undo history or the saved note, and it is remembered per note on this device.
 */
type Fold = { pos: number; key: string }
type FoldState = { folds: Fold[] }
type FoldAction = { toggle?: number; fold?: number[]; unfold?: number[] }
export type HiddenRange = { heading: number; from: number; to: number }

export const headingFoldKey = new PluginKey<FoldState>('headingFolds')
const storageKey = 'stash-heading-folds'

/** Top-level headings with their position and a key that survives a full document reload. */
function headings(doc: ProseMirrorNode) {
  const seen = new Map<string, number>()
  const list: { pos: number; level: number; key: string }[] = []
  doc.forEach((node, pos) => {
    if (node.type.name !== 'heading') return
    const level = Number(node.attrs.level)
    const base = `${level}:${node.textContent.trim()}`
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    list.push({ pos, level, key: `${base}:${count}` })
  })
  return list
}

/** Document ranges hidden by the given folded heading positions, outermost first. */
export function hiddenRanges(doc: ProseMirrorNode, folded: Iterable<number>): HiddenRange[] {
  const set = new Set(folded)
  const ranges: HiddenRange[] = []
  let open: { heading: number; level: number; from: number } | undefined
  doc.forEach((node, pos) => {
    const level = node.type.name === 'heading' ? Number(node.attrs.level) : Infinity
    if (open && level <= open.level) {
      if (pos > open.from) ranges.push({ heading: open.heading, from: open.from, to: pos })
      open = undefined
    }
    if (!open && set.has(pos)) open = { heading: pos, level, from: pos + node.nodeSize }
  })
  if (open && doc.content.size > open.from)
    ranges.push({ heading: open.heading, from: open.from, to: doc.content.size })
  return ranges
}

export const foldedHeadings = (state: EditorState) =>
  (headingFoldKey.getState(state)?.folds ?? []).map((fold) => fold.pos)

function readStored(noteId: string): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '{}')[noteId]
    return Array.isArray(saved) ? saved.filter((key) => typeof key === 'string') : []
  } catch {
    return []
  }
}
function writeStored(noteId: string, keys: string[]) {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '{}')
    if (keys.length) saved[noteId] = keys
    else delete saved[noteId]
    localStorage.setItem(storageKey, JSON.stringify(saved))
  } catch (error) {
    console.warn('Could not remember folded headings', error)
  }
}
function dispatchFolds(editor: Editor, action: FoldAction) {
  if (editor.isDestroyed) return
  editor.view.dispatch(
    editor.state.tr
      .setMeta(headingFoldKey, action)
      .setMeta('addToHistory', false)
      .setMeta('skipTrailingNode', true),
  )
}
export const toggleHeadingFold = (editor: Editor, pos: number) =>
  dispatchFolds(editor, { toggle: pos })

/** Unfolds every heading that hides the position, so navigation can land on it. */
export function unfoldAround(editor: Editor, pos: number) {
  const unfold = hiddenRanges(editor.state.doc, foldedHeadings(editor.state))
    .filter((range) => pos >= range.from && pos < range.to)
    .map((range) => range.heading)
  if (unfold.length) dispatchFolds(editor, { unfold })
}

function arrow(folded: boolean, onToggle: () => void) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'heading-fold-toggle'
  button.contentEditable = 'false'
  button.dataset.folded = String(folded)
  button.setAttribute('aria-label', folded ? 'Expand section' : 'Collapse section')
  button.setAttribute('aria-expanded', String(!folded))
  button.innerHTML =
    '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  button.onmousedown = (event) => event.preventDefault()
  button.onclick = (event) => {
    event.preventDefault()
    event.stopPropagation()
    onToggle()
  }
  return button
}

export const HeadingFolds = Extension.create<{ noteId: string | null }>({
  name: 'headingFolds',
  // Enter on a folded heading runs before Typing's Enter (1100); menus like slash stay above.
  priority: 1150,
  addOptions: () => ({ noteId: null }),
  addKeyboardShortcuts() {
    return {
      // Enter at the end of a folded heading starts the next section: a heading of the same
      // level after the hidden blocks, since anything else there would join the fold.
      Enter: ({ editor }) => {
        const { state } = editor
        const { selection } = state
        if (!selection.empty || selection.$from.depth !== 1) return false
        const heading = selection.$from.before(1)
        if (selection.$from.parentOffset !== selection.$from.parent.content.size) return false
        const range = hiddenRanges(state.doc, foldedHeadings(state)).find(
          (candidate) => candidate.heading === heading,
        )
        if (!range) return false
        const level = selection.$from.parent.attrs.level
        const tr = state.tr.insert(range.to, state.schema.nodes.heading.create({ level }))
        editor.view.dispatch(
          tr.setSelection(TextSelection.create(tr.doc, range.to + 1)).scrollIntoView(),
        )
        return true
      },
    }
  },
  addProseMirrorPlugins() {
    const noteId = this.options.noteId
    const editor = this.editor
    const fromKeys = (doc: ProseMirrorNode, keys: Iterable<string>) => {
      const wanted = new Set(keys)
      return headings(doc).filter((heading) => wanted.has(heading.key))
    }
    return [
      new Plugin<FoldState>({
        key: headingFoldKey,
        state: {
          init: (_config, state) => ({
            folds: noteId
              ? fromKeys(state.doc, readStored(noteId)).map(({ pos, key }) => ({ pos, key }))
              : [],
          }),
          apply(tr, previous) {
            const action = tr.getMeta(headingFoldKey) as FoldAction | undefined
            if (!tr.docChanged && !action) return previous
            const current = headings(tr.doc)
            const byPos = new Map(current.map((heading) => [heading.pos, heading]))
            const next = new Map<number, string>()
            const lost: string[] = []
            for (const fold of previous.folds) {
              // Map the heading's first inner position so a level change keeps the fold.
              const mapped = tr.mapping.mapResult(fold.pos + 1, -1)
              const heading = byPos.get(mapped.pos - 1)
              if (!mapped.deletedAcross && heading) next.set(heading.pos, heading.key)
              else lost.push(fold.key)
            }
            // A replaced document (reload, sync) keeps folds whose heading is still there.
            const replacedAll = tr.steps.some(
              (step) =>
                step instanceof ReplaceStep &&
                step.from === 0 &&
                step.to === tr.before.content.size,
            )
            if (replacedAll)
              for (const heading of current)
                if (lost.includes(heading.key) && !next.has(heading.pos))
                  next.set(heading.pos, heading.key)
            for (const pos of action?.unfold ?? []) next.delete(pos)
            for (const pos of action?.fold ?? [])
              if (byPos.has(pos)) next.set(pos, byPos.get(pos)!.key)
            if (action?.toggle !== undefined) {
              if (next.has(action.toggle)) next.delete(action.toggle)
              else if (byPos.has(action.toggle))
                next.set(action.toggle, byPos.get(action.toggle)!.key)
            }
            return { folds: [...next].map(([pos, key]) => ({ pos, key })) }
          },
        },
        appendTransaction(transactions, oldState, state) {
          const folds = foldedHeadings(state)
          if (!folds.length) return null
          const { selection } = state
          const ranges = hiddenRanges(state.doc, folds)
          const inside = ranges.filter(
            (range) => selection.from >= range.from && selection.from < range.to,
          )
          if (!inside.length) return null
          const tr = state.tr.setMeta('addToHistory', false).setMeta('skipTrailingNode', true)
          // Edits that land in a hidden section (undo, paste, split) show it.
          if (transactions.some((transaction) => transaction.docChanged))
            return tr.setMeta(headingFoldKey, { unfold: inside.map((range) => range.heading) })
          // Moving the caret skips over hidden sections instead of entering them.
          const outer = inside[0]
          const forward = selection.head >= oldState.selection.head
          const after = outer.to < state.doc.content.size
          if (forward && after)
            return tr.setSelection(TextSelection.near(state.doc.resolve(outer.to), 1))
          const heading = state.doc.nodeAt(outer.heading)!
          return tr.setSelection(
            TextSelection.create(state.doc, outer.heading + heading.nodeSize - 1),
          )
        },
        view(view) {
          const signature = (state: EditorState) =>
            (headingFoldKey.getState(state)?.folds ?? []).map((fold) => fold.key).join('\n')
          let last = signature(view.state)
          return {
            update(view) {
              if (!noteId) return
              const next = signature(view.state)
              if (next === last) return
              last = next
              writeStored(noteId, next ? next.split('\n') : [])
            },
          }
        },
        props: {
          decorations(state) {
            const folds = new Set(foldedHeadings(state))
            const decorations: Decoration[] = []
            for (const heading of headings(state.doc)) {
              const folded = folds.has(heading.pos)
              decorations.push(
                Decoration.widget(
                  heading.pos + 1,
                  (_view, getPos) =>
                    arrow(folded, () => {
                      // The widget can outlive edits above it, so find its heading on click.
                      const pos = getPos()
                      if (pos !== undefined) toggleHeadingFold(editor, pos - 1)
                    }),
                  {
                    side: -1,
                    ignoreSelection: true,
                    key: `fold-${folded ? 1 : 0}`,
                    stopEvent: () => true,
                  },
                ),
              )
              if (folded)
                decorations.push(
                  Decoration.node(
                    heading.pos,
                    heading.pos + state.doc.nodeAt(heading.pos)!.nodeSize,
                    {
                      class: 'heading-folded',
                    },
                  ),
                )
            }
            for (const range of hiddenRanges(state.doc, folds))
              state.doc.nodesBetween(range.from, range.to, (node, pos) => {
                decorations.push(
                  Decoration.node(pos, pos + node.nodeSize, { class: 'heading-fold-hidden' }),
                )
                return false
              })
            return DecorationSet.create(state.doc, decorations)
          },
        },
      }),
    ]
  },
})
