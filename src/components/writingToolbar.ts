import type { Editor } from '@tiptap/core'
import {
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Bold,
  Code,
  Code2,
  Highlighter,
  ImagePlus,
  Italic,
  Link,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  PanelsTopLeft,
  PenLine,
  Quote,
  Redo2,
  SquareCheck,
  Strikethrough,
  Subscript,
  Superscript,
  Table2,
  Type,
  Underline,
  Undo2,
  type IconComponent,
} from '../icons'

export const alignmentIcons = {
  left: AlignLeft,
  center: AlignCenter,
  right: AlignRight,
  justify: AlignJustify,
}

export type WritingPicker =
  'color' | 'highlight' | 'alignment' | 'link' | 'table' | 'sections' | 'image' | 'quote' | 'error'
export interface ToolbarTool {
  id: string
  label: string
  icon: IconComponent
  picker?: WritingPicker
  mark?: string
  listKind?: string
}

export const toolbarTools: ToolbarTool[] = [
  { id: 'bold', label: 'Bold', icon: Bold, mark: 'bold' },
  { id: 'italic', label: 'Italic', icon: Italic, mark: 'italic' },
  { id: 'underline', label: 'Underline', icon: Underline, mark: 'underline' },
  { id: 'strike', label: 'Strikethrough', icon: Strikethrough, mark: 'strike' },
  { id: 'inline-code', label: 'Inline code', icon: Code, mark: 'code' },
  { id: 'subscript', label: 'Subscript', icon: Subscript, mark: 'subscript' },
  { id: 'superscript', label: 'Superscript', icon: Superscript, mark: 'superscript' },
  { id: 'format', label: 'Text color', icon: Type, picker: 'color' },
  {
    id: 'highlight',
    label: 'Highlight',
    icon: Highlighter,
    picker: 'highlight',
    mark: 'highlight',
  },
  { id: 'bullet', label: 'Bullet list', icon: List, listKind: 'bullet' },
  { id: 'number', label: 'Numbered list', icon: ListOrdered, listKind: 'number' },
  { id: 'task', label: 'Checklist', icon: ListTodo, listKind: 'task' },
  { id: 'checkbox', label: 'Inline checkbox', icon: SquareCheck },
  { id: 'alignment', label: 'Alignment', icon: AlignLeft, picker: 'alignment' },
  { id: 'quote', label: 'Quote', icon: Quote, mark: 'blockquote' },
  { id: 'code', label: 'Code block', icon: Code2, mark: 'codeBlock' },
  { id: 'divider', label: 'Divider', icon: Minus },
  { id: 'link', label: 'Insert or edit link', icon: Link, picker: 'link', mark: 'link' },
  { id: 'image', label: 'Insert image', icon: ImagePlus, picker: 'image', mark: 'image' },
  { id: 'drawing', label: 'Drawing', icon: PenLine },
  { id: 'table', label: 'Table', icon: Table2, picker: 'table', mark: 'table' },
  { id: 'sections', label: 'Sections', icon: PanelsTopLeft, picker: 'sections' },
  { id: 'undo', label: 'Undo', icon: Undo2 },
  { id: 'redo', label: 'Redo', icon: Redo2 },
]
export const toolbarPriority = [
  'format',
  'highlight',
  'bullet',
  'number',
  'task',
  'link',
  'alignment',
  'table',
  'inline-code',
  'strike',
  'quote',
  'code',
  'divider',
  'image',
  'drawing',
  'sections',
  'checkbox',
  'subscript',
  'superscript',
]

/** Core tools are never removed. Reserve overflow only when it is needed. */
export function fitToolbar(
  available: number,
  widths: Record<string, number>,
  gap: number,
  padding: number,
  contextualOverflow: boolean,
) {
  const hidden = new Set<string>()
  const total = () => {
    const ids = ['style', ...toolbarTools.map((tool) => tool.id)].filter((id) => !hidden.has(id))
    if (hidden.size || contextualOverflow) ids.push('overflow')
    return (
      padding +
      ids.reduce((sum, id) => sum + (widths[id] ?? 0), 0) +
      Math.max(0, ids.length - 1) * gap
    )
  }
  for (const id of [...toolbarPriority].reverse()) {
    if (total() <= available) break
    hidden.add(id)
  }
  return hidden
}

export function toolActive(editor: Editor, tool: ToolbarTool) {
  if (tool.listKind) return editor.isActive('mixedListItem', { kind: tool.listKind })
  if (tool.id === 'format') return !!editor.getAttributes('textStyle').color
  if (tool.id === 'sections') return editor.isActive('collapsible')
  return tool.mark ? editor.isActive(tool.mark) : false
}

/** Imported HTML serializes colors as rgb(), while our palette uses hex. */
export function sameColor(current: string | null | undefined, color: string) {
  if (!current) return false
  const style = document.createElement('span').style
  style.color = current
  const normalized = style.color
  style.color = color
  return !!normalized && normalized === style.color
}
