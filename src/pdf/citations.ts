import type { JSONContent } from '@tiptap/core'
import type { PdfDocument } from './model'

export type PdfRegion = { page: number; rects: [number, number, number, number][] }
export type PdfCitation = {
  documentId: string
  fingerprint: string
  page: number
  regions?: PdfRegion[]
}
export type PdfSelection = { text: string; regions: PdfRegion[] }
export const isPdfLink = (href: string) => /^upnote2:\/\/pdf(?:[/?#]|$)/i.test(href)
const validPage = (n: unknown): n is number =>
  Number.isInteger(n) && Number(n) >= 1 && Number(n) <= 100000
export function validCitation(value: PdfCitation): boolean {
  return (
    /^[a-zA-Z0-9_-]{1,128}$/.test(value.documentId) &&
    /^[a-f0-9]{64}$/.test(value.fingerprint) &&
    validPage(value.page) &&
    (value.regions === undefined ||
      (Array.isArray(value.regions) &&
        value.regions.length > 0 &&
        value.regions.length <= 100 &&
        value.regions[0].page === value.page &&
        value.regions.every(
          (region, i, all) =>
            region &&
            validPage(region.page) &&
            (i === 0 || region.page > all[i - 1].page) &&
            Array.isArray(region.rects) &&
            region.rects.length > 0 &&
            region.rects.length <= 2000 &&
            region.rects.every(
              (r) =>
                Array.isArray(r) &&
                r.length === 4 &&
                r.every((v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e7) &&
                r[2] > r[0] &&
                r[3] > r[1],
            ),
        )))
  )
}
export function parsePdfCitation(href: string): PdfCitation | null {
  if (!isPdfLink(href) || href.length > 250000) return null
  try {
    const url = new URL(href)
    if (
      url.protocol !== 'upnote2:' ||
      url.host !== 'pdf' ||
      url.hash ||
      url.username ||
      url.password
    )
      return null
    const match = /^\/v1\/([a-zA-Z0-9_-]{1,128})$/.exec(url.pathname)
    if (
      !match ||
      [...url.searchParams.keys()].some(
        (k) =>
          !['fingerprint', 'page', 'regions'].includes(k) ||
          url.searchParams.getAll(k).length !== 1,
      )
    )
      return null
    if (!/^[1-9][0-9]*$/.test(url.searchParams.get('page') ?? '')) return null
    const citation: PdfCitation = {
      documentId: match[1],
      fingerprint: url.searchParams.get('fingerprint') ?? '',
      page: Number(url.searchParams.get('page')),
    }
    if (url.searchParams.has('regions'))
      citation.regions = JSON.parse(url.searchParams.get('regions')!)
    return validCitation(citation) ? citation : null
  } catch {
    return null
  }
}
export function pdfCitationHref(citation: PdfCitation): string {
  if (!validCitation(citation)) throw Error('This PDF citation has an invalid page or selection.')
  const query = new URLSearchParams({
    fingerprint: citation.fingerprint,
    page: String(citation.page),
  })
  if (citation.regions) query.set('regions', JSON.stringify(citation.regions))
  const href = `upnote2://pdf/v1/${citation.documentId}?${query}`
  if (href.length > 250000)
    throw Error('This selection is too large for one citation. Capture it in smaller parts.')
  return href
}
export function resolvePdfCitation(citation: PdfCitation, documents: PdfDocument[]) {
  const document =
    documents.find((d) => d.id === citation.documentId) ??
    documents.find((d) => d.fingerprint === citation.fingerprint)
  if (!document || document.unavailable)
    throw Error(
      'This PDF is unavailable on this device. Import its original PDF to use this citation.',
    )
  return { document, changed: document.fingerprint !== citation.fingerprint }
}
export function citationContent(citation: PdfCitation, text?: string): JSONContent[] {
  const last = citation.regions?.at(-1)?.page ?? citation.page
  const label = last === citation.page ? `(p. ${citation.page})` : `(pp. ${citation.page}–${last})`
  const link: JSONContent = {
    type: 'text',
    text: label,
    marks: [{ type: 'link', attrs: { href: pdfCitationHref(citation) } }],
  }
  if (text === undefined) {
    return [{ type: 'paragraph', content: [link] }, { type: 'paragraph' }]
  }
  const paragraphs: JSONContent[] = text.split(/\n\s*\n/).map((paragraph) => ({
    type: 'paragraph',
    content: paragraph
      .split('\n')
      .flatMap((line, i) => [
        ...(i ? [{ type: 'hardBreak' }] : []),
        ...(line ? [{ type: 'text', text: line }] : []),
      ]),
  }))
  paragraphs.at(-1)!.content!.push({ type: 'text', text: ' ' }, link)
  return [{ type: 'blockquote', content: paragraphs }, { type: 'paragraph' }]
}
