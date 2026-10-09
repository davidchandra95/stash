import type { Editor } from '@tiptap/core'

type Lifetime = { view: () => () => void; operation: () => () => void }
const lifetimes = new WeakMap<Editor, Lifetime>()
const noop = () => {}

export function registerEditorLifetime(editor: Editor, lifetime: Lifetime) {
  lifetimes.set(editor, lifetime)
  return () => lifetimes.delete(editor)
}

/** A mounted consumer keeps the view available, including hidden PDF companions. */
export function retainEditorView(editor: Editor) {
  return lifetimes.get(editor)?.view() ?? noop
}

/** Pending work keeps its originating editor alive until it finishes or is disposed. */
export function retainEditorOperation(editor: Editor) {
  return lifetimes.get(editor)?.operation() ?? noop
}
