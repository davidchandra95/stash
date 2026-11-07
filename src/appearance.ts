import { useEffect, useLayoutEffect, useSyncExternalStore } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { isTagColor, tagColorRules } from './tags'
import { normalizeSidebarHidden, normalizeSidebarOrder } from './sidebarLayout'
import { BookOpen, Moon, Sun, SunMoon, type IconComponent } from './icons'
import type {
  AccentColor,
  Appearance,
  ColorMode,
  Density,
  InterfaceTheme,
  NewNoteTitle,
  SurfaceColor,
  ThemePreset,
  WindowLayout,
} from './model'

export const colorModes: Record<ColorMode, string> = {
  light: 'Light',
  sepia: 'Sepia',
  dark: 'Dark',
  system: 'Auto',
}
export const colorModeIcons: Record<ColorMode, IconComponent> = {
  light: Sun,
  sepia: BookOpen,
  dark: Moon,
  system: SunMoon,
}

/**
 * Preset accent colors: the macOS set plus indigo and teal. `system` follows the user's macOS
 * setting when it can be read; `custom` uses `Appearance.customAccent`.
 */
export const accents: Record<
  Exclude<AccentColor, 'system' | 'custom'>,
  { label: string; light: string; dark: string; ink?: string }
> = {
  blue: { label: 'Blue', light: '#007aff', dark: '#0a84ff' },
  indigo: { label: 'Indigo', light: '#5856d6', dark: '#7d7aff' },
  purple: { label: 'Purple', light: '#953d96', dark: '#a550a7' },
  pink: { label: 'Pink', light: '#e0447f', dark: '#f74f9e' },
  red: { label: 'Red', light: '#d93036', dark: '#ff5257' },
  orange: { label: 'Orange', light: '#e46f10', dark: '#f7821b' },
  // Yellow is too light for white text, so it uses dark ink on filled controls.
  yellow: { label: 'Yellow', light: '#f5b323', dark: '#ffc600', ink: '#1d1d1f' },
  green: { label: 'Green', light: '#3f9c2f', dark: '#5bbd47' },
  teal: { label: 'Teal', light: '#0f8f8f', dark: '#3cc4c4' },
  graphite: { label: 'Graphite', light: '#808080', dark: '#8c8c8c' },
}
export const accentColors = Object.keys(accents) as (keyof typeof accents)[]

export const surfaceColors: Record<SurfaceColor, { label: string; description: string }> = {
  neutral: { label: 'Neutral', description: 'Plain surfaces; color stays on accents and tags' },
  tinted: { label: 'Tinted', description: 'A light wash of the accent on the window' },
  vivid: { label: 'Vivid', description: 'A stronger wash and accent-filled selection' },
}
const surfaceColorValues = Object.keys(surfaceColors) as SurfaceColor[]

export const densities: Record<Density, string> = {
  compact: 'Compact',
  default: 'Default',
  comfortable: 'Comfortable',
}
const densityValues = Object.keys(densities) as Density[]
const hexColor = /^#[0-9a-f]{6}$/i

export const interfaceThemes: Record<InterfaceTheme, string> = {
  native: 'Native',
  workspace: 'Workspace',
}
/** The accent a theme uses when the accent setting is `system`; native follows macOS. */
export const themeAccents: Partial<Record<InterfaceTheme, { light: string; dark: string }>> = {
  workspace: { light: '#494bcb', dark: '#7577e6' },
}

const colorModeValues = Object.keys(colorModes) as ColorMode[]
export const layouts: WindowLayout[] = ['standard', 'cards']
export const layoutNames: Record<WindowLayout, string> = { standard: 'Standard', cards: 'Cards' }
const accentValues: AccentColor[] = ['system', ...accentColors, 'custom']
/** Automatic sync choices in minutes; 0 is off. */
export const autoSyncIntervals = [0, 5, 15, 30, 60]
export const autoSyncLabel = (minutes: number) =>
  minutes ? (minutes === 60 ? 'Every hour' : `Every ${minutes} minutes`) : 'Off'
