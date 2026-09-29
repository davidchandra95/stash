import StarterKit from '@tiptap/starter-kit'
import { Extension, type Editor } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { isTauri } from '@tauri-apps/api/core'
import {
  bindingFor,
  legacyEditorKeys,
  matchesBinding,
  shortcutCommands,
  type ShortcutOverrides,
} from '../shortcuts'
import { runCommand } from './commands'
export const editorShortcutOverrides = new WeakMap<Editor, ShortcutOverrides>()
export const KeyboardShortcuts = Extension.create({
  name: 'customKeyboardShortcuts',
  priority: 2000,
  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin({
        props: {
          handleKeyDown(_view, event) {
            const overrides = editorShortcutOverrides.get(editor) ?? {}
            const mac = isTauri()
            const command = shortcutCommands.find(
              (c) =>
                c.scope === 'editor' && matchesBinding(event, bindingFor(c.id, overrides), mac),
            )
            const oldBinding =
              shortcutCommands.some(
                (c) => c.scope === 'editor' && matchesBinding(event, c.defaultKey, mac),
              ) || legacyEditorKeys.some((key) => matchesBinding(event, key, mac))
            if (!command && !oldBinding) return false
            if (
              !event.repeat &&
              !event.isComposing &&
              !editor.view.composing &&
              editor.isEditable &&
              !document.querySelector('[role="dialog"]:not([inert])')
            ) {
              if (command) runCommand(editor, command.id)
            }
            return true
          },
        },
      }),
    ]
  },
})

// StarterKit owns additional aliases (for example Mod-Shift-B). Remove them
// at their source so clearing a command cannot leave an undocumented alias.
export const ShortcutStarterKit = StarterKit.extend({
  addExtensions() {
    const managed = new Set(['bold', 'italic', 'underline', 'strike', 'heading', 'paragraph'])
    return (this.parent?.() ?? []).map((extension) =>
      managed.has(extension.name)
        ? extension.extend({ addKeyboardShortcuts: () => ({}) })
        : extension,
    )
  },
})
