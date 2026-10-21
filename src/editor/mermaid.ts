import DOMPurify from 'dompurify'
import type { MermaidConfig } from 'mermaid'

let pending: Promise<unknown> = Promise.resolve()
let nextId = 0

function diagramTheme(element: HTMLElement): MermaidConfig {
  const style = getComputedStyle(element)
  const context = document.createElement('canvas').getContext('2d')
  if (context) {
    context.fillStyle = '#ffffff'
    context.fillStyle = style.getPropertyValue('--bg-content').trim() || '#ffffff'
  }
  const base = context?.fillStyle ?? '#ffffff'
  const color = (token: string, fallback: string) => {
    if (!context) return fallback
    // v2 roles are often translucent; composite over the opaque page surface.
    context.clearRect(0, 0, 1, 1)
    context.fillStyle = base
    context.fillRect(0, 0, 1, 1)
    context.fillStyle = fallback
    context.fillStyle = style.getPropertyValue(token).trim() || fallback
    context.fillRect(0, 0, 1, 1)
    return (
      '#' +
      [...context.getImageData(0, 0, 1, 1).data]
        .slice(0, 3)
        .map((value) => value.toString(16).padStart(2, '0'))
        .join('')
    )
  }
  const text = color('--text', '#333333')
  const surface = color('--bg-code', '#f4f4f4')
  const line = color('--text-3', '#777777')
  const accent = color('--link', '#666666')
  const fontFamily = style.fontFamily || 'sans-serif'
  return {
    theme: 'base',
    fontFamily,
    themeVariables: {
      darkMode: element.closest('[data-theme]')?.getAttribute('data-theme') === 'dark',
      background: surface,
      primaryColor: surface,
      primaryTextColor: text,
      primaryBorderColor: accent,
      secondaryColor: surface,
      secondaryTextColor: text,
      secondaryBorderColor: line,
      tertiaryColor: surface,
      tertiaryTextColor: text,
      tertiaryBorderColor: line,
      lineColor: line,
      textColor: text,
      mainBkg: surface,
      nodeBorder: accent,
      clusterBkg: surface,
      clusterBorder: line,
      edgeLabelBackground: surface,
      actorBkg: surface,
      actorTextColor: text,
      actorBorder: accent,
      actorLineColor: line,
      signalColor: text,
      signalTextColor: text,
      labelBoxBkgColor: surface,
      labelBoxBorderColor: line,
      labelTextColor: text,
      noteBkgColor: surface,
      noteTextColor: text,
      noteBorderColor: accent,
      fontFamily,
    },
  }
}

export function renderMermaid(source: string, element: HTMLElement): Promise<string> {
  // Mermaid has shared configuration. Keep initialize + render together so
  // simultaneous editors cannot change another diagram's theme mid-render.
  const result = pending.then(async () => {
    const { default: mermaid } = await import('mermaid')
    mermaid.initialize({
      ...diagramTheme(element),
      startOnLoad: false,
      securityLevel: 'strict',
      htmlLabels: false,
      suppressErrorRendering: true,
      secure: [
        'secure',
        'securityLevel',
        'startOnLoad',
        'maxTextSize',
        'maxEdges',
        'suppressErrorRendering',
        'htmlLabels',
        'fontFamily',
        'theme',
        'themeVariables',
      ],
    })
    const { svg } = await mermaid.render(`stash-mermaid-${++nextId}`, source)
    // Keep the preview inert even if a diagram includes links or image nodes.
    return DOMPurify.sanitize(svg, {
      USE_PROFILES: { svg: true, svgFilters: true },
      ADD_TAGS: ['style'],
      FORBID_TAGS: ['foreignObject', 'a', 'image'],
    })
  })
  pending = result.catch(() => {})
  return result
}
