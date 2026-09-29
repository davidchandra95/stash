import { bindingFor, shortcutCommands } from '../shortcuts'
import { isMarkdownEditor, markdownCommandAllowed } from './markdownContext'
import { CommandManager } from '@tiptap/core'
import { slashExtraCommands } from './slashOptions'
import type { Editor, ChainedCommands } from '@tiptap/core'
export interface WritingCommand {
  id: string
  label: string
  slash?: boolean
  context?: string
  panel?: boolean
  keywords?: string
  shortcut?: string
  run: (chain: ChainedCommands) => ChainedCommands
}
const writingCommands: WritingCommand[] = [
  ...slashExtraCommands,
  { id: 'undo', label: 'Undo', slash: false, shortcut: 'Mod-z', run: (c) => c.undo() },
  { id: 'redo', label: 'Redo', slash: false, shortcut: 'Mod-Shift-z', run: (c) => c.redo() },
  { id: 'row-before', label: 'Row before', context: 'table', run: (c) => c.addRowBefore() },
  { id: 'row-after', label: 'Row after', context: 'table', run: (c) => c.addRowAfter() },
  {
    id: 'column-before',
    label: 'Column before',
    context: 'table',
    run: (c) => c.addColumnBefore(),
  },
  { id: 'column-after', label: 'Column after', context: 'table', run: (c) => c.addColumnAfter() },
  { id: 'remove-row', label: 'Remove row', context: 'table', run: (c) => c.deleteRow() },
  { id: 'remove-column', label: 'Remove column', context: 'table', run: (c) => c.deleteColumn() },
  { id: 'remove-table', label: 'Remove table', context: 'table', run: (c) => c.deleteTable() },
  { id: 'merge-cells', label: 'Merge cells', context: 'table', run: (c) => c.mergeCells() },
  { id: 'split-cell', label: 'Split cell', context: 'table', run: (c) => c.splitCell() },
  { id: 'header-row', label: 'Header row', context: 'table', run: (c) => c.toggleHeaderRow() },
  {
    id: 'header-column',
    label: 'Header column',
    context: 'table',
    run: (c) => c.toggleHeaderColumn(),
  },
  { id: 'header-cell', label: 'Header cell', context: 'table', run: (c) => c.toggleHeaderCell() },
  { id: 'paragraph', label: 'Paragraph', run: (c) => c.setParagraph() },
  ...([1, 2, 3, 4, 5, 6] as const).map((level) => ({
    id: `h${level}`,
    label: `Heading ${level}`,
    run: (c: ChainedCommands) => c.setHeading({ level }),
  })),
  { id: 'bullet', label: 'Bullet list', run: (c) => c.setListKind('bullet') },
  { id: 'number', label: 'Numbered list', run: (c) => c.setListKind('number') },
  { id: 'task', label: 'Checklist', run: (c) => c.setListKind('task') },
  { id: 'quote', label: 'Quote', run: (c) => c.toggleBlockquote() },
  {
    id: 'table',
    label: 'Table',
    run: (c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }),
  },
  { id: 'code', label: 'Code block', run: (c) => c.toggleCodeBlock() },
  { id: 'divider', label: 'Divider', run: (c) => c.setHorizontalRule() },
  { id: 'bold', label: 'Bold', run: (c) => c.toggleBold() },
  { id: 'italic', label: 'Italic', run: (c) => c.toggleItalic() },
  { id: 'underline', label: 'Underline', run: (c) => c.toggleUnderline() },
  { id: 'strike', label: 'Strikethrough', run: (c) => c.toggleStrike() },
  { id: 'highlight', label: 'Highlight', run: (c) => c.toggleHighlight() },
  { id: 'collapsible', label: 'Collapsible section', run: (c) => c.insertCollapsible() },
  { id: 'wrap', label: 'Wrap selection in section', run: (c) => c.wrapCollapsible() },
  { id: 'unwrap', label: 'Unwrap section', run: (c) => c.unwrapCollapsible() },
  {
    id: 'toggle-section',
    label: 'Toggle section',

    run: (c) => c.toggleCollapsible(),
  },
  {
    id: 'expand-all',
    label: 'Expand all sections',

    run: (c) => c.setAllCollapsible(false),
  },
  {
    id: 'collapse-all',
    label: 'Collapse all sections',

    run: (c) => c.setAllCollapsible(true),
  },
  { id: 'link', label: 'Insert or edit link', panel: true, run: (c) => c },
  { id: 'image', label: 'Insert image', panel: true, run: (c) => c },
  { id: 'format', label: 'Colors and formatting', panel: true, run: (c) => c },
  { id: 'inline-code', label: 'Inline code', run: (c) => c.toggleCode() },
  { id: 'subscript', label: 'Subscript', run: (c) => c.unsetSuperscript().toggleSubscript() },
  { id: 'superscript', label: 'Superscript', run: (c) => c.unsetSubscript().toggleSuperscript() },
  {
    id: 'checkbox',
    label: 'Inline checkbox',
    run: (c) => c.insertContent({ type: 'inlineCheckbox' }),
  },
  ...(['left', 'center', 'right', 'justify'] as const).map((align) => ({
    id: `align-${align}`,
    label: `Align ${align}`,
    shortcut: `Mod-Shift-${({ left: 'l', center: 'e', right: 'r', justify: 'j' } as const)[align]}`,
    run: (c: ChainedCommands) => c.setTextAlign(align),
  })),
  {
    id: 'date',
    label: 'Insert date',
    run: (c) => c.insertContent(new Date().toLocaleDateString()),
  },
  {
    id: 'time',
    label: 'Insert time',
    run: (c) =>
      c.insertContent(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })),
  },
]
export const commands: WritingCommand[] = writingCommands.map((command) => {
  if (!shortcutCommands.some((shortcut) => shortcut.id === command.id)) return command
  const binding = bindingFor(command.id)
  return { ...command, shortcut: binding?.replaceAll('+', '-') ?? undefined }
})
export function runCommand(editor: Editor, id: string, range?: { from: number; to: number }) {
  if (isMarkdownEditor(editor) && !markdownCommandAllowed(id)) return false
  const command = commands.find((c) => c.id === id)
  if (!command) return false
  if (command.panel) {
    editor.view.dom.dispatchEvent(new CustomEvent('writing-panel', { detail: { id, range } }))
    return true
  }
  // Build on a real isolated transaction. A can() chain skips transformations,
  // so later commands cannot inspect the document after slash text is removed.
  const tr = editor.state.tr
  let chain = new CommandManager({ editor }).createChain(tr)
  if (range) chain = chain.deleteRange(range)
  if (!command.run(chain).run()) return false
  editor.view.dispatch(tr)
  editor.commands.focus()
  return true
}
