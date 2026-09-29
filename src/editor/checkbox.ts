/** Shared, font-independent checkbox artwork for task items and inline checks. */
export function checkboxGlyph() {
  const glyph = document.createElement('span')
  glyph.className = 'checkbox-glyph'
  glyph.setAttribute('aria-hidden', 'true')
  const box = document.createElement('span')
  box.className = 'checkbox-box'
  box.setAttribute('aria-hidden', 'true')
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  const path = document.createElementNS(svg.namespaceURI, 'path')
  path.setAttribute('d', 'M3.5 8.2 6.5 11 12.5 5')
  svg.append(path)
  box.append(svg)
  glyph.append(box)
  return glyph
}
