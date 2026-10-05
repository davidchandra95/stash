export type PdfReading = {
  page: number
  x: number
  y: number
  zoom: 'page' | 'height' | 'width' | number
}
export type PdfDocument = {
  id: string
  name: string
  fingerprint: string
  size: number
  imported: number
  unavailable: boolean
  reading: PdfReading
}
export const initialReading = (): PdfReading => ({ page: 1, x: 0, y: 0, zoom: 'width' })
export interface PdfSource {
  id: string
  size: number
  read(begin: number, end: number): Promise<Uint8Array>
}
export type PdfNavigation = {
  page: number
  x?: number
  y?: number
  requestId?: string
  regions?: import('./citations').PdfRegion[]
}
