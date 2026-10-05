import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'

/** Fonts are served from the installed, pinned package in dev and packaged builds. */
export function drawingAssets(): Plugin {
  const assets = new Map<string, Buffer>()
  const visit = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name),
        name = `${prefix}/${entry.name}`
      if (entry.isDirectory()) visit(path, name)
      else assets.set(name, readFileSync(path))
    }
  }
  visit(resolve('node_modules/@excalidraw/excalidraw/dist/prod/fonts'), 'drawing/fonts')
  return {
    name: 'local-drawing-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const bytes = assets.get(req.url?.split('?')[0].slice(1) ?? '')
        if (!bytes) return next()
        res.setHeader('Content-Type', 'font/woff2')
        res.end(bytes)
      })
    },
    generateBundle() {
      for (const [fileName, source] of assets) this.emitFile({ type: 'asset', fileName, source })
    },
  }
}
