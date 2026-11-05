// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import { holdDragCursor, useDragCursor } from './dragCursor'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const holding = () => document.documentElement.hasAttribute('data-drag-cursor')

it('keeps the cursor until the last holder releases, and ignores repeat releases', () => {
  const first = holdDragCursor()
  const second = holdDragCursor()
  first()
  first()
  expect(holding()).toBe(true)
  second()
  expect(holding()).toBe(false)
})

it('follows the active state and releases on unmount', async () => {
  const Holder = ({ active }: { active: boolean }) => {
    useDragCursor(active)
    return null
  }
  const root = createRoot(document.createElement('div'))
  await act(async () => root.render(<Holder active={false} />))
  expect(holding()).toBe(false)
  await act(async () => root.render(<Holder active />))
  expect(holding()).toBe(true)
  await act(async () => root.render(<Holder active={false} />))
  expect(holding()).toBe(false)
  await act(async () => root.render(<Holder active />))
  await act(async () => root.unmount())
  expect(holding()).toBe(false)
})
