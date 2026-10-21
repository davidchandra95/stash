import { useEffect, useLayoutEffect, useSyncExternalStore } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { AccentColor, Appearance, ColorMode } from './model'

export const colorModes: Record<ColorMode, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'Auto',
}

/** macOS accent colors. `system` follows the user's macOS setting when it can be read. */
export const accents: Record<
  Exclude<AccentColor, 'system'>,
  { label: string; light: string; dark: string; ink?: string }
> = {
  blue: { label: 'Blue', light: '#007aff', dark: '#0a84ff' },
  purple: { label: 'Purple', light: '#953d96', dark: '#a550a7' },
  pink: { label: 'Pink', light: '#e0447f', dark: '#f74f9e' },
  red: { label: 'Red', light: '#d93036', dark: '#ff5257' },
  orange: { label: 'Orange', light: '#e46f10', dark: '#f7821b' },
  // Yellow is too light for white text, so it uses dark ink on filled controls.
  yellow: { label: 'Yellow', light: '#f5b323', dark: '#ffc600', ink: '#1d1d1f' },
  green: { label: 'Green', light: '#3f9c2f', dark: '#5bbd47' },
  graphite: { label: 'Graphite', light: '#808080', dark: '#8c8c8c' },
}
export const accentColors = Object.keys(accents) as (keyof typeof accents)[]

const colorModeValues: ColorMode[] = ['light', 'dark', 'system']
const accentValues: AccentColor[] = ['system', ...accentColors]

/** Reads saved appearance, including preferences written before the v2 interface. */
export function normalizeAppearance(
  saved: (Partial<Appearance> & { dark?: unknown }) | null | undefined,
  defaults: Appearance,
): Appearance {
  const {
    dark,
    // Retired v1 settings: palettes, the cards layout and the interface font.
    theme: _theme,
    appStyle: _appStyle,
    uiFont: _uiFont,
    ...rest
  } = (saved ?? {}) as Partial<Appearance> & Record<string, unknown>
  const colorMode = colorModeValues.includes(rest.colorMode as ColorMode)
    ? (rest.colorMode as ColorMode)
    : typeof dark === 'boolean'
      ? dark
        ? 'dark'
        : 'light'
      : defaults.colorMode
  const accent = accentValues.includes(rest.accent as AccentColor)
    ? (rest.accent as AccentColor)
    : defaults.accent
  return {
    ...defaults,
    ...rest,
    colorMode,
    accent,
    translucentSidebar:
      typeof rest.translucentSidebar === 'boolean'
        ? rest.translucentSidebar
        : defaults.translucentSidebar,
    sidebarCounts:
      typeof rest.sidebarCounts === 'boolean' ? rest.sidebarCounts : defaults.sidebarCounts,
  }
}

const darkQuery = () =>
  typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null

function subscribeScheme(change: () => void) {
  const query = darkQuery()
  query?.addEventListener('change', change)
  return () => query?.removeEventListener('change', change)
}

/** Whether the interface should currently render dark. */
export function useResolvedDark(mode: ColorMode) {
  const systemDark = useSyncExternalStore(
    subscribeScheme,
    () => !!darkQuery()?.matches,
    () => false,
  )
  return mode === 'system' ? systemDark : mode === 'dark'
}

let systemAccent: string | null = null
const accentListeners = new Set<() => void>()
/** Native code reports the macOS accent color; browsers keep the blue fallback. */
export function setSystemAccent(color: string | null) {
  if (color === systemAccent) return
  systemAccent = color
  accentListeners.forEach((listener) => listener())
}
function useSystemAccentValue() {
  return useSyncExternalStore(
    (change) => {
      accentListeners.add(change)
      return () => accentListeners.delete(change)
    },
    () => systemAccent,
  )
}

export function accentValue(accent: AccentColor, dark: boolean, system: string | null) {
  if (accent === 'system') return { color: system ?? accents.blue[dark ? 'dark' : 'light'] }
  const choice = accents[accent]
  return { color: choice[dark ? 'dark' : 'light'], ink: choice.ink }
}

/**
 * Applies color mode and accent to the document root, so portaled menus and dialogs
 * share the workspace theme without carrying their own theme attributes.
 */
export function useDocumentTheme(appearance: Pick<Appearance, 'colorMode' | 'accent'>) {
  const dark = useResolvedDark(appearance.colorMode)
  const system = useSystemAccentValue()
  const { color, ink } = accentValue(appearance.accent, dark, system)
  useLayoutEffect(() => {
    const root = document.documentElement
    root.dataset.theme = dark ? 'dark' : 'light'
    root.style.colorScheme = dark ? 'dark' : 'light'
    root.style.setProperty('--accent', color)
    root.style.setProperty('--on-accent', ink ?? '#ffffff')
  }, [dark, color, ink])
  return dark
}

/** Reads the macOS accent color now and whenever the window becomes active again. */
export function useSystemAccent(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    let current = true
    const read = () =>
      invoke<string | null>('system_accent_color')
        .then((color) => {
          if (current) setSystemAccent(color)
        })
        .catch((error) => console.error('Could not read the macOS accent color', error))
    void read()
    window.addEventListener('focus', read)
    return () => {
      current = false
      window.removeEventListener('focus', read)
    }
  }, [enabled])
}
