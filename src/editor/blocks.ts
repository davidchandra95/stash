import type { Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { runCommand } from './commands'

/**
 * Blocks are what the block handle acts on: each top-level node, and each list item at any
 * depth. Everything inside a table, quote, code block or collapsible section belongs to that
 * top-level block.
 */
export type Block = { pos: number; node: ProseMirrorNode; listItem: boolean }
export type BlockKind =
  | 'paragraph'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'h5'
  | 'h6'
  | 'bullet'
  | 'number'
  | 'task'
  | 'quote'
  | 'code'
  | 'table'
  | 'divider'
  | 'section'
  | 'drawing'
  | 'block'
export const listKinds = ['bullet', 'number', 'task'] as const

export function blockAt(doc: ProseMirrorNode, pos: number): Block | null {
  const $pos = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)))
  for (let depth = $pos.depth; depth > 0; depth--)
    if ($pos.node(depth).type.name === 'mixedListItem')
      return { pos: $pos.before(depth), node: $pos.node(depth), listItem: true }
  if ($pos.depth >= 1) return { pos: $pos.before(1), node: $pos.node(1), listItem: false }
  const node = doc.nodeAt(pos)
  return node ? { pos, node, listItem: false } : null
}

/** Finds the block whose element holds `element`, for hover tracking. */
export function blockAtElement(view: EditorView, element: Element): Block | null {
  const item = element.closest('[data-type="mixedListItem"]')
  let target: Element | null = item && view.dom.contains(item) ? item : element
  if (!item) while (target && target.parentElement !== view.dom) target = target.parentElement
  if (!target) return null
  let pos: number
  try {
    pos = view.posAtDOM(target, 0)
  } catch {
    return null
  }
  const { doc } = view.state
  if (item) {
    // Node views can put controls before the content, so match the item's DOM exactly.
    for (const candidate of [pos, pos - 1])
      if (candidate >= 0 && view.nodeDOM(candidate) === item)
        return { pos: candidate, node: doc.nodeAt(candidate)!, listItem: true }
    let found: Block | null = null
    doc.descendants((node, offset) => {
      if (found) return false
      if (node.type.name === 'mixedListItem' && view.nodeDOM(offset) === item)
        found = { pos: offset, node, listItem: true }
      return !found
    })
    return found
  }
  // A top-level block: an atom resolves to the gap before it, anything else to inside it.
  const $pos = doc.resolve(pos)
  if ($pos.depth >= 1) return { pos: $pos.before(1), node: $pos.node(1), listItem: false }
  const node = doc.nodeAt(pos)
  return node ? { pos, node, listItem: false } : null
}

export function blockKind(block: Block): BlockKind {
  const { node } = block
  if (block.listItem) return node.attrs.kind ?? 'bullet'
  switch (node.type.name) {
    case 'paragraph':
      return 'paragraph'
    case 'heading':
      return `h${Math.min(6, Number(node.attrs.level))}` as BlockKind
    case 'blockquote':
      return 'quote'
    case 'codeBlock':
      return 'code'
    case 'table':
      return 'table'
    case 'horizontalRule':
      return 'divider'
    case 'collapsible':
      return 'section'
    case 'drawing':
      return 'drawing'
    case 'mixedList':
      return node.firstChild?.attrs.kind ?? 'bullet'
    default:
      return 'block'
  }
}

/** Puts the text selection over the block's own text so formatting commands apply to it. */
export function selectBlockText(editor: Editor, block: Block) {
  const { doc } = editor.state
  let to = block.pos + block.node.nodeSize - 1
  // A list item's own text is its first paragraph, not the items nested under it.
  if (block.listItem && block.node.firstChild)
    to = block.pos + 1 + block.node.firstChild.nodeSize - 1
  const selection = TextSelection.between(doc.resolve(block.pos + 1), doc.resolve(to))
  editor.view.dispatch(editor.state.tr.setSelection(selection))
}

/** Leaves the caret at the end of the selection, so the formatting toolbar does not open. */
export function collapseSelection(editor: Editor) {
  const { selection, doc } = editor.state
  if (selection.empty || !(selection instanceof TextSelection)) return
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(doc, selection.to)))
}

/** Changes the block into another type, like the slash menu does for the current line. */
export function turnBlockInto(editor: Editor, block: Block, id: string) {
  const kind = blockKind(block)
  if (kind === id && id !== 'number') return true
  // The ordered-list button numbers a heading instead of turning it into a list.
  if (id === 'number' && /^h\d$/.test(kind)) {
    selectBlockText(editor, block)
    return runCommand(editor, 'heading-number')
  }
  selectBlockText(editor, block)
  // A list item becomes plain text first, then takes the new type.
  if (block.listItem && !listKinds.includes(id as (typeof listKinds)[number])) {
    if (!runCommand(editor, kind)) return false
    if (id === 'paragraph') return true
  }
  return runCommand(editor, id)
}

/** The range a block occupies, widened to its parent when it is that parent's only child. */
function removalRange(doc: ProseMirrorNode, block: Block) {
  let from = block.pos
  let to = block.pos + block.node.nodeSize
  let $from = doc.resolve(from)
  while ($from.depth > 0 && $from.parent.childCount === 1) {
    from = $from.before()
    to = $from.after()
    $from = doc.resolve(from)
  }
  return { from, to }
}

