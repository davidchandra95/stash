import { checkboxGlyph } from './checkbox'
import { Node, InputRule, mergeAttributes } from '@tiptap/core'
import { Fragment, Slice, type Node as DocumentNode } from '@tiptap/pm/model'
import { Plugin, type EditorState, type Transaction } from '@tiptap/pm/state'
import { ReplaceAroundStep, canJoin } from '@tiptap/pm/transform'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
export type ListKind = 'bullet' | 'number' | 'task'
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mixedList: {
      setListKind: (kind: ListKind, start?: number) => ReturnType
      toggleListKind: (kind: ListKind) => ReturnType
    }
  }
}

function listTargets(state: EditorState) {
  const items = new Set<number>(),
    blocks: number[] = []
  const { from, to } = state.selection
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return
    const $pos = state.doc.resolve(pos + 1)
    for (let depth = $pos.depth; depth > 0; depth--) {
      if ($pos.node(depth).type.name === 'mixedListItem') {
        items.add($pos.before(depth))
        return false
      }
    }
    if (['paragraph', 'heading'].includes(node.type.name)) blocks.push(pos)
    return false
  })
  return { items: [...items], blocks }
}

const numberedItems = (list: DocumentNode, end = list.childCount) => {
  let count = 0
  for (let i = 0; i < end; i++) if (list.child(i).attrs.kind === 'number') count++
  return count
}

// Typed numbering applies to this item only. Split around it so existing
// numbered siblings retain the numbers they displayed before the conversion.
function seedNumberedItem(tr: Transaction, pos: number, start: number) {
  const $pos = tr.doc.resolve(pos),
    list = $pos.parent,
    item = tr.doc.nodeAt(pos)!,
    index = $pos.index()
  if (item.attrs.kind === 'number' && list.attrs.start + numberedItems(list, index) === start)
    return
  if (index < list.childCount - 1)
    tr.split(pos + item.nodeSize, 1, [
      {
        type: list.type,
        attrs: { ...list.attrs, start: list.attrs.start + numberedItems(list, index + 1) },
      },
    ])
  if (index > 0) tr.split(pos, 1, [{ type: list.type, attrs: { ...list.attrs, start } }])
  else tr.setNodeMarkup($pos.before($pos.depth), undefined, { ...list.attrs, start })
}

// Only join when the right-hand list's displayed numbering will stay the same.
function joinCompatibleLists(tr: Transaction) {
  const { $from } = tr.selection
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name !== 'mixedList') continue
    let pos = $from.before(depth)
    const before = tr.doc.resolve(pos).nodeBefore
    let list = tr.doc.nodeAt(pos)!
    const compatible = (left: DocumentNode, right: DocumentNode) =>
      left.type === right.type &&
      (!numberedItems(right) || right.attrs.start === left.attrs.start + numberedItems(left))
    if (before && compatible(before, list) && canJoin(tr.doc, pos)) {
      tr.join(pos)
      pos -= before.nodeSize
      list = tr.doc.nodeAt(pos)!
    }
    const after = tr.doc.nodeAt(pos + list.nodeSize)
    if (after && compatible(list, after) && canJoin(tr.doc, pos + list.nodeSize))
      tr.join(pos + list.nodeSize)
    break
  }
}

