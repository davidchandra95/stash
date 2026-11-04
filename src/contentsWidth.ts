export const defaultContentsWidth = 260
export const minimumContentsWidth = 160
export const maximumContentsWidth = 480
export const minimumDocumentWidth = 280

export type SidePanelLimits = {
  initial: number
  minimum: number
  maximum: number
  /** Space the panel always leaves for the content beside it. */
  minimumContent: number
}

export const contentsLimits: SidePanelLimits = {
  initial: defaultContentsWidth,
  minimum: minimumContentsWidth,
  maximum: maximumContentsWidth,
  minimumContent: minimumDocumentWidth,
}

export const taskDetailLimits: SidePanelLimits = {
  initial: 320,
  minimum: 280,
  maximum: 560,
  minimumContent: 360,
}

export function normalizeContentsWidth(
  value: unknown,
  limits: SidePanelLimits = contentsLimits,
): number | undefined {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= limits.minimum &&
    value <= limits.maximum
    ? value
    : undefined
}

export function visibleContentsWidth(
  preferred: number,
  workspaceWidth: number,
  limits: SidePanelLimits = contentsLimits,
): number {
  if (workspaceWidth <= 0) return preferred
  return Math.min(preferred, Math.max(limits.minimum, workspaceWidth - limits.minimumContent))
}
