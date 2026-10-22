/**
 * Notebook colors. Each preset has a light and a dark value at matched OKLCH lightness and
 * chroma, exposed as `--notebook-<id>` tokens in tokens.css. Notebooks store the preset's
 * light hex; hexes from the earlier palette and seed data map to the nearest preset.
 */
export const notebookColors = [
  { id: 'sage', label: 'Sage', light: '#688b60', dark: '#98bd90', legacy: ['#82936f'] },
  { id: 'slate', label: 'Slate', light: '#6282ad', dark: '#91b4e1', legacy: ['#7f93b5', '#899ab4'] },
  { id: 'lavender', label: 'Lavender', light: '#8b75a5', dark: '#bca5d8', legacy: ['#b08bc4'] },
  { id: 'clay', label: 'Clay', light: '#a37454', dark: '#d7a583', legacy: ['#c09a72', '#ba9775'] },
  { id: 'rose', label: 'Rose', light: '#a86e72', dark: '#dd9ea2', legacy: ['#d27d7d'] },
  { id: 'ochre', label: 'Ochre', light: '#957d4a', dark: '#c7ae7a', legacy: ['#d4a849'] },
  { id: 'teal', label: 'Teal', light: '#428e8e', dark: '#75c0c0', legacy: ['#5fa3a0'] },
  { id: 'gray', label: 'Gray', light: '#808080', dark: '#ababab', legacy: ['#8e8e93'] },
] as const

export type NotebookColor = (typeof notebookColors)[number]

export const defaultNotebookColor: string = notebookColors[0].light

const presets = new Map<string, NotebookColor>(
  notebookColors.flatMap((preset) => [
    [preset.light, preset],
    [preset.dark, preset],
    ...preset.legacy.map((hex) => [hex, preset] as const),
  ]),
)

export function notebookColorPreset(color?: string | null): NotebookColor | undefined {
  return color ? presets.get(color.toLowerCase()) : undefined
}

/** The value to store: a preset's light hex, or the custom hex unchanged. */
export function canonicalNotebookColor(color: string) {
  return notebookColorPreset(color)?.light ?? color
}

/**
 * The CSS color to paint a notebook with. Presets follow the color mode; custom colors are
 * pulled slightly toward the text color so saturated picks sit with the presets.
 */
export function notebookColorValue(color?: string | null) {
  if (!color) return undefined
  const preset = notebookColorPreset(color)
  if (preset) return `var(--notebook-${preset.id})`
  return `color-mix(in oklab, ${color} 82%, var(--text))`
}