// Strip the selected item's wrappers, keeping the content in its current parent.
// A ReplaceAroundStep maps the selection through the preserved inner content.
function unwrapItem(tr: Transaction, pos: number) {
  const $pos = tr.doc.resolve(pos),
    list = $pos.parent,
    item = tr.doc.nodeAt(pos)!
  const index = $pos.index(),
    atStart = index === 0,
    atEnd = index === list.childCount - 1
  const after = list.type.create({
    ...list.attrs,
    start: list.attrs.start + numberedItems(list, index + 1),
  })
  const slice = (atStart ? Fragment.empty : Fragment.from(list.copy(Fragment.empty))).append(
    atEnd ? Fragment.empty : Fragment.from(after),
  )
  tr.step(
    new ReplaceAroundStep(
      pos - (atStart ? 1 : 0),
      pos + item.nodeSize + (atEnd ? 1 : 0),
      pos + 1,
      pos + item.nodeSize - 1,
      new Slice(slice, atStart ? 0 : 1, atEnd ? 0 : 1),
      atStart ? 0 : 1,
    ),
  )
}
export const MixedList = Node.create({
  name: 'mixedList',
  group: 'block list',
  content: 'mixedListItem+',
  addAttributes() {
    return {
      start: {
        default: 1,
        parseHTML: (e) => Number(e.getAttribute('start')) || 1,
        renderHTML: (a) => ({ start: a.start, style: `counter-reset: mixed ${a.start - 1}` }),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'ul' }, { tag: 'ol' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['ul', mergeAttributes(HTMLAttributes, { 'data-type': 'mixedList' }), 0]
  },
  addCommands() {
    return {
      setListKind:
        (kind, start) =>
        ({ tr, state, commands, dispatch }) => {
          const { items, blocks } = listTargets(state)
          if (!items.length && !blocks.length) return false
          if (!dispatch) return true
          const bookmark = tr.selection.getBookmark()
          const mappingStart = tr.mapping.maps.length
          const mapped = (pos: number) => tr.mapping.slice(mappingStart).map(pos)
          for (const [index, pos] of items.entries()) {
            if (kind === 'number' && start !== undefined)
              seedNumberedItem(tr, mapped(pos), start + index)
            const item = tr.doc.nodeAt(mapped(pos))!
            if (item.attrs.kind !== kind)
              tr.setNodeMarkup(mapped(pos), undefined, { ...item.attrs, kind, checked: false })
          }
          for (const pos of blocks.reverse()) {
            const current = mapped(pos),
              block = tr.doc.nodeAt(current)!
            commands.setTextSelection({ from: current + 1, to: current + block.nodeSize - 1 })
            // Refresh Tiptap's chainable state after moving the transaction selection.
            void state.tr
            if (block.type.name === 'heading') commands.setParagraph()
            void state.tr
            if (!commands.wrapInList('mixedList', { start: start ?? 1 })) return false
            tr.doc.nodesBetween(tr.selection.from, tr.selection.to, (node, position) => {
              if (node.type.name === 'mixedListItem')
                tr.setNodeMarkup(position, undefined, { ...node.attrs, kind, checked: false })
            })
            joinCompatibleLists(tr)
          }
          tr.setSelection(bookmark.map(tr.mapping.slice(mappingStart)).resolve(tr.doc))
          tr.scrollIntoView()
          return true
        },
      toggleListKind:
        (kind) =>
        ({ tr, state, commands, dispatch }) => {
          const { items, blocks } = listTargets(state)
          if (
            !items.length ||
            blocks.length ||
            items.some((pos) => state.doc.nodeAt(pos)!.attrs.kind !== kind)
          )
            return commands.setListKind(kind)
          if (!dispatch) return true
          const mappingStart = tr.mapping.maps.length
          for (const pos of items.sort((a, b) => b - a))
            unwrapItem(tr, tr.mapping.slice(mappingStart).map(pos))
          tr.scrollIntoView()
          return true
        },
    }
  },
  addInputRules() {
    return (
      [
        ['bullet', /^[-+*]\s$/],
        ['number', /^(\d+)[.)]\s$/],
        ['task', /^\[([ x]?)\]\s$/],
      ] as const
    ).map(
      ([kind, find]) =>
        new InputRule({
          find,
          handler: ({ chain, range, match }) => {
            chain()
              .deleteRange(range)
              .setListKind(kind, kind === 'number' ? Number(match[1]) : undefined)
              .updateAttributes('mixedListItem', { checked: match[1] === 'x' })
              .run()
          },
        }),
    )
  },
})
export const MixedListItem = Node.create({
  name: 'mixedListItem',
  content: 'paragraph block*',
  defining: true,
  addAttributes() {
    return {
      kind: {
        default: 'bullet',
        parseHTML: (e) =>
          e.dataset.kind ||
          (e.dataset.type === 'taskItem' || e.querySelector(':scope > input[type=checkbox]')
            ? 'task'
            : e.parentElement?.tagName === 'OL'
              ? 'number'
              : 'bullet'),
        renderHTML: (a) => ({ 'data-kind': a.kind }),
      },
      checked: {
        default: false,
        keepOnSplit: false,
        parseHTML: (e) =>
          e.dataset.checked === 'true' ||
          !!e.querySelector(':scope > input[checked], :scope > label > input[checked]'),
        renderHTML: (a) => ({ 'data-checked': String(a.checked) }),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'li' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['li', mergeAttributes(HTMLAttributes, { 'data-type': 'mixedListItem' }), 0]
  },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement('li'),
        marker = document.createElement('button'),
        contentDOM = document.createElement('div')
      dom.dataset.type = 'mixedListItem'
      marker.className = 'list-marker'
      marker.contentEditable = 'false'
      marker.type = 'button'
      marker.append(checkboxGlyph())
      dom.append(marker, contentDOM)
      const update = (current: typeof node) => {
        if (current.type.name !== 'mixedListItem') return false
        node = current
        dom.dataset.kind = node.attrs.kind
        dom.dataset.checked = String(node.attrs.checked)
        marker.dataset.checked = String(node.attrs.checked)
        marker.setAttribute('role', node.attrs.kind === 'task' ? 'checkbox' : 'presentation')
        marker.disabled = node.attrs.kind !== 'task'
        marker.setAttribute(
          'aria-label',
          node.attrs.kind === 'task' ? 'Toggle checklist item' : `${node.attrs.kind} list marker`,
        )
        marker.setAttribute('aria-hidden', String(node.attrs.kind !== 'task'))
        marker.tabIndex = node.attrs.kind === 'task' ? 0 : -1
        marker.setAttribute('aria-checked', String(node.attrs.checked))
        return true
      }
      marker.onmousedown = (e) => e.preventDefault()
      marker.onclick = () => {
        const pos = getPos()
        if (editor.isEditable && typeof pos === 'number')
          editor.view.dispatch(
            editor.state.tr.setNodeMarkup(pos, undefined, {
              ...node.attrs,
              checked: !node.attrs.checked,
            }),
          )
      }
      update(node)
      return { dom, contentDOM, update }
    }
  },
  addProseMirrorPlugins() {
    const decorations = (doc: DocumentNode) => {
      const markers: Decoration[] = []
      doc.descendants((node, pos) => {
        if (node.type.name !== this.name || node.attrs.kind !== 'bullet') return
        const $pos = doc.resolve(pos)
        let depth = 0
        for (let d = 1; d <= $pos.depth; d++) if ($pos.node(d).type.name === 'mixedList') depth++
        markers.push(
          Decoration.node(pos, pos + node.nodeSize, {
            'data-bullet-shape': ['disc', 'circle', 'square'][(depth - 1) % 3],
          }),
        )
      })
      return DecorationSet.create(doc, markers)
    }
    return [
      new Plugin<DecorationSet>({
        state: {
          init: (_, state) => decorations(state.doc),
          apply: (tr, previous) => (tr.docChanged ? decorations(tr.doc) : previous),
        },
        props: {
          decorations: function (state) {
            return this.getState(state)
          },
        },
      }),
    ]
  },
  addKeyboardShortcuts() {
    return {
      Enter: () => this.editor.commands.splitListItem(this.name),
      Tab: () => this.editor.commands.sinkListItem(this.name),
      'Shift-Tab': () => this.editor.commands.liftListItem(this.name),
    }
  },
})
