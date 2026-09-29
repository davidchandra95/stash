import { platform } from '../platform'
import { Extension, type Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { tagMatches } from '../tags'

export interface BodyTagContext {
  open: (tag: string) => void
}

const contexts = new WeakMap<Editor, BodyTagContext>()
export const bodyTagsKey = new PluginKey('bodyTags')

export function setBodyTagContext(editor: Editor, context: BodyTagContext) {
  contexts.set(editor, context)
}

function decorations(doc: import('@tiptap/pm/model').Node) {
  const result: Decoration[] = []
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return
    const previous = doc.textBetween(Math.max(0, pos - 1), pos, '', '')
    const prefix = previous.slice(-1)
    for (const match of tagMatches(`${prefix}${node.text}`)) {
      if (match.to <= prefix.length) continue
      const from = pos + Math.max(0, match.from - prefix.length)
      const to = pos + match.to - prefix.length
      result.push(
        Decoration.inline(from, to, {
          class: 'body-tag',
          'data-body-tag': match.tag,
          role: 'link',
          tabindex: '0',
          'aria-label': `Open tag #${match.tag}`,
          title: platform.mobile ? `Open #${match.tag}` : `Open #${match.tag} with Command-click`,
        }),
      )
    }
  })
  return DecorationSet.create(doc, result)
}

export const BodyTags = Extension.create({
  name: 'bodyTags',
  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin({
        key: bodyTagsKey,
        state: {
          init: (_, state) => decorations(state.doc),
          apply: (transaction, previous) =>
            transaction.docChanged
              ? decorations(transaction.doc)
              : previous.map(transaction.mapping, transaction.doc),
        },
        props: {
          decorations: (state) => bodyTagsKey.getState(state),
        },
        view(view) {
          let hoveredTag: Element | null = null
          let commandDown = false
          const setHoveredTag = (element: Element | null) => {
            if (hoveredTag !== element) hoveredTag?.classList.remove('body-tag-command-hover')
            hoveredTag = element
            hoveredTag?.classList.toggle('body-tag-command-hover', commandDown)
          }
          const pointerover = (event: PointerEvent) => {
            const target = event.target
            setHoveredTag(target instanceof Element ? target.closest('[data-body-tag]') : null)
            commandDown = event.metaKey
            hoveredTag?.classList.toggle('body-tag-command-hover', commandDown)
          }
          const pointerout = (event: PointerEvent) => {
            const next = event.relatedTarget
            setHoveredTag(next instanceof Element && view.dom.contains(next)
              ? next.closest('[data-body-tag]')
              : null)
          }
          const modifier = (event: KeyboardEvent) => {
            commandDown = event.metaKey
            hoveredTag?.classList.toggle('body-tag-command-hover', commandDown)
          }
          const blur = () => {
            commandDown = false
            setHoveredTag(null)
          }
          const open = (element: Element | null) => {
            const tag = element?.getAttribute('data-body-tag')
            if (tag) contexts.get(editor)?.open(tag)
          }
          const click = (event: MouseEvent) => {
            const element = (event.target as Element).closest?.('[data-body-tag]')
            if (!element || !(event.metaKey || event.ctrlKey || (platform.mobile && !editor.isFocused))) return
            event.preventDefault()
            event.stopPropagation()
            open(element)
          }
          const keydown = (event: KeyboardEvent) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            const element = (event.target as Element).closest?.('[data-body-tag]')
            if (!element) return
            event.preventDefault()
            event.stopPropagation()
            open(element)
          }
          // Capture these before ProseMirror treats Enter as a paragraph action.
          view.dom.addEventListener('click', click, true)
          view.dom.addEventListener('keydown', keydown, true)
          if (!platform.mobile) {
            view.dom.addEventListener('pointerover', pointerover)
            view.dom.addEventListener('pointerout', pointerout)
            document.addEventListener('keydown', modifier)
            document.addEventListener('keyup', modifier)
            window.addEventListener('blur', blur)
          }
          return {
            destroy() {
              blur()
              view.dom.removeEventListener('click', click, true)
              view.dom.removeEventListener('keydown', keydown, true)
              view.dom.removeEventListener('pointerover', pointerover)
              view.dom.removeEventListener('pointerout', pointerout)
              document.removeEventListener('keydown', modifier)
              document.removeEventListener('keyup', modifier)
              window.removeEventListener('blur', blur)
            },
          }
        },
      }),
    ]
  },
})
