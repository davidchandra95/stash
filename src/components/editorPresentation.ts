import { CommandManager, type Editor } from '@tiptap/core'
import { commands } from '../editor/commands'
import { toolActive, toolbarTools } from './writingToolbar'

export type EditorPresentation = Record<string, string | number | boolean | null | undefined>
export function samePresentation(a: EditorPresentation, b: EditorPresentation | null) {
  return (
    !!b &&
    Object.keys(a).length === Object.keys(b).length &&
    Object.keys(a).every((key) => a[key] === b[key])
  )
}
export function canRunWritingCommand(editor: Editor, id: string) {
  if (editor.isDestroyed) return false
  const command = commands.find((command) => command.id === id)
  if (!command) return false
  if (!['bullet', 'number', 'task'].includes(id)) return command.run(editor.can().chain()).run()
  // List commands inspect earlier steps. Use an isolated transaction, without dispatch.
  return command.run(new CommandManager({ editor }).createChain(editor.state.tr)).run()
}
export function contextPresentation(editor: Editor): EditorPresentation {
  if (editor.isDestroyed) return {}
  return {
    table: editor.isActive('table'),
    code: editor.isActive('codeBlock'),
    language: editor.getAttributes('codeBlock').language || 'plaintext',
  }
}
export function toolbarPresentation(editor: Editor, capabilities = true): EditorPresentation {
  if (editor.isDestroyed) return {}
  const value: EditorPresentation = {
    editable: editor.isEditable,
    heading: editor.isActive('heading') ? editor.getAttributes('heading').level : 0,
    alignment:
      editor.getAttributes('paragraph').textAlign ??
      editor.getAttributes('heading').textAlign ??
      'left',
    ink: editor.getAttributes('textStyle').color,
    highlight: editor.getAttributes('highlight').color,
    sectionHeaderColor: editor.getAttributes('collapsibleHeader').backgroundColor,
    sectionColor: editor.getAttributes('collapsibleBody').backgroundColor,
    quoteColor: editor.getAttributes('blockquote').backgroundColor,
    cellColor:
      editor.getAttributes('tableCell').backgroundColor ??
      editor.getAttributes('tableHeader').backgroundColor,
    table: editor.isActive('table'),
    sectionHeader: editor.isActive('collapsibleHeader'),
    sectionBody: editor.isActive('collapsibleBody'),
    image: editor.isActive('image'),
  }
  for (const tool of toolbarTools) {
    value[`active:${tool.id}`] = toolActive(editor, tool)
    if (capabilities && !tool.picker)
      value[`enabled:${tool.id}`] = canRunWritingCommand(editor, tool.id)
  }
  return value
}

export function portablePresentation(editor: Editor) {
  if (editor.isDestroyed) return {}
  return {
    ...toolbarPresentation(editor, false),
    undo: editor.can().undo(),
    redo: editor.can().redo(),
  }
}
