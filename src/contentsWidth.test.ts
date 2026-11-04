import { expect, it } from 'vitest'
import {
  defaultContentsWidth,
  normalizeContentsWidth,
  taskDetailLimits,
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

it('applies the task detail limits when given', () => {
  expect(normalizeContentsWidth(279, taskDetailLimits)).toBeUndefined()
  expect(normalizeContentsWidth(560, taskDetailLimits)).toBe(560)
  expect(normalizeContentsWidth(561, taskDetailLimits)).toBeUndefined()
  expect(visibleContentsWidth(500, 760, taskDetailLimits)).toBe(400)
  expect(visibleContentsWidth(500, 500, taskDetailLimits)).toBe(280)
})
