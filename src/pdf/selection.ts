import type { PDFViewer } from 'pdfjs-dist/legacy/web/pdf_viewer.mjs'
import type { PdfRegion, PdfSelection } from './citations'

/** Read the selected text nodes, not element rectangles that include unselected page space. */
export function readPdfSelection(
  selection: Selection | null,
  host: HTMLElement,
  viewer: PDFViewer,
): PdfSelection | null {
  if (!selection?.rangeCount || selection.isCollapsed) return null
  const range = selection.getRangeAt(0)
  if (!host.contains(range.startContainer) || !host.contains(range.endContainer)) return null
  const regions: PdfRegion[] = []
  for (const layer of host.querySelectorAll<HTMLElement>('.textLayer')) {
    const pageElement = layer.closest<HTMLElement>('[data-page-number]')!
    const page = Number(pageElement.dataset.pageNumber)
    const pageView = viewer.getPageView(page - 1)
    if (!pageView || !range.intersectsNode(layer)) continue
    const origin = pageElement.getBoundingClientRect()
    const viewport = pageView.viewport
    const factorX = viewport.width / origin.width,
      factorY = viewport.height / origin.height
    const rects: PdfRegion['rects'] = []
    const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT)
    let node: Node | null
    while ((node = walker.nextNode())) {
      if (!range.intersectsNode(node) || !node.textContent?.length) continue
      const part = document.createRange()
      part.selectNodeContents(node)
      if (node === range.startContainer) part.setStart(node, range.startOffset)
      if (node === range.endContainer) part.setEnd(node, range.endOffset)
      if (part.collapsed) continue
      for (const rect of part.getClientRects()) {
        if (rect.width < 0.1 || rect.height < 0.1) continue
        const a = viewport.convertToPdfPoint(
          (rect.left - origin.left) * factorX,
          (rect.top - origin.top) * factorY,
        )
        const b = viewport.convertToPdfPoint(
          (rect.right - origin.left) * factorX,
          (rect.bottom - origin.top) * factorY,
        )
        rects.push(
          [
            Math.min(a[0], b[0]),
            Math.min(a[1], b[1]),
            Math.max(a[0], b[0]),
            Math.max(a[1], b[1]),
          ].map((n) => Math.round(n * 1000) / 1000) as PdfRegion['rects'][number],
        )
      }
    }
    if (rects.length) regions.push({ page, rects })
  }
  return regions.length && selection.toString().trim()
    ? { text: selection.toString(), regions }
    : null
}
