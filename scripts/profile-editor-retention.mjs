// Synthetic documents and a mocked disk only. Never opens the native library.
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('..', import.meta.url))
const dir = await mkdtemp(join(tmpdir(), 'stash-editor-retention-'))
const output = process.argv[2] ?? join(dir, 'results.json')
const html = `<!doctype html><html><head><title>Synthetic editor lifecycle</title></head><body><div id="host"></div><script type="module">
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { EditorContent } from '@tiptap/react';
import * as sessions from '/src/editor/session.ts';
import { LibraryStore } from '/src/storage/library.ts';
import { undoDepth, redoDepth, closeHistory } from '@tiptap/pm/history';
window.harness={React,createRoot,flushSync,EditorContent,sessions,LibraryStore,undoDepth,redoDepth,closeHistory};
</script></body></html>`
const server = await createServer({
  logLevel: 'error',
  root,
  cacheDir: dir + '/vite-cache',
  server: { hmr: false, watch: null, host: '127.0.0.1', port: 1446, strictPort: true },
  plugins: [
    {
      name: 'synthetic-lifecycle-page',
      configureServer(s) {
        s.middlewares.use(async (req, res, next) => {
          if (req.url?.split('?')[0] !== '/__lifecycle.html') return next()
          try {
            res.setHeader('Content-Type', 'text/html')
            res.end(await s.transformIndexHtml('/__lifecycle.html', html))
          } catch (e) {
            res.statusCode = 500
            res.end(String(e))
          }
        })
      },
    },
  ],
})
let browser
try {
  await server.listen()
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.addInitScript(() => {
    const timeouts = new Set(),
      intervals = new Set(),
      observers = {}
    const setTimeout = window.setTimeout.bind(window),
      clearTimeout = window.clearTimeout.bind(window)
    const setInterval = window.setInterval.bind(window),
      clearInterval = window.clearInterval.bind(window)
    window.setTimeout = (callback, delay, ...args) => {
      let id
      id = setTimeout(() => {
        timeouts.delete(id)
        callback(...args)
      }, delay)
      timeouts.add(id)
      return id
    }
    window.setInterval = (callback, delay, ...args) => {
      const id = setInterval(callback, delay, ...args)
      intervals.add(id)
      return id
    }
    window.clearTimeout = (id) => {
      timeouts.delete(id)
      intervals.delete(id)
      clearTimeout(id)
    }
    window.clearInterval = (id) => {
      intervals.delete(id)
      timeouts.delete(id)
      clearInterval(id)
    }
    for (const name of ['MutationObserver', 'ResizeObserver', 'IntersectionObserver']) {
      const Original = window[name]
      if (!Original) continue
      const active = new Set()
      observers[name] = active
      window[name] = class extends Original {
        observe(...args) {
          super.observe(...args)
          active.add(this)
        }
        disconnect() {
          active.delete(this)
          super.disconnect()
        }
      }
    }
    window.retentionResources = () => ({
      timeouts: timeouts.size,
      intervals: intervals.size,
      observers: Object.fromEntries(
        Object.entries(observers).map(([name, active]) => [name, active.size]),
      ),
    })
  })
  page.on('framenavigated', (f) => console.log('NAVIGATION', f.url()))
  page.on('pageerror', (e) => console.error('PAGEERROR', e.message))
  await page.goto('http://127.0.0.1:1446/__lifecycle.html')
  await page.waitForFunction(() => !!window.harness, { timeout: 30000 })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Performance.enable')
  const measure = async (label) => {
    await cdp.send('HeapProfiler.collectGarbage')
    const { metrics } = await cdp.send('Performance.getMetrics')
    const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]))
    const docObject = await cdp.send('Runtime.evaluate', {
      expression: 'document',
      objectGroup: 'listener-count',
    })
    const winObject = await cdp.send('Runtime.evaluate', {
      expression: 'window',
      objectGroup: 'listener-count',
    })
    const docListeners = await cdp.send('DOMDebugger.getEventListeners', {
      objectId: docObject.result.objectId,
    })
    const winListeners = await cdp.send('DOMDebugger.getEventListeners', {
      objectId: winObject.result.objectId,
    })
    const counts = (items) =>
      items.reduce((acc, x) => {
        acc[x.type] = (acc[x.type] ?? 0) + 1
        return acc
      }, {})
    const globals = {
      document: counts(docListeners.listeners),
      window: counts(winListeners.listeners),
    }
    await cdp.send('Runtime.releaseObjectGroup', { objectGroup: 'listener-count' })
    const row = {
      label,
      resources: await page.evaluate(() => window.retentionResources()),
      globalEvents: globals,
      heapMiB: Math.round((m.JSHeapUsedSize / 1048576) * 100) / 100,
      domNodes: m.Nodes,
      eventListeners: m.JSEventListeners,
    }
    console.log(JSON.stringify(row))
    return row
  }
  await page.evaluate(() => {
    const h = window.harness
    window.synthetic = {
      root: h.createRoot(document.getElementById('host')),
      ids: [],
      timings: [],
      changes: 0,
    }
    for (let i = 0; i < 3; i++)
      h.sessions.getEditor('warm-' + i, {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'warm' }] }],
      })
    h.sessions.clearSessions()
  })
  const rows = [await measure('warm baseline')]
  for (const limit of [10, 50, 100, 200]) {
    const detail = await page.evaluate(async (limit) => {
      const h = window.harness,
        s = window.synthetic
      for (let i = s.ids.length; i < limit; i++) {
        const id = 'synthetic-' + i
        const content = {
          type: 'doc',
          content: Array.from({ length: 100 }, (_, p) => ({
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'note ' + i + ' paragraph ' + p + ' ' + 'ordinary text '.repeat(8),
              },
            ],
          })),
        }
        const begin = performance.now()
        const e = h.sessions.getEditor(id, content, () => {
          s.changes++
        })
        h.flushSync(() => s.root.render(h.React.createElement(h.EditorContent, { editor: e })))
        // One undoable transaction, then the same deactivation event used by NoteEditor.
        e.commands.insertContent('edited ')
        e.commands.setTextSelection(4)
        e.view.dom.dispatchEvent(new Event('writing-deactivate'))
        s.timings.push(performance.now() - begin)
        s.ids.push(id)
        if (i % 10 === 0) await new Promise((r) => setTimeout(r, 0))
      }
      h.flushSync(() => s.root.render(null))
      await new Promise((r) => setTimeout(r, 40))
      const restored = h.sessions.getEditor('synthetic-0', {
        type: 'doc',
        content: [{ type: 'paragraph' }],
      })
      await new Promise((r) => setTimeout(r, 0))
      return {
        visited: s.ids.length,
        firstNoteRetained: restored.getText().startsWith('edited '),
        firstSelection: restored.state.selection.from,
        firstUndoDepth: h.undoDepth(restored.state),
        detached: !restored.view.dom.isConnected,
        ...h.sessions.getSessionStats(),
      }
    }, limit)
    console.log(JSON.stringify(detail))
    rows.push({ ...(await measure('visited ' + limit)), ...detail })
  }
  await page.evaluate(() => {
    window.harness.sessions.clearSessions()
    window.synthetic.root.unmount()
    window.synthetic = null
  })
  rows.push(await measure('after clearSessions'))
  await page.evaluate(() => {
    const h = window.harness
    const make = (id) => ({
      id,
      title: id,
      notebookIds: [],
      quickAccess: false,
      tags: [],
      pinned: false,
      trashed: false,
      text: 'summary ' + id,
      updated: 1,
      revision: 1,
      documentVersion: 1,
      content: {
        type: 'doc',
        content: Array.from({ length: 100 }, (_, p) => ({
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'note ' + id + ' paragraph ' + p + ' ' + 'ordinary text '.repeat(8),
            },
          ],
        })),
      },
    })
    window.synthetic = {
      root: h.createRoot(document.getElementById('host')),
      count: 0,
      make,
      store: new h.LibraryStore({
        open: async () => ({
          notes: Array.from({ length: 10000 }, (_, i) => {
            const { content, ...summary } = make('clean-' + i)
            return summary
          }),
          notebooks: [],
          appearance: null,
          preferencesRevision: 0,
          path: 'synthetic',
        }),
        load: async (id) => make(id),
        saveNote: async () => ({ revision: 2, updated: 2 }),
        savePreferences: async () => ({ revision: 1, updated: 2 }),
        quit: async () => {},
      }),
    }
    window.synthetic.unsubscribe = window.synthetic.store.subscribe(() => {})
  })
  await page.evaluate(() => window.synthetic.store.open())
  for (const limit of [1000, 10000]) {
    const detail = await page.evaluate(async (limit) => {
      const h = window.harness,
        s = window.synthetic
      for (let i = s.count; i < limit; i++) {
        const id = 'clean-' + i
        await s.store.load(id)
        const content = s.store.getSnapshot().notes.find((n) => n.id === id).content
        const e = h.sessions.getEditor(id, content)
        h.flushSync(() => s.root.render(h.React.createElement(h.EditorContent, { editor: e })))
        if (i % 10 === 0) await new Promise((r) => setTimeout(r, 0))
      }
      s.count = limit
      h.flushSync(() => s.root.render(null))
      await new Promise((r) => setTimeout(r, 50))
      return {
        visited: limit,
        ...h.sessions.getSessionStats(),
        loadedBodies: s.store.getSnapshot().loaded.size,
      }
    }, limit)
    rows.push({ ...(await measure('clean saved notes ' + limit)), ...detail })
    console.log(JSON.stringify(detail))
  }
  const cycles = await page.evaluate(async () => {
    const h = window.harness,
      s = window.synthetic
    for (let i = 0; i < 100; i++) {
      const id = 'clean-' + (i % 12)
      await s.store.load(id)
      const e = h.sessions.getEditor(
        id,
        s.store.getSnapshot().notes.find((n) => n.id === id).content,
      )
      h.flushSync(() => s.root.render(h.React.createElement(h.EditorContent, { editor: e })))
      await new Promise((r) => setTimeout(r, 0))
    }
    h.flushSync(() => s.root.render(null))
    await new Promise((r) => setTimeout(r, 50))
    return { ...h.sessions.getSessionStats(), loadedBodies: s.store.getSnapshot().loaded.size }
  })
  rows.push({ ...(await measure('100 repeated clean switch cycles')), ...cycles })
  await page.evaluate(() => {
    window.harness.sessions.clearSessions()
    window.synthetic.root.unmount()
    window.synthetic.unsubscribe()
    window.synthetic = null
  })
  const behavior = await page.evaluate(() => {
    const h = window.harness,
      e = h.sessions.getEditor('suspend-probe', { type: 'doc', content: [{ type: 'paragraph' }] })
    e.commands.insertContent('unsaved probe')
    e.commands.setTextSelection(4)
    const before = {
      selection: e.state.selection.from,
      undo: h.undoDepth(e.state),
      text: e.getText(),
    }
    e.unmount()
    const suspended = {
      isDestroyed: e.isDestroyed,
      selection: e.state.selection.from,
      undo: h.undoDepth(e.state),
      text: e.getText(),
    }
    let resumed = null,
      error = null
    try {
      e.mount(document.createElement('div'))
      resumed = { selection: e.state.selection.from, undo: h.undoDepth(e.state), text: e.getText() }
    } catch (failure) {
      error = String(failure)
    }
    h.sessions.clearSessions()
    return { before, suspended, resumed, error }
  })
  console.log(JSON.stringify({ behavior }))
  const result = {
    kind: 'synthetic Chromium development modules, actual session registry plus EditorContent mounts',
    chromium: browser.version(),
    fixture:
      '100 paragraphs per note, about 13 KB text, one edit, one selection, actual React EditorContent mount then detach',
    rows,
    behavior,
  }
  for (const row of rows) {
    if (row.liveViews > 4 || (row.loadedBodies ?? 0) > 32)
      throw Error('Retention exceeded a settled budget: ' + row.label)
    if (
      row.firstNoteRetained === false ||
      (row.firstUndoDepth !== undefined && row.firstUndoDepth !== 1)
    )
      throw Error('Edited session state was lost: ' + row.label)
  }
  if (behavior.error || JSON.stringify(behavior.before) !== JSON.stringify(behavior.resumed))
    throw Error('Editor remount changed the retained document or selection')
  const settled = rows.filter((row) => row.loadedBodies !== undefined)
  if (
    settled.some(
      (row) =>
        JSON.stringify(row.resources.observers) !==
          JSON.stringify(settled[0].resources.observers) ||
        row.resources.intervals !== settled[0].resources.intervals,
    )
  )
    throw Error('Observers or interval timers accumulated during clean navigation')
  await writeFile(output, JSON.stringify(result, null, 2))
  console.log('Results: ' + output)
} finally {
  await browser?.close()
  await server.close()
}
