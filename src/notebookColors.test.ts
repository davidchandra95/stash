import { expect, it } from 'vitest'
import { canonicalNotebookColor, notebookColorValue } from './notebookColors'

it('paints presets with mode-aware tokens and maps legacy hexes to presets', () => {
  expect(notebookColorValue('#688b60')).toBe('var(--notebook-sage)')
  expect(notebookColorValue('#98BD90')).toBe('var(--notebook-sage)')
  expect(notebookColorValue('#899ab4')).toBe('var(--notebook-slate)')
  expect(canonicalNotebookColor('#ba9775')).toBe('#a37454')
})

it('softens custom colors toward the text color and leaves their stored value alone', () => {
  expect(notebookColorValue('#ffff00')).toBe('color-mix(in oklab, #ffff00 82%, var(--text))')
  expect(canonicalNotebookColor('#c56a5d')).toBe('#c56a5d')
  expect(notebookColorValue(undefined)).toBeUndefined()
})
