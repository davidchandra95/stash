// The viewer module expects the core PDF.js global to be initialized first.
import 'pdfjs-dist/legacy/build/pdf.mjs'
import { PDFFindController } from 'pdfjs-dist/legacy/web/pdf_viewer.mjs'

export type PdfSearchResult = {
  pageIndex: number
  matchIndex: number
  before: string
  text: string
  after: string
}

// Keep PDF.js integration here: snippets use its normalized matcher, while navigation
// uses its search cursor so highlights and subsequent next/previous stay in sync.
export class PdfFindController extends PDFFindController {
  results: PdfSearchResult[][] = []

  override match(query: string | string[], content: string, pageIndex: number) {
    const matches = super.match(query, content, pageIndex)
    this.results[pageIndex] = (matches ?? [])
      .filter(({ index, length }) => hasOriginalText(this._pageDiffs[pageIndex], index, length))
      .map(({ index, length }, matchIndex) => ({
        pageIndex,
        matchIndex,
        before: `${index > 65 ? '…' : ''}${content.slice(Math.max(0, index - 65), index)}`,
        text: content.slice(index, index + length),
        after: `${content.slice(index + length, index + length + 85)}${index + length + 85 < content.length ? '…' : ''}`,
      }))
    return matches
  }

  prepareSelection(pageIndex: number, matchIndex: number) {
    if (
      this._dirtyMatch ||
      (!this.pageMatches?.[pageIndex]?.[matchIndex] &&
        this.pageMatches?.[pageIndex]?.[matchIndex] !== 0)
    )
      return false
    // PDF.js 6.4 exposes no direct result-selection method. Position its cursor one
    // match before the target, then let the normal "again" command select it.
    Object.assign(this._offset!, { pageIdx: pageIndex, matchIdx: matchIndex - 1, wrapped: false })
    this._resumePageIdx = null
    return true
  }
}

// Normalization can insert characters with no source text. PDF.js drops those
// matches; apply the same offset mapping so snippet indexes stay aligned.
function hasOriginalText(diffs: [Uint32Array, Int32Array] | null, index: number, length: number) {
  if (!diffs) return length > 0
  const [starts, shifts] = diffs
  const shiftAt = (position: number) => {
    let low = 0,
      high = starts.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (starts[middle] <= position) low = middle + 1
      else high = middle
    }
    return shifts[Math.max(0, low - 1)]
  }
  return length + shiftAt(index + length - 1) - shiftAt(index) > 0
}
