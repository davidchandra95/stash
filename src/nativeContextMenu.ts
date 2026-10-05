import { invoke, isTauri } from '@tauri-apps/api/core'
import { nativeMenuIcon } from './nativeMenuIcon'
import { platform } from './platform'
import type { NoteAction } from './components/NoteContextMenu'

export type NativeMenuAction = NoteAction & { checked?: boolean; color?: string }
export type NativeMenuOptions = { above?: boolean; trackingId?: string }

// Tokens also cover the asynchronous icon preparation before AppKit starts tracking.
const pendingMenus = new Map<string, { cancelled: boolean }>()

export const usesNativeContextMenu = () =>
  isTauri() && platform.platform === 'macos' && !platform.mobile

export async function showNativeContextMenu(
  actions: NativeMenuAction[],
  launcher: HTMLElement,
  point: { x: number; y: number },
  binding: (id: string) => string | null = () => null,
  options: NativeMenuOptions = {},
) {
  const token = { cancelled: false }
  const id = options.trackingId
  if (id) {
    const previous = pendingMenus.get(id)
    if (previous) previous.cancelled = true
    pendingMenus.set(id, token)
  }
  try {
    const prepared = await Promise.all(
      actions.map(async (action) => {
        let iconPng: string | null = null
        if (!action.color) {
          try {
            iconPng = await nativeMenuIcon(action.icon)
          } catch (error) {
            console.error(`Could not prepare native menu icon for ${action.label}`, error)
          }
        }
        return {
          label: action.label,
          iconPng,
          disabled: !!action.disabled,
          separator: !!action.separator,
          shortcut: action.shortcutId ? binding(action.shortcutId) : null,
          ...(action.checked !== undefined ? { checked: action.checked } : {}),
          ...(action.color ? { color: action.color } : {}),
        }
      }),
    )
    if (token.cancelled || !launcher.isConnected) return
    // AppKit returns after dismissal, releasing the menu and its template images.
    const selected = await invoke<number | null>('show_outline_menu', {
      actions: prepared,
      x: point.x,
      y: point.y,
      ...options,
    })
    const action = selected === null ? undefined : actions[selected]
    if (!token.cancelled && action && !action.disabled && launcher.isConnected) action.run(launcher)
  } finally {
    if (id && pendingMenus.get(id) === token) pendingMenus.delete(id)
  }
}

export async function cancelNativeContextMenu(trackingId: string) {
  const pending = pendingMenus.get(trackingId)
  if (pending) pending.cancelled = true
  await invoke('cancel_outline_menu', { trackingId })
}
