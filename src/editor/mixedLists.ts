import { checkboxGlyph } from './checkbox'
import { Node, InputRule, mergeAttributes } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
export type ListKind = 'bullet' | 'number' | 'task'
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mixedList: { setListKind: (kind: ListKind) => ReturnType }
  }
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
        (kind) =>
        ({ chain, state }) => {
          const positions: number[] = []
          const nearest = (position: typeof state.selection.$from) => {
            for (let d = position.depth; d > 0; d--)
              if (position.node(d).type.name === 'mixedListItem') return position.before(d)
            return null
          }
          const fromItem = nearest(state.selection.$from),
            toItem = nearest(state.selection.$to)
          if (fromItem !== null && fromItem === toItem) positions.push(fromItem)
          else
            state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
              if (
                node.type.name === 'mixedListItem' &&
                pos + 1 + (node.firstChild?.nodeSize ?? 0) >= state.selection.from
              )
                positions.push(pos)
            })
          const inside = positions.length > 0
          if (inside)
            return chain()
              .command(({ tr }) => {
                positions.forEach((pos) =>
                  tr.setNodeMarkup(pos, undefined, {
                    ...tr.doc.nodeAt(pos)!.attrs,
                    kind,
                    checked: false,
                  }),
                )
                return true
              })
              .run()
          return chain()
            .toggleList('mixedList', 'mixedListItem')
            .updateAttributes('mixedListItem', { kind, checked: false })
            .run()
        },
    }
  },
  addInputRules() {
    return (
      [
        ['bullet', /^[-+*]\s$/],
        ['number', /^\d+[.)]\s$/],
        ['task', /^\[([ x]?)\]\s$/],
      ] as const
    ).map(
      ([kind, find]) =>
        new InputRule({
          find,
          handler: ({ chain, range, match }) => {
            chain()
              .deleteRange(range)
              .setListKind(kind)
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
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations(state) {
            if (state.selection.empty) return null
            const items = new Map<number, number>()
            for (const range of state.selection.ranges) {
              const from = range.$from.pos
              const to = range.$to.pos
              state.doc.nodesBetween(from, to, (node, pos) => {
                if (
                  !(node.isInline || (node.type.name === 'paragraph' && node.content.size === 0)) ||
                  pos >= to ||
                  pos + node.nodeSize <= from
                )
                  return
                const $pos = state.doc.resolve(pos)
                for (let depth = $pos.depth; depth > 0; depth--) {
                  const item = $pos.node(depth)
                  if (item.type.name !== 'mixedListItem') continue
                  if (item.attrs.kind !== 'task') items.set($pos.before(depth), item.nodeSize)
                  break
                }
              })
            }
            return DecorationSet.create(
              state.doc,
              [...items].map(([pos, size]) =>
                Decoration.node(pos, pos + size, { class: 'selection-has-text' }),
              ),
            )
          },
        },
      }),
    ]
  },
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
        if (typeof pos === 'number')
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
  addKeyboardShortcuts() {
    return {
      Enter: () => this.editor.commands.splitListItem(this.name),
      Tab: () => this.editor.commands.sinkListItem(this.name),
      'Shift-Tab': () => this.editor.commands.liftListItem(this.name),
    }
  },
})
