import { expect, it } from 'vitest'
import {
  defaultContentsWidth,
  normalizeContentsWidth,
  visibleContentsWidth,
} from './contentsWidth'

it('uses the default for invalid saved widths', () => {
  expect(normalizeContentsWidth(300)).toBe(300)
  expect(normalizeContentsWidth(159)).toBeUndefined()
  expect(normalizeContentsWidth(481)).toBeUndefined()
  expect(normalizeContentsWidth(300.5)).toBeUndefined()
  expect(normalizeContentsWidth('300')).toBeUndefined()
  expect(defaultContentsWidth).toBe(260)
})

it('temporarily limits a saved contents width to leave document space', () => {
  expect(visibleContentsWidth(400, 600)).toBe(320)
  expect(visibleContentsWidth(400, 800)).toBe(400)
  expect(visibleContentsWidth(400, 420)).toBe(160)
})
