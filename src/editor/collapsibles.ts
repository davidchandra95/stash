import { animate, motion } from '../motion'
import { clearReveals, revealKey } from './noteTools'
import type { Decoration } from '@tiptap/pm/view'
import { Node, mergeAttributes } from '@tiptap/core'
import { Fragment } from '@tiptap/pm/model'
import { Plugin, TextSelection } from '@tiptap/pm/state'
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    collapsible: {
      insertCollapsible: () => ReturnType
      wrapCollapsible: () => ReturnType
      unwrapCollapsible: () => ReturnType
      toggleCollapsible: () => ReturnType
      setAllCollapsible: (collapsed: boolean) => ReturnType
    }
  }
}
export const CollapsibleHeader = Node.create({
  name: 'collapsibleHeader',
  content: 'block+',
  defining: true,
  isolating: true,
  addAttributes() {
    return {
      backgroundColor: {
        default: null,
        parseHTML: (e) => e.style.backgroundColor || null,
        renderHTML: (a) =>
          a.backgroundColor ? { style: `background-color: ${a.backgroundColor}` } : {},
      },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-type="collapsibleHeader"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'collapsibleHeader' }), 0]
  },
})
export const CollapsibleBody = Node.create({
  name: 'collapsibleBody',
  content: 'block+',
  defining: true,
  isolating: true,
  addAttributes() {
    return {
      backgroundColor: {
        default: null,
        parseHTML: (e) => e.style.backgroundColor || null,
        renderHTML: (a) =>
          a.backgroundColor ? { style: `background-color: ${a.backgroundColor}` } : {},
      },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-type="collapsibleBody"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'collapsibleBody' }), 0]
  },
})
export const Collapsible = Node.create({
  name: 'collapsible',
  group: 'block',
  content: 'collapsibleHeader collapsibleBody',
  defining: true,
  isolating: true,
  addAttributes() {
    return {
      collapsed: {
        default: false,
        parseHTML: (e) => e.dataset.collapsed === 'true',
        renderHTML: (a) => ({ 'data-collapsed': String(a.collapsed) }),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'section[data-type="collapsible"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['section', mergeAttributes(HTMLAttributes, { 'data-type': 'collapsible' }), 0]
  },
  addNodeView() {
    return ({ node, editor, getPos, decorations }) => {
      const dom = document.createElement('section'),
        button = document.createElement('button'),
        contentDOM = document.createElement('div')
      dom.dataset.type = 'collapsible'
      button.className = 'collapse-toggle'
      button.type = 'button'
      button.contentEditable = 'false'
      dom.append(button, contentDOM)
      let bodyAnimation: Animation | undefined
      let generation = 0
      let lastCollapsed: boolean | undefined
      const update = (next: typeof node, decorations: readonly Decoration[] = []) => {
        if (next.type.name !== 'collapsible') return false
        const body = contentDOM.querySelector<HTMLElement>(':scope > [data-type="collapsibleBody"]')
        const height = body?.getBoundingClientRect().height ?? 0
        const opacity = body && height ? getComputedStyle(body).opacity : '0'
        node = next
        dom.dataset.collapsed = String(node.attrs.collapsed)
        const collapsed =
          node.attrs.collapsed &&
          !decorations.some((decoration) => decoration.spec.navigationReveal)
        button.textContent = '▸'
        button.setAttribute('aria-label', collapsed ? 'Expand section' : 'Collapse section')
        button.setAttribute('aria-expanded', String(!collapsed))
        if (body) {
          body.inert = collapsed
          body.setAttribute('aria-hidden', String(collapsed))
          if (lastCollapsed !== undefined && lastCollapsed !== collapsed) {
            const version = ++generation
            bodyAnimation?.cancel()
            body.style.display = 'block'
            const fullHeight = body.scrollHeight
            body.style.overflow = 'clip'
            bodyAnimation = animate(
              body,
              [
                {
                  height: `${height}px`,
                  minHeight: '0px',
                  opacity,
                  ...(height === 0 ? { paddingTop: '0px', paddingBottom: '0px' } : {}),
                },
                {
                  height: `${collapsed ? 0 : fullHeight}px`,
                  minHeight: '0px',
                  opacity: collapsed ? 0 : 1,
                  ...(collapsed ? { paddingTop: '0px', paddingBottom: '0px' } : {}),
                },
              ],
              motion.collapse,
              () => {
                if (version !== generation) return
                body.style.removeProperty('display')
                body.style.removeProperty('overflow')
              },
            )
          }
        }
        lastCollapsed = collapsed
        return true
      }
      button.onmousedown = (e) => e.preventDefault()
      button.onclick = () => {
        const pos = getPos()
        if (dom.classList.contains('navigation-revealed') && typeof pos === 'number') {
          clearReveals(editor, pos)
          return
        }
        if (typeof pos === 'number')
          editor.view.dispatch(
            editor.state.tr.setNodeMarkup(pos, undefined, {
              ...node.attrs,
              collapsed: !node.attrs.collapsed,
            }),
          )
      }
      update(node, decorations)
      return {
        dom,
        contentDOM,
        update,
        destroy() {
          ++generation
          bodyAnimation?.cancel()
        },
      }
    }
  },
  addCommands() {
    return {
      insertCollapsible:
        () =>
        ({ chain, state }) => {
          const pos = state.selection.from
          return chain()
            .insertContent({
              type: 'collapsible',
              content: [
                {
                  type: 'collapsibleHeader',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Section' }] }],
                },
                { type: 'collapsibleBody', content: [{ type: 'paragraph' }] },
              ],
            })
            .command(({ tr }) => {
              let found = -1
              tr.doc.nodesBetween(Math.max(0, pos - 1), tr.doc.content.size, (node, p) => {
                if (found < 0 && node.type.name === 'collapsible') {
                  found = p
                  return false
                }
              })
              if (found >= 0) tr.setSelection(TextSelection.create(tr.doc, found + 3, found + 10))
              return true
            })
            .run()
        },
      wrapCollapsible:
        () =>
        ({ state, tr, dispatch }) => {
          const range = state.selection.$from.blockRange(state.selection.$to)
          if (!range) return false
          const selected = tr.doc.slice(range.start, range.end).content
          const header = state.schema.nodes.collapsibleHeader.create(
            null,
            state.schema.nodes.paragraph.create(null, state.schema.text('Section')),
          )
          const body = state.schema.nodes.collapsibleBody.create(null, selected)
          if (!body.type.validContent(selected)) return false
          const wrapper = state.schema.nodes.collapsible.create(null, [header, body])
          if (!range.parent.canReplace(range.startIndex, range.endIndex, Fragment.from(wrapper)))
            return false
          if (dispatch)
            tr.replaceWith(range.start, range.end, wrapper).setSelection(
              TextSelection.create(tr.doc, range.start + 3, range.start + 10),
            )
          return true
        },
      unwrapCollapsible:
        () =>
        ({ state, tr, dispatch }) => {
          const { $from } = state.selection
          for (let d = $from.depth; d > 0; d--) {
            const node = $from.node(d)
            if (node.type.name === 'collapsible') {
              if (dispatch) {
                const pos = $from.before(d)
                tr.replaceWith(
                  pos,
                  $from.after(d),
                  node.child(0).content.append(node.child(1).content),
                )
                tr.setSelection(TextSelection.near(tr.doc.resolve(pos)))
              }
              return true
            }
          }
          return false
        },
      toggleCollapsible:
        () =>
        ({ state, tr, dispatch }) => {
          const { $from } = state.selection
          for (let d = $from.depth; d > 0; d--) {
            const node = $from.node(d)
            if (node.type.name === 'collapsible') {
              if (dispatch)
                tr.setNodeMarkup($from.before(d), undefined, {
                  ...node.attrs,
                  collapsed: !node.attrs.collapsed,
                })
              return true
            }
          }
          return false
        },
      setAllCollapsible:
        (collapsed) =>
        ({ tr, dispatch }) => {
          if (dispatch)
            tr.doc.descendants((node, pos) => {
              if (node.type.name === 'collapsible')
                tr.setNodeMarkup(pos, undefined, { ...node.attrs, collapsed })
            })
          return true
        },
    }
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction: (_transactions, _old, state) => {
          // A selection may never remain in a body hidden by its own or an outer toggle.
          const { $from } = state.selection
          for (let d = 1; d < $from.depth; d++)
            if (
              $from.node(d).type.name === 'collapsible' &&
              $from.node(d).attrs.collapsed &&
              !revealKey.getState(state)?.has($from.before(d)) &&
              $from.index(d) > 0
            )
              return state.tr
                .setSelection(TextSelection.near(state.doc.resolve($from.before(d) + 2)))
                .setMeta('addToHistory', false)
          return null
        },
      }),
    ]
  },
})
