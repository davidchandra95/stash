import { checkboxGlyph } from './checkbox'
import { Color } from '@tiptap/extension-text-style'
import { Extension, Node, mergeAttributes } from '@tiptap/core'
import Image from '@tiptap/extension-image'
export const InlineCheckbox = Node.create({
  name: 'inlineCheckbox',
  inline: true,
  group: 'inline',
  atom: true,
  addAttributes() {
    return {
      checked: {
        default: false,
        parseHTML: (e) => e.getAttribute('data-checked') === 'true',
        renderHTML: (a) => ({ 'data-checked': String(a.checked) }),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-type="inlineCheckbox"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-type': 'inlineCheckbox' }),
      HTMLAttributes['data-checked'] === 'true' ? '☑' : '☐',
    ]
  },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement('button')
      dom.type = 'button'
      dom.className = 'inline-checkbox'
      dom.contentEditable = 'false'
      dom.append(checkboxGlyph())
      dom.setAttribute('role', 'checkbox')
      dom.setAttribute('aria-label', 'Inline checkbox')
      const update = (next: typeof node) => {
        if (next.type.name !== 'inlineCheckbox') return false
        node = next
        dom.dataset.checked = String(node.attrs.checked)
        dom.setAttribute('aria-checked', String(node.attrs.checked))
        return true
      }
      dom.onmousedown = (e) => e.preventDefault()
      dom.onclick = () => {
        const pos = getPos()
        if (typeof pos === 'number')
          editor.view.dispatch(
            editor.state.tr.setNodeMarkup(pos, undefined, { checked: !node.attrs.checked }),
          )
      }
      update(node)
      return { dom, update }
    }
  },
})
export const ContainerColors = Extension.create({
  name: 'containerColors',
  addGlobalAttributes() {
    return [
      {
        types: ['blockquote', 'tableCell', 'tableHeader'],
        attributes: {
          backgroundColor: {
            default: null,
            parseHTML: (e) => e.style.backgroundColor || null,
            renderHTML: (a) =>
              a.backgroundColor ? { style: `background-color: ${a.backgroundColor}` } : {},
          },
        },
      },
    ]
  },
})
export const SessionImage = Image.configure({
  inline: true,
  allowBase64: true,
  resize: { enabled: true, minWidth: 32, minHeight: 24, alwaysPreserveAspectRatio: true },
})

// Keep the chosen color in the document; adapt its screen presentation in dark mode.
export const ReadableColor = Color.extend({
  addGlobalAttributes() {
    return [
      {
        types: ['textStyle'],
        attributes: {
          color: {
            default: null,
            parseHTML: (e) => e.style.getPropertyValue('--ink') || e.style.color || null,
            renderHTML: (a) => (a.color ? { style: `color: ${a.color}; --ink: ${a.color}` } : {}),
          },
        },
      },
    ]
  },
})
