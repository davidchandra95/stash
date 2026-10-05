import type { Editor, ChainedCommands } from '@tiptap/core'
import type { NativeMenuAction } from '../nativeContextMenu'
import { commands } from '../editor/commands'
import { inkColors, highlightColors } from '../editor/slashOptions'
import { PanelsTopLeft, Palette, X } from '../icons'
import { alignmentIcons, sameColor, type WritingPicker } from './writingToolbar'

/** Only action lists use NSMenu. Pickers with input fields remain popovers. */
export function writingMenuActions(
  picker: WritingPicker,
  editor: Editor,
  apply: (action: (chain: ChainedCommands) => ChainedCommands) => boolean,
  canRun: (id: string) => boolean,
): NativeMenuAction[] | null {
  const palette = (
    label: string,
    current: string | null | undefined,
    colors: typeof inkColors | typeof highlightColors,
    action: (color: string | null) => void,
  ): NativeMenuAction[] => [
    ...colors
      .filter(([, color]) => color)
      .map(([name, color]) => ({
        label: name,
        icon: Palette,
        color: color!,
        checked: sameColor(current, color!),
        run: () => action(color),
      })),
    { label: `Remove ${label.toLowerCase()}`, icon: X, separator: true, run: () => action(null) },
  ]
  const background = (label: string, node: string): NativeMenuAction[] => [
    { label, icon: Palette, disabled: true, separator: true, run: () => {} },
    ...palette(label, editor.getAttributes(node).backgroundColor, highlightColors, (color) =>
      apply((chain) => chain.updateAttributes(node, { backgroundColor: color })),
    ),
  ]
  switch (picker) {
    case 'color':
      return palette('Text color', editor.getAttributes('textStyle').color, inkColors, (color) =>
        apply((chain) => (color ? chain.setColor(color) : chain.unsetColor())),
      )
    case 'highlight':
      return palette(
        'Highlight',
        editor.getAttributes('highlight').color,
        highlightColors,
        (color) =>
          apply((chain) => (color ? chain.setHighlight({ color }) : chain.unsetHighlight())),
      )
    case 'alignment':
      return Object.entries(alignmentIcons).map(([align, icon]) => ({
        label: align[0].toUpperCase() + align.slice(1),
        icon,
        shortcutId: `align-${align}`,
        checked:
          (editor.getAttributes('paragraph').textAlign ??
            editor.getAttributes('heading').textAlign ??
            'left') === align,
        run: () => {
          apply((chain) => chain.setTextAlign(align))
        },
      }))
    case 'sections':
      return [
        ...['collapsible', 'wrap', 'unwrap', 'toggle-section', 'expand-all', 'collapse-all'].map(
          (id) => {
            const command = commands.find((item) => item.id === id)!
            return {
              label: command.label,
              icon: PanelsTopLeft,
              shortcutId: id,
              disabled: !canRun(id),
              run: () => {
                apply(command.run)
              },
            }
          },
        ),
        ...(editor.isActive('collapsibleHeader')
          ? background('Header background', 'collapsibleHeader')
          : []),
        ...(editor.isActive('collapsibleBody')
          ? background('Body background', 'collapsibleBody')
          : []),
      ]
    case 'quote':
      return palette(
        'Quote background',
        editor.getAttributes('blockquote').backgroundColor,
        highlightColors,
        (color) =>
          apply((chain) => chain.updateAttributes('blockquote', { backgroundColor: color })),
      )
    default:
      return null
  }
}
