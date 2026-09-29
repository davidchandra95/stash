import { describe, expect, it } from 'vitest'
import { fontFamily, fonts } from './fonts'

describe('installed font selection', () => {
  it('keeps existing preset choices working', () => {
    expect(fontFamily('system')).toBe(fonts.system)
    expect(fontFamily('georgia')).toBe('Georgia, serif')
  })
  it('treats installed names as one literal CSS family', () => {
    expect(fontFamily('font:SF Pro Text')).toBe('"SF Pro Text"')
    expect(fontFamily('font:Family, With Comma')).toBe('"Family, With Comma"')
    expect(fontFamily('font:A"B')).toBe('"A\\"B"')
  })
  it('does not confuse installed family names with preset identifiers', () => {
    expect(fontFamily('font:system')).toBe('"system"')
  })
})