export const newNoteTitles: Record<NewNoteTitle, string> = {
  field: 'Title field',
  firstLine: 'First line',
}

/** The appearance settings a preset can carry. Built-in presets leave fonts alone. */
export const presetKeys = [
  'interfaceTheme',
  'colorMode',
  'accent',
  'customAccent',
  'surfaceColor',
  'titleFont',
  'noteFont',
  'codeFont',
] as const satisfies readonly (keyof ThemePreset['settings'])[]

/** Saved presets with a usable id and name; settings that don't validate are dropped. */
function normalizePresets(value: unknown, defaults: Appearance): ThemePreset[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value.flatMap((item) => {
    const { id, name, settings } = (item ?? {}) as Record<string, unknown>
    if (typeof id !== 'string' || !id || seen.has(id)) return []
    if (typeof name !== 'string' || !name.trim()) return []
    if (!settings || typeof settings !== 'object') return []
    seen.add(id)
    const saved = settings as Record<string, unknown>
    // Validate through the appearance rules: a setting survives if they keep it as saved.
    const valid = normalizeAppearance({ ...saved, themePresets: [] }, defaults)
    const kept = presetKeys.filter((key) => {
      const raw = saved[key]
      if (typeof raw !== 'string' || !raw) return false
      return (
        key.endsWith('Font') || valid[key] === (key === 'customAccent' ? raw.toLowerCase() : raw)
      )
    })
    return [
      {
        id,
        name: name.trim().slice(0, 40),
        settings: Object.fromEntries(kept.map((key) => [key, valid[key]])),
      },
    ]
  })
}

