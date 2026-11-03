import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'
/**
 * PDF.js sizes pages with CSS round(), which Android System WebView lacks before Chrome 125. There
 * a page collapses to zero height, so use the same size without snapping it to whole pixels.
 */
export function sizePagesWithoutRound(code: string) {
  let replaced = 0
  const next = code.replace(
    /`round\(down, (var\(--total-scale-factor\) \* \$\{page(?:Width|Height)\}px), var\(--scale-round-[xy]\)\)`/g,
    (round, size) => {
      replaced++
      return `(CSS.supports('width', 'round(down, 1px, 1px)') ? ${round} : \`calc(${size})\`)`
    },
  )
  if (replaced !== 2) throw Error('PDF.js page sizing changed. Review sizePagesWithoutRound.')
  return next
}
/** Serve and emit the exact assets shipped with the pinned renderer, without a CDN. */
export function pdfAssets(): Plugin {
  const assets = new Map<string, Buffer>()
  const visit = (directory: string, prefix: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name)
      const name = `${prefix}/${entry.name}`
      if (entry.isDirectory()) visit(path, name)
      else assets.set(name, readFileSync(path))
    }
  }
  for (const name of ['cmaps', 'standard_fonts', 'wasm', 'iccs', 'web/images']) {
    visit(resolve('node_modules/pdfjs-dist', name), `pdfjs/${name.replace('web/', '')}`)
  }
  return {
    name: 'local-pdf-assets',
    enforce: 'pre',
    transform(code, id) {
      if (id.split('?')[0].endsWith('/pdfjs-dist/legacy/web/pdf_viewer.css')) {
        // PDF.js also ships generic .sidebar and button styles. Contain all of them.
        return { code: `.pdf-reader {\n${code.replaceAll(':root', '&')}\n}`, map: null }
      }
      if (id.split('?')[0].endsWith('/pdfjs-dist/legacy/build/pdf.mjs'))
        return { code: sizePagesWithoutRound(code), map: null }
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = req.url?.split('?')[0].slice(1) ?? ''
        const bytes = assets.get(name)
        if (!bytes) return next()
        res.setHeader(
          'Content-Type',
          name.endsWith('.wasm')
            ? 'application/wasm'
            : name.endsWith('.svg')
              ? 'image/svg+xml'
              : 'application/octet-stream',
        )
        res.end(bytes)
      })
    },
    generateBundle() {
      for (const [fileName, source] of assets) this.emitFile({ type: 'asset', fileName, source })
    },
  }
}
