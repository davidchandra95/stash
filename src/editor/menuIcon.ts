const paths: Record<string, string> = {
  drawing: 'm16 3 5 5-12 12-6 1 1-6zM14 5l5 5',
  heading: 'M5 4v16M19 4v16M5 12h14',
  paragraph: 'M13 20V4H9a4 4 0 0 0 0 8h4M17 4v16',
  bold: 'M6 4h7a4 4 0 0 1 0 8H6zm0 8h8a4 4 0 0 1 0 8H6z',
  italic: 'M10 4h9M5 20h9M15 4 9 20',
  underline: 'M6 4v7a6 6 0 0 0 12 0V4M4 21h16',
  strike: 'M5 12h14M17 5c-7-4-13 2-7 5M7 18c6 4 13-2 7-5',
  subscript: 'm5 5 8 11M13 5 5 16M17 16c4-2 5 2 0 5h5',
  superscript: 'm5 8 8 12M13 8 5 20M17 3c4-2 5 2 0 5h5',
  color: 'm5 17 7-13 7 13M8 13h8M4 21h16',
  highlight: 'm8 14 6-10 6 4-6 10zM8 14l-3 5 7-1M4 22h16',
  bullet: 'M9 6h12M9 12h12M9 18h12M3 6h.01M3 12h.01M3 18h.01',
  number: 'M10 6h11M10 12h11M10 18h11M3 3h2v6M3 12c4-2 4 1 0 5h3',
  task: 'M4 4h16v16H4zM7 12l3 3 7-7',
  indent: 'M11 5h10M11 12h10M11 19h10m-8-10 4 3-4 3',
  outdent: 'M11 5h10M11 12h10M11 19h10m-4-10-4 3 4 3',
  align: 'M4 5h16M4 10h10M4 15h16M4 20h10',
  table: 'M3 4h18v16H3zM3 10h18M10 4v16',
  date: 'M4 5h16v16H4zM8 3v4M16 3v4M4 10h16',
  time: 'M12 3a9 9 0 1 0 .01 0M12 7v5l4 2',
  divider: 'M4 12h16',
  section: 'M3 4h18v16H3zM3 10h18m3-5 3 2-3 2',
  quote: 'M4 6h6v7H4v-7m6 7c0 4-3 5-5 5M14 6h6v7h-6v-7m6 7c0 4-3 5-5 5',
  code: 'm8 7-5 5 5 5m8-10 5 5-5 5',
  'code-block': 'M3 3h18v18H3zm5 5-3 4 3 4m8-8 3 4-3 4',
  link: 'm10 13 4-4M8 15l-2 2a4 4 0 0 1-5-5l4-4a4 4 0 0 1 5 0m4 1 2-2a4 4 0 0 1 5 5l-4 4a4 4 0 0 1-5 0',
  image: 'M3 4h18v16H3zm0 12 6-6 7 10m-2-4 3-3 4 4',
  chevron: 'm9 6 6 6-6 6',
  back: 'm15 6-6 6 6 6',
}
export function menuIcon(name: string) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  svg.classList.add('slash-icon')
  const path = document.createElementNS(svg.namespaceURI, 'path')
  path.setAttribute('d', paths[name] ?? paths.paragraph)
  svg.append(path)
  return svg
}
