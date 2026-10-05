import { Node, type Editor } from '@tiptap/core'
import { NodeSelection, Plugin } from '@tiptap/pm/state'
import { platform } from '../platform'
import { drawingLabel, drawingPreview, emptyDrawing, readDrawing } from './model'

export function findDrawing(editor: Editor, id: string) {
  let found: { pos: number; node: import('@tiptap/pm/model').Node } | undefined
  if (editor.isDestroyed || typeof id !== 'string' || !id) return found
  let count = 0
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'drawing' && node.attrs.id === id) {
      found = { pos, node }
      count++
    }
  })
  return count === 1 ? found : undefined
}
export function openDrawing(editor: Editor, id: string) {
  if (editor.isDestroyed || !findDrawing(editor, id)) return
  editor.view.dom.dispatchEvent(new CustomEvent('drawing-open', { detail: id }))
}
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    drawing: { insertDrawing: () => ReturnType }
  }
}
export const Drawing = Node.create({
  name: 'drawing',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes: () => ({
    id: { default: null, rendered: false },
    data: { default: null, rendered: false },
  }),
  // Editable content travels in a private clipboard format, never in external HTML.
  parseHTML: () => [],
  renderHTML({ node }) {
    const data = readDrawing(node.attrs.data),
      preview = drawingPreview(data)
    return preview
      ? ['div', { 'data-stash-drawing-preview': '' }, ['img', { src: preview, alt: 'Drawing' }]]
      : ['div', {}, drawingLabel(data)]
  },
  renderText: () => '[Drawing]',
  addCommands() {
    return {
      insertDrawing:
        () =>
        ({ editor, commands, tr, dispatch }) => {
          if (platform.mobile || !editor.isEditable) return false
          const id = crypto.randomUUID()
          if (!commands.insertContent({ type: 'drawing', attrs: { id, data: emptyDrawing() } }))
            return false
          if (dispatch) tr.setMeta('openDrawing', id)
          return true
        },
    }
  },
  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin({
        view: () => ({
          update: (view) => view.dom.dispatchEvent(new Event('drawing-controls-update')),
        }),
        state: {
          init: () => null,
          apply: (tr) => {
            const id = tr.getMeta('openDrawing')
            if (id) queueMicrotask(() => openDrawing(editor, id))
            return null
          },
        },
        props: {
          handleKeyDown: (_view, event) => {
            const selection = editor.state.selection
            if (
              event.key !== 'Enter' ||
              !(selection instanceof NodeSelection) ||
              selection.node.type.name !== 'drawing'
            )
              return false
            openDrawing(editor, selection.node.attrs.id)
            return true
          },
        },
      }),
    ]
  },
  addNodeView() {
    return ({ node, editor, view, getPos }) => {
      const dom = document.createElement('div')
      dom.className = 'drawing-block'
      dom.contentEditable = 'false'
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'drawing-preview'
      button.setAttribute('aria-label', 'Open drawing')
      const actions = document.createElement('div')
      actions.className = 'drawing-actions'
      const edit = document.createElement('button')
      edit.type = 'button'
      edit.className = 'drawing-edit'
      edit.textContent = 'Edit'
      edit.setAttribute('aria-label', 'Edit drawing')
      actions.append(edit)
      dom.append(actions, button)
      const canEdit = () => !platform.mobile && editor.isEditable
      const syncControls = () => {
        actions.hidden = !canEdit()
        button.setAttribute('aria-label', canEdit() ? 'Select drawing' : 'Open drawing')
      }
      view.dom.addEventListener('drawing-controls-update', syncControls)
      const update = (next: typeof node) => {
        if (next.type.name !== 'drawing') return false
        node = next
        dom.dataset.drawingId = String(node.attrs.id)
        const data = readDrawing(node.attrs.data),
          preview = drawingPreview(data)
        button.replaceChildren()
        if (preview) {
          const img = document.createElement('img')
          img.src = preview
          img.alt = 'Drawing'
          img.draggable = false
          button.append(img)
        } else button.textContent = drawingLabel(data)
        syncControls()
        return true
      }
      button.onmousedown = (event) => event.preventDefault()
      button.onclick = () => {
        const pos = getPos()
        if (typeof pos !== 'number') return
        editor.commands.setNodeSelection(pos)
        if (canEdit()) editor.commands.focus()
        else openDrawing(editor, node.attrs.id)
      }
      edit.onclick = () => {
        if (!canEdit()) return
        const pos = getPos()
        if (typeof pos !== 'number') return
        editor.commands.setNodeSelection(pos)
        openDrawing(editor, node.attrs.id)
      }
      update(node)
      return {
        dom,
        update,
        stopEvent: (event) =>
          (event.target === edit && event.type === 'keydown') ||
          !['copy', 'cut', 'paste', 'keydown'].includes(event.type),
        destroy: () => view.dom.removeEventListener('drawing-controls-update', syncControls),
        ignoreMutation: () => true,
        selectNode: () => dom.classList.add('ProseMirror-selectednode'),
        deselectNode: () => dom.classList.remove('ProseMirror-selectednode'),
      }
    }
  },
})
