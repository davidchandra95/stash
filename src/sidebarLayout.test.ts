import { describe, expect, it } from 'vitest'
import {
  moveSection,
  normalizeSidebarHidden,
  normalizeSidebarOrder,
  sectionVisible,
  setSidebarItemHidden,
} from './sidebarLayout'

describe('sidebar layout', () => {
  it('keeps a saved order, dropping unknown and repeated sections and adding missing ones', () => {
    expect(normalizeSidebarOrder(['tags', 'pdfs', 'tags', 'trash'])).toEqual([
      'tags',
      'pdfs',
      'quick',
      'notebooks',
    ])
    expect(normalizeSidebarOrder('tags')).toEqual(['quick', 'notebooks', 'pdfs', 'tags'])
  })

  it('keeps known hidden items once', () => {
    expect(normalizeSidebarHidden(['todo', 'todo', 'tasks:tags', 'all', 3])).toEqual([
      'todo',
      'tasks:tags',
    ])
    expect(normalizeSidebarHidden(null)).toEqual([])
  })

  it('moves sections one place and keeps the ends', () => {
    const order = normalizeSidebarOrder([])
    expect(moveSection(order, 'pdfs', -1)).toEqual(['quick', 'pdfs', 'notebooks', 'tags'])
    expect(moveSection(order, 'quick', -1)).toBe(order)
    expect(moveSection(order, 'tags', 1)).toBe(order)
  })

  it('toggles items without repeats', () => {
    expect(setSidebarItemHidden(['todo'], 'todo', true)).toEqual(['todo'])
    expect(setSidebarItemHidden(['todo', 'pdfs'], 'todo', false)).toEqual(['pdfs'])
  })

  it('hides Quick access once both of its views are hidden', () => {
    expect(sectionVisible(['pinned'], 'quick')).toBe(true)
    expect(sectionVisible(['pinned', 'quickAccess'], 'quick')).toBe(false)
    expect(sectionVisible(['quick'], 'quick')).toBe(false)
    expect(sectionVisible([], 'tags')).toBe(true)
  })
})
