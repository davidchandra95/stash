import { invoke, isTauri } from '@tauri-apps/api/core'
import { sfSymbolFor } from './icons'
import { platform } from './platform'
import type { NoteAction } from './components/NoteContextMenu'

export const usesNativeContextMenu = () =>
  isTauri() && platform.platform === 'macos' && !platform.mobile

export async function showNativeContextMenu(
  actions: NoteAction[],
  launcher: HTMLElement,
  point: { x: number; y: number },
  binding: (id: string) => string | null = () => null,
) {
  // AppKit returns after dismissal, releasing the menu and its template images.
  const selected = await invoke<number | null>('show_outline_menu', {
    actions: actions.map((action) => ({
      label: action.label,
      symbol: sfSymbolFor(action.icon) ?? 'circle',
      disabled: !!action.disabled,
      separator: !!action.separator,
      shortcut: action.shortcutId ? binding(action.shortcutId) : null,
    })),
    x: point.x,
    y: point.y,
  })
  const action = selected === null ? undefined : actions[selected]
  if (action && !action.disabled && launcher.isConnected) action.run(launcher)
}
