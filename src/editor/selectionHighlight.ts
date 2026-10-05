import { Extension } from '@tiptap/core'
import { AllSelection, Plugin, type Selection, TextSelection } from '@tiptap/pm/state'
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
        props: {
          attributes(state): Record<string, string> {
            return paintsInlineSelection(state.selection)
              ? { 'data-selection-highlight': 'true' }
              : {}
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
