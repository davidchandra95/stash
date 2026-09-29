// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CursorMetrics } from './cursorMetrics'

function fontGeometry(baseline = 21, height = 32, capHeight = 16) {
  const measureText = vi.fn(() => ({ actualBoundingBoxAscent: capHeight }))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    measureText,
  } as unknown as CanvasRenderingContext2D)
  const rect = (top: number, height: number) => ({ top, height }) as DOMRect
  // Text starts 8px below the line box. The zero-height inline block marks
  // the baseline without affecting line layout.
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return this.tagName === 'SPAN' ? rect(8 + baseline, 0) : rect(0, 48)
  })
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => rect(8, height),
  })
  const source = document.createElement('p')
  source.style.cssText = 'font:normal 400 32px "Sofia Pro";line-height:48px'
  document.body.append(source)
  return { source, measureText }
}
const originalRangeRect = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect')
afterEach(() => {
  vi.restoreAllMocks()
  document.body.replaceChildren()
  if (originalRangeRect)
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', originalRangeRect)
  else delete (Range.prototype as Partial<Range>).getBoundingClientRect
})

describe('font-aware vertical cursor alignment', () => {
  it('balances space above capital letters and below their baseline', () => {
    const { source } = fontGeometry()
    const offset = new CursorMetrics().offset(source, 32)
    expect(offset).toBe(-3)
    expect(21 - 16 - offset).toBe(offset + 32 - 21)
    expect(document.body.children).toHaveLength(1)
  })
  it('leaves already balanced font rectangles unchanged', () => {
    const { source } = fontGeometry(24)
    expect(new CursorMetrics().offset(source, 32)).toBe(0)
  })
  it('keeps the same visual center for empty line boxes', () => {
    const { source } = fontGeometry()
    const metrics = new CursorMetrics()
    expect(8 + metrics.offset(source, 32) + 16).toBe(metrics.offset(source, 48) + 24)
  })
  it('reuses measurements while typing and refreshes after a font change or load', () => {
    const { source, measureText } = fontGeometry()
    const metrics = new CursorMetrics()
    metrics.offset(source, 32)
    source.textContent = 'gyp'
    metrics.offset(source, 32)
    expect(measureText).toHaveBeenCalledTimes(1)
    source.style.font = 'normal 400 32px Inter'
    metrics.offset(source, 32)
    metrics.clear()
    metrics.offset(source, 32)
    expect(measureText).toHaveBeenCalledTimes(3)
    expect(measureText).toHaveBeenCalledWith('H')
  })
  it('preserves native geometry when measurements are unavailable', () => {
    const { source } = fontGeometry(21, 32, 0)
    expect(new CursorMetrics().offset(source, 32)).toBe(0)
  })
})
