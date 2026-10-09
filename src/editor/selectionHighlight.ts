import { Extension } from '@tiptap/core'
import { AllSelection, Plugin, Selection, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

function paintsInlineSelection(selection: Selection) {
  return (
    !selection.empty && (selection instanceof TextSelection || selection instanceof AllSelection)
  )
}

export const SelectionHighlight = Extension.create({
  name: 'selectionHighlight',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        view(view) {
          const document = view.dom.ownerDocument
          const clearOrphanedSelection = () => {
            // ProseMirror ignores a missing DOM range. Do not leave its old
            // selection decorations painted after the browser clears that range.
            // Blurred toolbar inputs still need the saved formatting target.
            if (
              view.hasFocus() &&
              document.hasFocus() &&
              !view.composing &&
              paintsInlineSelection(view.state.selection) &&
              document.getSelection()?.rangeCount === 0
            ) {
              view.dispatch(view.state.tr.setSelection(Selection.near(view.state.selection.$head)))
            }
          }
          document.addEventListener('selectionchange', clearOrphanedSelection)
          return {
            destroy() {
              document.removeEventListener('selectionchange', clearOrphanedSelection)
            },
          }
        },
        props: {
          handleKeyDown(view, event) {
            if (
              event.key !== 'Escape' ||
              event.defaultPrevented ||
              event.isComposing ||
              view.composing ||
              event.metaKey ||
              event.ctrlKey ||
              event.altKey ||
              event.shiftKey ||
              !paintsInlineSelection(view.state.selection)
            )
              return false
            view.dispatch(view.state.tr.setSelection(Selection.near(view.state.selection.$head)))
            return true
          },
          attributes(state): Record<string, string> {
            return {
              'data-selection-layer': 'true',
              ...(paintsInlineSelection(state.selection)
                ? { 'data-selection-highlight': 'true' }
                : {}),
            }
          },
          decorations(state) {
            const { selection } = state
            if (!paintsInlineSelection(selection)) return null
            return DecorationSet.create(state.doc, [
              Decoration.inline(selection.from, selection.to, {
                class: 'selection-highlight',
              }),
            ])
          },
        },
      }),
    ]
  },
})
