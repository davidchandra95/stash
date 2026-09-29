import type { Editor } from '@tiptap/core'
import type { FileSource, Note } from '../model'
export interface MarkdownContext {
  id: string
  source: FileSource
  notes: () => Note[]
  open: (href: string, newTab: boolean) => void
  saveImage: (file: File) => Promise<string>
  readImage: (href: string) => Promise<string>
}
export const markdownContexts = new WeakMap<Editor, MarkdownContext>()
export const isMarkdownEditor = (editor: Editor) =>
  editor.extensionManager.extensions.some((e) => e.name === 'markdownSource')
export function markdownCommandAllowed(id: string) {
  return !/^(underline|highlight.*|ink-.*|cell-.*|format|subscript|superscript|align-.*|checkbox|collapsible|wrap|unwrap|toggle-section|expand-all|collapse-all|merge-cells|split-cell|header-column|header-cell|header-row)$/.test(
    id,
  )
}
