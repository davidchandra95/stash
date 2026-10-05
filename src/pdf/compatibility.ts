/** PDF.js 6 uses for-await on native streams, which older WKWebViews lack.
 * Add only the missing iterator; retain the browser's stream and backpressure.
 */
export function installPdfStreamIterator(streamClass: typeof ReadableStream = ReadableStream) {
  if (Symbol.asyncIterator in streamClass.prototype) return
  Object.defineProperty(streamClass.prototype, Symbol.asyncIterator, {
    configurable: true,
    writable: true,
    value: async function* (this: ReadableStream<unknown>) {
      const reader = this.getReader()
      let completed = false
      try {
        while (true) {
          const result = await reader.read()
          if (result.done) {
            completed = true
            return
          }
          yield result.value
        }
      } finally {
        try {
          if (!completed) await reader.cancel()
        } finally {
          reader.releaseLock()
        }
      }
    },
  })
}
