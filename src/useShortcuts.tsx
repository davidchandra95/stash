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
type Handler = () => void
const registrations = new Set<{
  handlers: Record<string, Handler | undefined>
  overrides: ShortcutOverrides
  disabled: boolean
}>()
function dispatch(event: KeyboardEvent) {
  if (
    event.defaultPrevented ||
    event.isComposing ||
    document.querySelector('[role="dialog"]:not([inert]), [role="alertdialog"]:not([inert])')
  )
    return
  for (const registration of registrations) {
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
) {
  const context = useContext(ShortcutContext)
  const entry = useRef({ handlers, disabled, overrides: explicit ?? context })
  useLayoutEffect(() => {
    Object.assign(entry.current, { handlers, disabled, overrides: explicit ?? context })
  })
  useLayoutEffect(() => {
    if (!registrations.size) document.addEventListener('keydown', dispatch, true)
    const current = entry.current
    registrations.add(current)
    return () => {
      registrations.delete(current)
      if (!registrations.size) document.removeEventListener('keydown', dispatch, true)
    }
  }, [])
}
