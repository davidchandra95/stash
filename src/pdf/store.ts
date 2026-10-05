import { invoke, isTauri } from '@tauri-apps/api/core'
import { useEffect, useSyncExternalStore } from 'react'
import { initialReading, type PdfDocument, type PdfReading, type PdfSource } from './model'

/** One ordered writer. Failed values stay pending, and retry always writes the newest value. */
export class ReadingQueue {
  private pending = new Map<string, PdfReading>()
  private running: Promise<void> | undefined
  constructor(private write: (id: string, reading: PdfReading) => Promise<void>) {}
  set(id: string, reading: PdfReading) {
    this.pending.set(id, reading)
  }
  flush(): Promise<void> {
    if (this.running) return this.running.then(() => this.flush())
    this.running = this.drain().finally(() => {
      this.running = undefined
    })
    return this.running
  }
  private async drain() {
    while (this.pending.size) {
      const [id, reading] = this.pending.entries().next().value!
      await this.write(id, reading)
      if (this.pending.get(id) === reading) this.pending.delete(id)
    }
  }
}
const native = isTauri()
const files = new Map<string, File>()
let snapshot: { documents: PdfDocument[]; ready: boolean; error: string; savingError: string } = {
  documents: [],
  ready: !native,
  error: '',
  savingError: '',
}
const listeners = new Set<() => void>()
const publish = (patch: Partial<typeof snapshot>) => {
  snapshot = { ...snapshot, ...patch }
  listeners.forEach((listener) => listener())
}
let opening: Promise<void> | undefined
let timer: ReturnType<typeof setTimeout> | undefined
const captures = new Set<() => void>()
const queue = new ReadingQueue(async (id, reading) => {
  if (native) await invoke('save_pdf_reading', { id, reading })
})
export const pdfStore = {
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  getSnapshot: () => snapshot,
  async open() {
    if (!native || snapshot.ready) return
    if (!opening)
      opening = invoke<PdfDocument[]>('list_pdfs')
        .then(
          (documents) => publish({ documents, ready: true, error: '' }),
          (error) => publish({ error: String(error) }),
        )
        .finally(() => {
          opening = undefined
        })
    await opening
  },
  async import(source: string | File): Promise<PdfDocument> {
    let doc: PdfDocument
    if (typeof source === 'string') doc = await invoke('import_pdf', { path: source })
    else {
      const bytes = await source.arrayBuffer()
      if (!new TextDecoder().decode(bytes.slice(0, 1024)).includes('%PDF-'))
        throw Error('This file is not a PDF.')
      const fingerprint = Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
        (n) => n.toString(16).padStart(2, '0'),
      ).join('')
      const existing = snapshot.documents.find((d) => d.fingerprint === fingerprint)
      if (existing) return existing
      doc = {
        id: crypto.randomUUID(),
        name: source.name,
        fingerprint,
        size: source.size,
        imported: Date.now(),
        unavailable: false,
        reading: initialReading(),
      }
      files.set(doc.id, source)
    }
    publish({ documents: [doc, ...snapshot.documents.filter((d) => d.id !== doc.id)], error: '' })
    return doc
  },
  source(doc: PdfDocument): PdfSource {
    return {
      id: doc.id,
      size: doc.size,
      async read(begin, end) {
        if (native) {
          const chunks: Uint8Array[] = []
          for (let offset = begin; offset < end; offset += 1024 * 1024) {
            const result = await invoke<ArrayBuffer>('read_pdf_range', {
              id: doc.id,
              begin: offset,
              end: Math.min(end, offset + 1024 * 1024),
            })
            chunks.push(new Uint8Array(result))
          }
          const bytes = new Uint8Array(end - begin)
          let offset = 0
          for (const chunk of chunks) {
            bytes.set(chunk, offset)
            offset += chunk.length
          }
          return bytes
        }
        const file = files.get(doc.id)
        if (!file) throw Error('This browser preview file is no longer available. Open it again.')
        return new Uint8Array(await file.slice(begin, end).arrayBuffer())
      },
    }
  },
  capture(callback: () => void) {
    captures.add(callback)
    return () => {
      captures.delete(callback)
    }
  },
  reading(id: string, reading: PdfReading) {
    // Avoid rerendering the whole workspace for every scroll event.
    const doc = snapshot.documents.find((d) => d.id === id)
    if (doc) doc.reading = reading
    queue.set(id, reading)
    clearTimeout(timer)
    timer = setTimeout(() => {
      void pdfStore.flush().catch(() => {})
    }, 350)
  },
  async flush() {
    captures.forEach((capture) => capture())
    clearTimeout(timer)
    try {
      await queue.flush()
      if (snapshot.savingError) publish({ savingError: '' })
    } catch (error) {
      publish({ savingError: `Could not save PDF reading position: ${String(error)}` })
      throw error
    }
  },
}
export function usePdfs(libraryReady: boolean) {
  const state = useSyncExternalStore(pdfStore.subscribe, pdfStore.getSnapshot)
  useEffect(() => {
    if (libraryReady) void pdfStore.open()
  }, [libraryReady])
  return state
}
