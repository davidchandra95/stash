import { expect, it } from 'vitest'
import {
  defaultHeadingStyles,
  headingStyleVariables,
  normalizeHeadingStyles,
} from './headingStyles'
import { fontFamily } from './fonts'

it('defaults and normalizes each heading style independently', () => {
  const defaults = defaultHeadingStyles()
  defaults.h1.italic = true
  expect(defaults.h2.italic).toBe(false)

  expect(
    normalizeHeadingStyles({
      h2: { font: 'palatino', weight: 700, italic: true, color: '#216f9c' },
      h4: { font: '', weight: 650, italic: 'true', color: 'blue' },
    }),
  ).toEqual({
    h1: { font: null, weight: 600, italic: false, color: null },
    h2: { font: 'palatino', weight: 700, italic: true, color: '#216f9c' },
    h3: { font: null, weight: 600, italic: false, color: null },
    h4: { font: null, weight: 600, italic: false, color: null },
    h5: { font: null, weight: 600, italic: false, color: null },
    h6: { font: null, weight: 600, italic: false, color: null },
  })
})

it('creates scoped variables without changing the heading size hierarchy', () => {
  const styles = defaultHeadingStyles()
  styles.h2 = { font: 'palatino', weight: 700, italic: true, color: '#216f9c' }
  expect(headingStyleVariables(styles, 'georgia')).toMatchObject({
    '--heading-h1-font': fontFamily('georgia'),
    '--heading-h1-weight': '600',
    '--heading-h1-style': 'normal',
    '--heading-h1-color': 'var(--text)',
    '--heading-h2-font': fontFamily('palatino'),
    '--heading-h2-weight': '700',
    '--heading-h2-style': 'italic',
    '--heading-h2-color': '#216f9c',
  })
  expect(Object.keys(headingStyleVariables(styles, 'georgia'))).not.toContain('--heading-h2-size')
})
