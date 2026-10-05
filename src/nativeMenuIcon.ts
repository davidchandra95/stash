import { createElement } from 'react'
import type { IconComponent } from './icons'

const images = new WeakMap<IconComponent, Promise<string>>()

/** Rasterize Lucide once per component, at 3x the native menu's 16-point size. */
export function nativeMenuIcon(Icon: IconComponent): Promise<string> {
  const cached = images.get(Icon)
  if (cached) return cached
  const pending = Promise.resolve().then(async () => {
    const { renderToStaticMarkup } = await import('react-dom/server.browser')
    const svg = renderToStaticMarkup(createElement(Icon, { size: 48, color: '#000000' }))
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('Could not load Lucide menu SVG'))
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    })
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 48
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Could not create Lucide menu canvas')
    context.drawImage(image, 0, 0, 48, 48)
    const png = canvas.toDataURL('image/png')
    if (!png.startsWith('data:image/png;base64,'))
      throw new Error('Could not encode Lucide menu PNG')
    return png.slice('data:image/png;base64,'.length)
  })
  images.set(Icon, pending)
  // Failed conversions can be retried when the next menu opens.
  void pending.catch(() => images.delete(Icon))
  return pending
}
