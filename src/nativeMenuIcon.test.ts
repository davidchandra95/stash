// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { Files, Plus, Trash2 } from './icons'
import { nativeMenuIcon } from './nativeMenuIcon'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
function rasterizer(fail = false) {
  const sources: string[] = []
  vi.stubGlobal(
    'Image',
    class {
      onload?: () => void
      onerror?: () => void
      set src(value: string) {
        sources.push(value)
        queueMicrotask(() => (fail ? this.onerror?.() : this.onload?.()))
      }
    },
  )
  const drawImage = vi.fn()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage,
  } as unknown as CanvasRenderingContext2D)
  const encode = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    expect(this.width).toBe(48)
    expect(this.height).toBe(48)
    return 'data:image/png;base64,cG5n'
  })
  return { sources, drawImage, encode }
}
it('rasterizes black Lucide artwork at 48px and shares concurrent and later requests', async () => {
  const { sources, drawImage, encode } = rasterizer()
  const first = nativeMenuIcon(Plus)
  expect(nativeMenuIcon(Plus)).toBe(first)
  expect(await first).toBe('cG5n')
  expect(await nativeMenuIcon(Plus)).toBe('cG5n')
  expect(sources).toHaveLength(1)
  const svg = decodeURIComponent(sources[0].split(',')[1])
  expect(svg).toContain('stroke="#000000"')
  expect(svg).toContain('fill="none"')
  expect(svg).toContain('width="48"')
  expect(svg).toContain('<path')
  expect(drawImage).toHaveBeenCalledWith(expect.any(Object), 0, 0, 48, 48)
  expect(encode).toHaveBeenCalledExactlyOnceWith('image/png')
})
it('retries a conversion after image loading fails', async () => {
  rasterizer(true)
  await expect(nativeMenuIcon(Files)).rejects.toThrow('Could not load')
  const { sources } = rasterizer()
  await expect(nativeMenuIcon(Files)).resolves.toBe('cG5n')
  expect(sources).toHaveLength(1)
})
it('reports an unavailable canvas instead of sending an empty image', async () => {
  rasterizer()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  await expect(nativeMenuIcon(Trash2)).rejects.toThrow('Could not create')
})