export function deleteBlock(editor: Editor, block: Block) {
  const { state } = editor
  const { from, to } = removalRange(state.doc, block)
  const tr = state.tr
  if (from === 0 && to === state.doc.content.size)
    tr.replaceWith(0, to, state.schema.nodes.paragraph.create())
  else tr.delete(from, to)
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(from, tr.doc.content.size))))
  editor.view.dispatch(tr.scrollIntoView())
  editor.view.focus()
}

/** Copies or cuts the block through the editor's normal clipboard handling. */
export function copyBlock(editor: Editor, block: Block, cut = false) {
  editor.view.focus()
  editor.view.dispatch(
    editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, block.pos)),
  )
  if (!document.execCommand(cut ? 'cut' : 'copy'))
    throw new Error(`The block could not be ${cut ? 'cut' : 'copied'}.`)
}

/**
 * Where a dragged block may land. Top-level blocks land between top-level blocks; list items
 * also land between list items. Positions are document positions between nodes.
 */
export type DropTarget = { pos: number; listItem: boolean; top: number; left: number }
export function dropTargets(view: EditorView, block: Block): DropTarget[] {
  const targets: DropTarget[] = []
  const visible = (element: Element) => element.getClientRects().length > 0
  const add = (pos: number, listItem: boolean, rect: DOMRect, edge: 'top' | 'bottom') =>
    targets.push({ pos, listItem, top: edge === 'top' ? rect.top : rect.bottom, left: rect.left })
  const { doc } = view.state
  let pos = 0
  let last: DOMRect | undefined
  doc.forEach((node, offset) => {
    const element = view.nodeDOM(offset)
    pos = offset + node.nodeSize
    if (!(element instanceof HTMLElement) || !visible(element)) return
    const rect = element.getBoundingClientRect()
    add(offset, false, rect, 'top')
    last = rect
  })
  if (last) add(pos, false, last, 'bottom')
  if (block.listItem)
    doc.descendants((node, offset) => {
      if (node.type.name !== 'mixedList') return true
      let itemPos = offset + 1
      let lastItem: DOMRect | undefined
      node.forEach((item) => {
        const element = view.nodeDOM(itemPos)
        if (element instanceof HTMLElement && visible(element)) {
          const rect = element.getBoundingClientRect()
          add(itemPos, true, rect, 'top')
          lastItem = rect
        }
        itemPos += item.nodeSize
      })
      if (lastItem) add(itemPos, true, lastItem, 'bottom')
      return true
    })
  // A block cannot land inside itself.
  const end = block.pos + block.node.nodeSize
  return targets.filter((target) => target.pos <= block.pos || target.pos >= end)
}

/** The drop target nearest the pointer; list gaps win ties so items stay in lists. */
export function nearestDrop(targets: DropTarget[], y: number) {
  let best: DropTarget | undefined
  for (const target of targets) {
    const distance = Math.abs(target.top - y)
    const bestDistance = best ? Math.abs(best.top - y) : Infinity
    if (
      distance < bestDistance - 2 ||
      (distance <= bestDistance + 2 && target.listItem && !best?.listItem)
    )
      best = target
  }
  return best
}

export function moveBlock(editor: Editor, block: Block, target: number, intoList: boolean) {
  const { state } = editor
  const end = block.pos + block.node.nodeSize
  if (target >= block.pos && target <= end) return false
  const { from, to } = removalRange(state.doc, block)
  const tr = state.tr.delete(from, to)
  const at = tr.mapping.map(target)
  // A list item dropped between top-level blocks becomes a one-item list there.
  const node =
    block.listItem && !intoList
      ? state.schema.nodes.mixedList.create(state.doc.resolve(block.pos).parent.attrs, block.node)
      : block.node
  tr.insert(at, node)
  tr.setSelection(TextSelection.near(tr.doc.resolve(at + 1)))
  editor.view.dispatch(tr.scrollIntoView())
  editor.view.focus()
  return true
}

/** Inserts a new block after this one and gives it the chosen type. */
export function insertBlockBelow(editor: Editor, block: Block, id: string) {
  const { state } = editor
  if (block.listItem && listKinds.includes(id as (typeof listKinds)[number])) {
    const at = block.pos + block.node.nodeSize
    const item = state.schema.nodes.mixedListItem.create(
      { ...block.node.attrs, kind: id, checked: false },
      state.schema.nodes.paragraph.create(),
    )
    const tr = state.tr.insert(at, item)
    editor.view.dispatch(tr.setSelection(TextSelection.create(tr.doc, at + 2)).scrollIntoView())
    editor.view.focus()
    return true
  }
  // Anything else goes after the top-level block that holds this one.
  const $pos = state.doc.resolve(block.pos)
  const at = $pos.depth ? $pos.after(1) : block.pos + block.node.nodeSize
  const tr = state.tr.insert(at, state.schema.nodes.paragraph.create())
  editor.view.dispatch(tr.setSelection(TextSelection.create(tr.doc, at + 1)).scrollIntoView())
  editor.view.focus()
  return id === 'paragraph' || runCommand(editor, id)
}
