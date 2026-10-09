// Synthetic data only: no native storage, linked folders, or application library.
import { createServer } from 'vite'
import { JSDOM } from 'jsdom'
import { performance } from 'node:perf_hooks'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir, cpus } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const cacheDir = await mkdtemp(join(tmpdir(), 'stash-note-bench-'))
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' })
for (const key of [
  'window',
  'document',
  'navigator',
  'location',
  'HTMLElement',
  'Element',
  'Node',
  'DOMParser',
  'MutationObserver',
  'getComputedStyle',
]) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true })
}

let server
let sink
function measure(run) {
  for (let i = 0; i < 8; i++) sink = run()
  const samples = []
  for (let i = 0; i < 40; i++) {
    const start = performance.now()
    sink = run()
    samples.push(performance.now() - start)
  }
  samples.sort((a, b) => a - b)
  return {
    samples: samples.length,
    medianMs: Number(samples[20].toFixed(3)),
    p95Ms: Number(samples[37].toFixed(3)),
  }
}
const document = (text) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})
try {
  server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    cacheDir,
    appType: 'custom',
    server: { middlewareMode: true, watch: null },
  })
  const { LibraryStore, defaultAppearance } = await server.ssrLoadModule('/src/storage/library.ts')
  const { serializeMarkdown } = await server.ssrLoadModule('/src/editor/markdown.ts')
  const result = {
    syntheticOnly: true,
    environment: { node: process.version, cpu: cpus()[0]?.model, arch: process.arch },
    libraries: [],
    markdown: [],
  }
  for (const count of [100, 1000, 5000, 10000]) {
    const notes = Array.from({ length: count }, (_, i) => ({
      id: `synthetic-${i}`,
      title: `Synthetic ${i}`,
      content: document('body'),
      text: 'body',
      notebookIds: [],
      quickAccess: false,
      tags: [],
      pinned: false,
      trashed: false,
      updated: 1,
      revision: 1,
      documentVersion: 1,
    }))
    let saves = 0
    const store = new LibraryStore({
      open: async () => ({
        notes: notes.map(({ content, ...summary }) => summary),
        notebooks: [],
        appearance: defaultAppearance,
        preferencesRevision: 1,
        path: 'synthetic-only',
      }),
      load: async (id) => notes.find((note) => note.id === id),
      saveNote: async (input) => {
        saves++
        return { revision: Number(input.expectedRevision) + 1, updated: 2 }
      },
      savePreferences: async () => ({ revision: 2, updated: 2 }),
      quit: async () => {},
    })
    await store.open()
    const id = notes[Math.floor(count / 2)].id
    await store.load(id)
    let version = 0
    const patch = () => {
      const text = `synthetic edit ${version++}`
      return { content: document(text), text, updated: version }
    }
    const setNotes = measure(() => {
      const change = patch()
      store.setNotes((old) => old.map((note) => (note.id === id ? { ...note, ...change } : note)))
    })
    await store.flush()
    const patchNote = measure(() => store.patchNote(id, patch()))
    await store.flush()
    result.libraries.push({ notes: count, setNotes, patchNote, acknowledgedSaves: saves })
  }
  for (const [paragraphs, spans, chars] of [
    [100, 1, 100],
    [1000, 1, 100],
    [10000, 1, 100],
    [10000, 4, 25],
  ]) {
    const content = {
      type: 'doc',
      content: Array.from({ length: paragraphs }, () => ({
        type: 'paragraph',
        content: Array.from({ length: spans }, (_, i) => ({
          type: 'text',
          text: 'x'.repeat(chars),
          ...(i % 2 ? { marks: [{ type: 'bold' }] } : {}),
        })),
      })),
    }
    result.markdown.push({
      paragraphs,
      textNodes: paragraphs * spans,
      characters: paragraphs * spans * chars,
      serializeMarkdown: measure(() => serializeMarkdown(content)),
    })
  }
  console.log(JSON.stringify(result, null, 2))
} finally {
  await server?.close()
  dom.window.close()
  await rm(cacheDir, { recursive: true, force: true })
}
