import { shortcutCommands } from '../shortcuts'
import { Extension } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { commands, runCommand } from './commands'
export const Typing = Extension.create({
  name: 'writingTyping',
  priority: 1100,
  addKeyboardShortcuts() {
    const editor = this.editor
    const indentCode = (reverse: boolean) => {
      const { $from, $to, empty } = editor.state.selection
      if (!$from.parent.type.spec.code || !$from.sameParent($to)) return false
      if (!reverse && empty) return editor.commands.insertContent('\t')
      const text = $from.parent.textContent,
        base = $from.start()
      const start = text.lastIndexOf('\n', Math.max(0, $from.parentOffset - 1)) + 1
      const end = $to.parentOffset
      const offsets: number[] = [start]
      for (let i = start; i < end; i++) if (text[i] === '\n' && i + 1 < end) offsets.push(i + 1)
      const tr = editor.state.tr
      for (const offset of offsets.reverse()) {
        if (reverse) {
          const indentation = /^(\t| {1,4})/.exec(text.slice(offset))?.[0]
          if (indentation) tr.delete(base + offset, base + offset + indentation.length)
        } else tr.insertText('\t', base + offset)
      }
      editor.view.dispatch(tr.scrollIntoView())
      return true
    }
    const exit = () => {
      const { $from } = editor.state.selection
      for (let d = $from.depth; d > 0; d--) {
        if (['codeBlock', 'blockquote', 'collapsible'].includes($from.node(d).type.name)) {
          const pos = $from.after(d),
            tr = editor.state.tr.insert(pos, editor.schema.nodes.paragraph.create())
          editor.view.dispatch(
            tr.setSelection(TextSelection.create(tr.doc, pos + 1)).scrollIntoView(),
          )
          return true
        }
      }
      return false
    }
    return {
      ...Object.fromEntries(
        commands
          .filter((c) => c.shortcut && !shortcutCommands.some((command) => command.id === c.id))
          .map((c) => [c.shortcut!, () => runCommand(editor, c.id)]),
      ),
      'Mod-Enter': exit,
      'Shift-Enter': () =>
        editor.isActive('codeBlock')
          ? editor.commands.newlineInCode()
          : editor.commands.setHardBreak(),
      Enter: () => {
        if (editor.view.composing) return false
        if (editor.isActive('codeBlock')) return editor.commands.newlineInCode()
        const { $from, empty } = editor.state.selection
        if (!empty) return false
        for (let d = $from.depth - 1; d > 0; d--) {
          if ($from.node(d).type.name === 'collapsibleHeader') {
            const parentDepth = d - 1,
              section = $from.node(parentDepth)
            const bodyStart = $from.before(parentDepth) + 1 + section.child(0).nodeSize
            const tr = editor.state.tr.setNodeMarkup($from.before(parentDepth), undefined, {
              ...section.attrs,
              collapsed: false,
            })
            editor.view.dispatch(
              tr.setSelection(TextSelection.near(tr.doc.resolve(bodyStart + 1))).scrollIntoView(),
            )
            return true
          }
          if ($from.node(d).type.name === 'collapsibleBody') break
        }
        if (
          $from.parent.type.name === 'paragraph' &&
          !$from.parent.content.size &&
          $from.node($from.depth - 1).type.name === 'collapsibleBody' &&
          $from.index($from.depth - 1) === $from.node($from.depth - 1).childCount - 1
        ) {
          const sectionDepth = $from.depth - 2,
            pos = $from.after(sectionDepth)
          let tr = editor.state.tr
          if ($from.node($from.depth - 1).childCount > 1)
            tr = tr.delete($from.before(), $from.after())
          const mapped = tr.mapping.map(pos)
          tr.insert(mapped, editor.schema.nodes.paragraph.create()).setSelection(
            TextSelection.create(tr.doc, mapped + 1),
          )
          editor.view.dispatch(tr.scrollIntoView())
          return true
        }
        if (
          $from.parent.type.name === 'heading' &&
          $from.parentOffset === $from.parent.content.size
        ) {
          const pos = $from.after()
          return editor
            .chain()
            .insertContentAt(pos, { type: 'paragraph' })
            .setTextSelection(pos + 1)
            .run()
        }
        if ($from.parent.type.name === 'paragraph' && !$from.parent.content.size) {
          for (let d = $from.depth - 1; d > 0; d--) {
            if (
              d === $from.depth - 1 &&
              $from.node(d).type.name === 'blockquote' &&
              $from.index(d) === $from.node(d).childCount - 1
            )
              return editor.commands.lift('blockquote')
          }
        }
        return false
      },
      Tab: () => {
        if (editor.view.composing) return false
        if (editor.isActive('codeBlock')) return indentCode(false)
        if (editor.isActive('table'))
          return editor.commands.goToNextCell() || editor.chain().addRowAfter().goToNextCell().run()
        if (editor.isActive('mixedListItem'))
          return editor.commands.sinkListItem('mixedListItem') || true
        return editor.commands.insertContent('\t')
      },
      'Shift-Tab': () => {
        if (editor.view.composing) return false
        if (editor.isActive('codeBlock')) return indentCode(true)
        if (editor.isActive('table')) return editor.commands.goToPreviousCell() || true
        if (editor.isActive('mixedListItem')) return editor.commands.liftListItem('mixedListItem')
        const { $from } = editor.state.selection
        if ($from.parent.textBetween(0, $from.parentOffset).endsWith('\t'))
          return editor.commands.deleteRange({ from: $from.pos - 1, to: $from.pos })
        return true
      },
    }
  },
})
