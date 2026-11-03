import { expect, it, vi } from 'vitest'
import { ReadableStream as NodeStream } from 'node:stream/web'
import { readFileSync } from 'node:fs'
import { installPdfStreamIterator } from './compatibility'
import { sizePagesWithoutRound } from './assets'
it('reads text-stream chunks and releases the reader in WKWebViews without stream iteration', async () => {
  const original = Object.getOwnPropertyDescriptor(NodeStream.prototype, Symbol.asyncIterator)!
  try {
    Reflect.deleteProperty(NodeStream.prototype, Symbol.asyncIterator)
    installPdfStreamIterator(NodeStream as unknown as typeof ReadableStream)
    const stream = new NodeStream({
      start(c) {
        c.enqueue('first')
        c.enqueue('second')
        c.close()
      },
    })
    const values = []
    for await (const value of stream) values.push(value)
    expect(values).toEqual(['first', 'second'])
    expect(stream.locked).toBe(false)
    const cancel = vi.fn()
    const interrupted = new NodeStream({
      start(c) {
        c.enqueue('one')
      },
      cancel,
    })
    for await (const _value of interrupted) break
    expect(cancel).toHaveBeenCalledOnce()
    expect(interrupted.locked).toBe(false)
  } finally {
    Object.defineProperty(NodeStream.prototype, Symbol.asyncIterator, original)
  }
})
it('leaves the existing native iterator intact', () => {
  const original = NodeStream.prototype[Symbol.asyncIterator]
  installPdfStreamIterator(NodeStream as unknown as typeof ReadableStream)
  expect(NodeStream.prototype[Symbol.asyncIterator]).toBe(original)
})
it('falls back from CSS round() in the pinned PDF.js, and fails the build if that code changes', () => {
  const code = sizePagesWithoutRound(
    readFileSync('node_modules/pdfjs-dist/legacy/build/pdf.mjs', 'utf8'),
  )
  expect(code).toContain("CSS.supports('width', 'round(down, 1px, 1px)')")
  expect(code).toContain('`calc(var(--total-scale-factor) * ${pageHeight}px)`')
  expect(() => sizePagesWithoutRound('const widthStr = `round(down, 1px, 1px)`')).toThrow()
})
