import { accentValue, presetKeys } from './appearance'
import type { Appearance, ThemePreset } from './model'

type PresetSettings = ThemePreset['settings']

export const builtInPresets: ThemePreset[] = [
  {
    id: 'calm',
    name: 'Calm',
    settings: {
      interfaceTheme: 'native',
      colorMode: 'system',
      accent: 'graphite',
      surfaceColor: 'neutral',
    },
  },
  {
    id: 'ocean',
    name: 'Ocean',
    settings: {
      interfaceTheme: 'workspace',
      colorMode: 'light',
      accent: 'teal',
      surfaceColor: 'tinted',
    },
  },
  {
    id: 'sunset',
    name: 'Sunset',
    settings: {
      interfaceTheme: 'native',
      colorMode: 'light',
      accent: 'orange',
      surfaceColor: 'vivid',
    },
  },
  {
    id: 'paper',
    name: 'Paper',
    settings: {
      interfaceTheme: 'native',
      colorMode: 'sepia',
      accent: 'orange',
      surfaceColor: 'neutral',
      titleFont: 'georgia',
      noteFont: 'georgia',
    },
  },
  {
    id: 'midnight',
    name: 'Midnight',
    settings: {
      interfaceTheme: 'native',
      colorMode: 'dark',
      accent: 'indigo',
      surfaceColor: 'vivid',
    },
  },
]

/** The settings to store for a new preset: the whole current look, fonts included. */
export function presetSettingsFrom(appearance: Appearance): PresetSettings {
  return Object.fromEntries(presetKeys.map((key) => [key, appearance[key]])) as PresetSettings
}

export function applyPreset(appearance: Appearance, preset: ThemePreset): Appearance {
  return { ...appearance, ...preset.settings }
}

/** A preset is current while every setting it carries matches; any later change leaves it. */
export function presetMatches(appearance: Appearance, preset: ThemePreset) {
  const settings = preset.settings
  return presetKeys.every((key) => {
    if (settings[key] === undefined) return true
    // A custom color only matters while the custom accent is in use.
    if (key === 'customAccent' && (settings.accent ?? appearance.accent) !== 'custom') return true
    return settings[key] === appearance[key]
  })
}

/** The first matching preset: the user's own come first, since they are the more specific. */
export function currentPreset(appearance: Appearance) {
  return [...appearance.themePresets, ...builtInPresets].find((preset) =>
    presetMatches(appearance, preset),
  )
}

const surfaces = {
  light: { frame: '#ececee', content: '#ffffff', ink: '#1d1d1f' },
  dark: { frame: '#29292b', content: '#1e1e1f', ink: '#e5e5e7' },
  sepia: { frame: '#e9dfc8', content: '#f6eedb', ink: '#3b2f20' },
  workspaceLight: { frame: '#eef0f4', content: '#ffffff', ink: '#1f2a3a' },
  workspaceDark: { frame: '#0e1520', content: '#141d2c', ink: '#f8fafc' },
}
const frameTint = { neutral: 0, tinted: 8, vivid: 17 }

/**
 * Colors for a preset's miniature preview. It approximates the real tokens (which only exist
 * on the document root) closely enough to tell presets apart. `dark` resolves Auto.
 */
export function presetPreview(appearance: Appearance, preset: ThemePreset, dark: boolean) {
  const look = { ...appearance, ...preset.settings }
  const mode = look.colorMode === 'system' ? (dark ? 'dark' : 'light') : look.colorMode
  const isDark = mode === 'dark'
  const base =
    mode === 'sepia'
      ? surfaces.sepia
      : look.interfaceTheme === 'workspace'
        ? surfaces[isDark ? 'workspaceDark' : 'workspaceLight']
        : surfaces[isDark ? 'dark' : 'light']
  const accent = accentValue(
    look.accent,
    isDark,
    null,
    look.interfaceTheme,
    look.customAccent,
  ).color
  const tint = frameTint[look.surfaceColor]
  return {
    '--preview-frame': `color-mix(in oklab, ${accent} ${tint}%, ${base.frame})`,
    '--preview-content': base.content,
    '--preview-ink': base.ink,
    '--preview-accent': accent,
  }
}