/** Reads saved appearance, including preferences written before the v2 interface. */
export function normalizeAppearance(
  saved: (Partial<Appearance> & { dark?: unknown }) | null | undefined,
  defaults: Appearance,
): Appearance {
  const {
    dark,
    // Retired v1 settings: palettes, the cards layout and the interface font.
    theme: _theme,
    appStyle,
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
  const interfaceTheme = Object.hasOwn(interfaceThemes, rest.interfaceTheme as string)
    ? (rest.interfaceTheme as InterfaceTheme)
    : defaults.interfaceTheme
  const accent = accentValues.includes(rest.accent as AccentColor)
    ? (rest.accent as AccentColor)
    : defaults.accent
  return {
    ...defaults,
    ...rest,
    colorMode,
    interfaceTheme,
    accent,
    customAccent: hexColor.test(rest.customAccent as string)
      ? (rest.customAccent as string).toLowerCase()
      : defaults.customAccent,
    tagColors: Object.fromEntries(
      Object.entries(rest.tagColors && typeof rest.tagColors === 'object' ? rest.tagColors : {})
        .filter(([tag, tone]) => tag && isTagColor(tone))
        .map(([tag, tone]) => [tag.toLowerCase(), tone]),
    ),
    themePresets: normalizePresets(rest.themePresets, defaults),
    density: densityValues.includes(rest.density as Density)
      ? (rest.density as Density)
      : defaults.density,
    sidebarOrder: normalizeSidebarOrder(rest.sidebarOrder),
    sidebarHidden: normalizeSidebarHidden(rest.sidebarHidden),
    surfaceColor: surfaceColorValues.includes(rest.surfaceColor as SurfaceColor)
      ? (rest.surfaceColor as SurfaceColor)
      : defaults.surfaceColor,
    translucentSidebar:
      typeof rest.translucentSidebar === 'boolean'
        ? rest.translucentSidebar
        : defaults.translucentSidebar,
    sidebarCounts:
      typeof rest.sidebarCounts === 'boolean' ? rest.sidebarCounts : defaults.sidebarCounts,
    defaultNotebookId:
      typeof rest.defaultNotebookId === 'string'
        ? rest.defaultNotebookId
        : defaults.defaultNotebookId,
    newNoteTitle: rest.newNoteTitle === 'firstLine' ? 'firstLine' : defaults.newNoteTitle,
    spellcheck: typeof rest.spellcheck === 'boolean' ? rest.spellcheck : defaults.spellcheck,
    smartTaskDates:
      typeof rest.smartTaskDates === 'boolean' ? rest.smartTaskDates : defaults.smartTaskDates,
    keepTaskDateWords:
      typeof rest.keepTaskDateWords === 'boolean'
        ? rest.keepTaskDateWords
        : defaults.keepTaskDateWords,
    autoSyncMinutes: autoSyncIntervals.includes(rest.autoSyncMinutes as number)
      ? (rest.autoSyncMinutes as number)
      : defaults.autoSyncMinutes,
    // The v1 "Modern cards" app style becomes the cards layout.
    layout: layouts.includes(rest.layout as WindowLayout)
      ? (rest.layout as WindowLayout)
      : appStyle === 'cards'
        ? 'cards'
        : defaults.layout,
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

function channels(hex: string) {
  const value = parseInt(hex.slice(1), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}
function toHex(rgb: number[]) {
  return `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`
}
/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string) {
  const [r, g, b] = channels(hex).map((c) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * A user-picked accent. Dark mode lifts very dark picks so selection and links stay visible,
 * and light colors get dark ink on filled controls, like the yellow preset.
 */
export function customAccentValue(hex: string, dark: boolean) {
  const base = hexColor.test(hex) ? hex.toLowerCase() : '#7c5cff'
  const color =
    dark && luminance(base) < 0.12 ? toHex(channels(base).map((c) => c + (255 - c) * 0.35)) : base
  return { color, ink: luminance(color) > 0.45 ? '#1d1d1f' : undefined }
}

export function accentValue(
  accent: AccentColor,
  dark: boolean,
  system: string | null,
  theme: InterfaceTheme = 'native',
  custom = '#7c5cff',
): { color: string; ink?: string } {
  if (accent === 'custom') return customAccentValue(custom, dark)
  if (accent === 'system') {
    const themed = themeAccents[theme]
    if (themed) return { color: themed[dark ? 'dark' : 'light'] }
    return { color: system ?? accents.blue[dark ? 'dark' : 'light'] }
  }
  const choice = accents[accent]
  return { color: choice[dark ? 'dark' : 'light'], ink: choice.ink }
}

/**
 * Applies color mode, interface theme and accent to the document root, so portaled menus and
 * dialogs share the workspace theme without carrying their own theme attributes.
 */
export function useDocumentTheme(
  appearance: Pick<Appearance, 'colorMode' | 'accent'> &
    Partial<
      Pick<Appearance, 'interfaceTheme' | 'customAccent' | 'surfaceColor' | 'tagColors' | 'density'>
    >,
) {
  const dark = useResolvedDark(appearance.colorMode)
  const system = useSystemAccentValue()
  const theme = appearance.interfaceTheme ?? 'native'
  const sepia = appearance.colorMode === 'sepia'
  const surface = appearance.surfaceColor ?? 'neutral'
  const density = appearance.density ?? 'default'
  const { color, ink } = accentValue(
    appearance.accent,
    dark,
    system,
    theme,
    appearance.customAccent,
  )
  useLayoutEffect(() => {
    const root = document.documentElement
    root.dataset.theme = dark ? 'dark' : 'light'
    root.dataset.ui = theme
    root.dataset.surface = surface
    root.dataset.density = density
    // Sepia is a warm light mode: everything keyed to data-theme treats it as light.
    if (sepia) root.dataset.tint = 'sepia'
    else delete root.dataset.tint
    root.style.colorScheme = dark ? 'dark' : 'light'
    root.style.setProperty('--accent', color)
    root.style.setProperty('--on-accent', ink ?? '#ffffff')
  }, [dark, sepia, color, ink, theme, surface, density])
  const tagRules = tagColorRules(appearance.tagColors ?? {})
  useLayoutEffect(() => {
    let style = document.getElementById('tag-colors')
    if (!tagRules) return void style?.remove()
    if (!style) {
      style = document.createElement('style')
      style.id = 'tag-colors'
      document.head.append(style)
    }
    style.textContent = tagRules
  }, [tagRules])
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
