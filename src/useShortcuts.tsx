import { createContext, useContext, useLayoutEffect, useRef } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import {
  bindingFor,
  matchesBinding,
  shortcutCommands,
  shortcutLabel,
  type ShortcutOverrides,
} from './shortcuts'
export const ShortcutContext = createContext<ShortcutOverrides>({})
export function useShortcutLabel() {
  const overrides = useContext(ShortcutContext)
  return (id: string) => shortcutLabel(bindingFor(id, overrides), isTauri())
}
export const DocumentShortcutContext = createContext<'note' | 'pdf' | undefined>(undefined)
let focusedDocument: 'note' | 'pdf' = 'note'
export const focusDocument = (pane: 'note' | 'pdf') => {
  focusedDocument = pane
}
type Handler = () => void
const registrations = new Set<{
  handlers: Record<string, Handler | undefined>
  overrides: ShortcutOverrides
  disabled: boolean
  scope?: 'note' | 'pdf'
}>()
const dialogOpen = () =>
  document.querySelector('[role="dialog"]:not([inert]), [role="alertdialog"]:not([inert])')
function blockPdfHistory(event: InputEvent) {
  // WebKit can send native Edit > Undo to the last editable element even after
  // focus moves into the reader. Stop it before ProseMirror handles beforeinput.
  if (
    focusedDocument === 'pdf' &&
    !dialogOpen() &&
    (event.inputType === 'historyUndo' || event.inputType === 'historyRedo')
  ) {
    event.preventDefault()
    event.stopImmediatePropagation()
  }
}
function dispatch(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing || dialogOpen()) return
  if (
    focusedDocument === 'pdf' &&
    (['Mod+z', 'Mod+Shift+z', 'Mod+y'].some((binding) =>
      matchesBinding(event, binding, isTauri()),
    ) ||
      [...registrations].some((registration) =>
        shortcutCommands.some(
          (command) =>
            command.scope === 'editor' &&
            matchesBinding(event, bindingFor(command.id, registration.overrides), isTauri()),
        ),
      ))
  ) {
    event.preventDefault()
    event.stopImmediatePropagation()
    return
  }
  for (const registration of registrations) {
    if (registration.scope && registration.scope !== focusedDocument) continue
    const command = shortcutCommands.find(
      (c) =>
        c.scope === 'app' &&
        matchesBinding(event, bindingFor(c.id, registration.overrides), isTauri()),
    )
    if (!command || !Object.hasOwn(registration.handlers, command.id)) continue
    event.preventDefault()
    event.stopImmediatePropagation()
    if (!event.repeat && !registration.disabled) registration.handlers[command.id]?.()
    return
  }
}
export function useShortcutActions(
  handlers: Record<string, Handler | undefined>,
  disabled = false,
  explicit?: ShortcutOverrides,
  registered = true,
) {
  const scope = useContext(DocumentShortcutContext)
  const context = useContext(ShortcutContext)
  const entry = useRef({ handlers, disabled, scope, overrides: explicit ?? context })
  useLayoutEffect(() => {
    Object.assign(entry.current, { handlers, disabled, scope, overrides: explicit ?? context })
  })
  useLayoutEffect(() => {
    if (!registered) return
    if (!registrations.size) {
      document.addEventListener('keydown', dispatch, true)
      document.addEventListener('beforeinput', blockPdfHistory, true)
    }
    const current = entry.current
    registrations.add(current)
    return () => {
      registrations.delete(current)
      if (!registrations.size) {
        document.removeEventListener('keydown', dispatch, true)
        document.removeEventListener('beforeinput', blockPdfHistory, true)
      }
    }
  }, [registered])
}
