// A DOM text rectangle includes the font's internal leading. Its center need
// not match the visible letters (particularly with Sofia Pro).
export class CursorMetrics {
  private key = ''
  private value: {
    baseline: number
    capHeight: number
    textHeight: number
    lineBaseline: number
  } | null = null

  clear() {
    this.key = ''
    this.value = null
  }

  offset(source: Element, height: number): number {
    const document = source.ownerDocument
    const style = document.defaultView!.getComputedStyle(source)
    if (!(parseFloat(style.fontSize) > 0)) return 0
    const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
    const key = `${font}|${style.lineHeight}|${style.fontFeatureSettings}|${style.fontVariationSettings}`
    if (key !== this.key) {
      this.clear()
      const canvas = document.createElement('canvas')
      const context = canvas.getContext('2d')
      if (!context) return 0
      context.font = font
      // H is constant across typing and has neither accents nor descenders.
      // Preserve the existing caret height, centering it on the capital body.
      const capHeight = context.measureText('H').actualBoundingBoxAscent
      if (!(capHeight > 0)) return 0
      const probe = document.createElement('div')
      probe.style.cssText =
        'position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;white-space:pre;padding:0;border:0;margin:0;'
      probe.style.font = font
      probe.style.lineHeight = style.lineHeight
      probe.style.fontFeatureSettings = style.fontFeatureSettings
      probe.style.fontVariationSettings = style.fontVariationSettings
      const text = document.createTextNode('H')
      const baseline = document.createElement('span')
      baseline.style.cssText =
        'display:inline-block;width:0;height:0;padding:0;margin:0;border:0;vertical-align:baseline;'
      probe.append(text, baseline)
      document.body.append(probe)
      try {
        const range = document.createRange()
        range.selectNodeContents(text)
        const rect = range.getBoundingClientRect()
        const y = baseline.getBoundingClientRect().top
        if (!(rect.height > 0)) return 0
        this.value = {
          baseline: y - rect.top,
          capHeight,
          textHeight: rect.height,
          lineBaseline: y - probe.getBoundingClientRect().top,
        }
        this.key = key
      } finally {
        probe.remove()
      }
    }
    if (!this.value) return 0
    const metrics = this.value
    // Empty paragraphs can expose the full line box rather than a text rect.
    const baseline =
      Math.abs(height - metrics.textHeight) < 1 ? metrics.baseline : metrics.lineBaseline
    const offset = baseline - metrics.capHeight / 2 - height / 2
    return Number.isFinite(offset) ? offset : 0
  }
}
