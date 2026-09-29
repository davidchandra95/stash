export type PaneWidths = {
  sidebar: number
  noteList: number
}

export type PaneKind = keyof PaneWidths

export const sidebarMinimumWidth = 144
export const noteListMinimumWidth = 200
export const writingMinimumWidth = 360
export const writingWithContentsMinimumWidth = 540
export const maximumStoredPaneWidth = 1200

export type PaneLayoutContext = {
  appWidth: number
  sidebarVisible: boolean
  contentsOpen: boolean
  contentsWidth?: number
  sidebarWidth: number
  noteListWidth: number
}

export type PaneBounds = Record<PaneKind, { min: number; max: number }>

const isStoredWidth = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= sidebarMinimumWidth &&
  value <= maximumStoredPaneWidth

export function normalizePaneWidths(value: unknown): PaneWidths | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Partial<PaneWidths>
  if (
    !isStoredWidth(candidate.sidebar) ||
    typeof candidate.noteList !== 'number' ||
    !Number.isInteger(candidate.noteList) ||
    candidate.noteList < noteListMinimumWidth ||
    candidate.noteList > maximumStoredPaneWidth
  )
    return undefined
  return { sidebar: candidate.sidebar, noteList: candidate.noteList }
}

export function clamp(value: number, { min, max }: { min: number; max: number }) {
  return Math.min(Math.max(value, min), max)
}

export function paneBounds({
  appWidth,
  sidebarVisible,
  contentsOpen,
  contentsWidth,
  sidebarWidth,
  noteListWidth,
}: PaneLayoutContext): PaneBounds {
  const writingMinimum = contentsOpen
    ? writingWithContentsMinimumWidth + (contentsWidth ?? 260) - 260
    : writingMinimumWidth
  const sidebarSpace = sidebarVisible ? sidebarWidth : 0
  return {
    sidebar: {
      min: sidebarMinimumWidth,
      max: Math.max(sidebarMinimumWidth, appWidth - noteListWidth - writingMinimum),
    },
    noteList: {
      min: noteListMinimumWidth,
      max: Math.max(noteListMinimumWidth, appWidth - sidebarSpace - writingMinimum),
    },
  }
}

/**
 * Render saved targets within the current window without replacing those targets.
 * If the window later becomes wider, its original saved layout can return.
 */
export function effectivePaneWidths(widths: PaneWidths, context: PaneLayoutContext): PaneWidths {
  if (context.appWidth <= 0) return widths
  const sidebar = clamp(
    widths.sidebar,
    paneBounds({ ...context, sidebarWidth: widths.sidebar }).sidebar,
  )
  const noteList = clamp(
    widths.noteList,
    paneBounds({ ...context, sidebarWidth: sidebar, noteListWidth: widths.noteList }).noteList,
  )
  return { sidebar, noteList }
}
