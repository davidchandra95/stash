import { useLayoutEffect, type RefObject } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { platform } from './platform'

export function useDesktopWindowAppearance(
  surface: RefObject<HTMLDivElement | null>,
  ready: boolean,
  dark: boolean,
  palette: string,
) {
  useLayoutEffect(() => {
    if (!ready || !surface.current || platform.mobile) return
    const background = getComputedStyle(surface.current).getPropertyValue('--surface-app').trim()
    document.documentElement.style.setProperty('--desktop-window-background', background)
    let cancelled = false
    if (isTauri()) {
      void (async () => {
        try {
          await invoke('set_window_appearance', { dark, background })
        } catch (error) {
          console.error('Could not update the window appearance', error)
        }
        // The IPC round trip lets React finish mounting the themed surface.
        // Reveal error screens too, even if updating native appearance failed.
        if (!cancelled) await invoke('show_startup_window')
      })().catch((error) => console.error('Could not show the startup window', error))
    }
    return () => {
      cancelled = true
      document.documentElement.style.removeProperty('--desktop-window-background')
    }
  }, [surface, ready, dark, palette])
}
