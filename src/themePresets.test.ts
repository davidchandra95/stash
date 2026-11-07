// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { normalizeAppearance } from './appearance'
import type { Appearance } from './model'
import { defaultAppearance } from './storage/library'
import {
  applyPreset,
  builtInPresets,
  currentPreset,
  presetMatches,
  presetPreview,
  presetSettingsFrom,
} from './themePresets'

const preset = (id: string) => builtInPresets.find((item) => item.id === id)!

describe('theme presets', () => {
  it('applies only the settings a preset carries', () => {
    const start: Appearance = { ...defaultAppearance, noteFont: 'avenir', size: 18 }
    const next = applyPreset(start, preset('midnight'))
    expect(next).toEqual({
      ...start,
      interfaceTheme: 'native',
      colorMode: 'dark',
      accent: 'indigo',
      surfaceColor: 'vivid',
    })
    expect(applyPreset(start, preset('paper')).noteFont).toBe('georgia')
  })

  it('is current until any setting it carries changes', () => {
    const applied = applyPreset(defaultAppearance, preset('ocean'))
    expect(currentPreset(applied)?.id).toBe('ocean')
    expect(currentPreset({ ...applied, size: 20 })?.id).toBe('ocean')
    expect(currentPreset({ ...applied, accent: 'pink' })).toBeUndefined()
  })

  it('ignores the stored custom color unless the custom accent is in use', () => {
    const saved = { id: 'mine', name: 'Mine', settings: presetSettingsFrom(defaultAppearance) }
    expect(presetMatches({ ...defaultAppearance, customAccent: '#123456' }, saved)).toBe(true)
    const custom = { ...defaultAppearance, accent: 'custom' as const }
    const savedCustom = { ...saved, settings: presetSettingsFrom(custom) }
    expect(presetMatches({ ...custom, customAccent: '#123456' }, savedCustom)).toBe(false)
  })

  it('prefers a saved preset over a built-in one with the same look', () => {
    const look = applyPreset(defaultAppearance, preset('sunset'))
    const mine = { id: 'mine', name: 'Mine', settings: presetSettingsFrom(look) }
    expect(currentPreset({ ...look, themePresets: [mine] })?.id).toBe('mine')
  })

  it('previews Auto presets in the given mode', () => {
    expect(presetPreview(defaultAppearance, preset('calm'), true)['--preview-content']).toBe(
      '#1e1e1f',
    )
    expect(presetPreview(defaultAppearance, preset('calm'), false)['--preview-content']).toBe(
      '#ffffff',
    )
  })

  it('keeps valid saved presets and drops invalid ones and settings', () => {
    const themePresets = [
      {
        id: 'a',
        name: '  Focus  ',
        settings: {
          accent: 'teal',
          surfaceColor: 'loud',
          noteFont: 'georgia',
          customAccent: '#ABCDEF',
        },
      },
      { id: 'a', name: 'Duplicate', settings: {} },
      { id: '', name: 'No id', settings: {} },
      { id: 'b', name: ' ', settings: {} },
      { id: 'c', name: 'No settings' },
      'junk',
    ]
    expect(normalizeAppearance({ themePresets } as never, defaultAppearance).themePresets).toEqual([
      {
        id: 'a',
        name: 'Focus',
        settings: { accent: 'teal', customAccent: '#abcdef', noteFont: 'georgia' },
      },
    ])
  })
})
