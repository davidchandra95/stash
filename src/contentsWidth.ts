export const defaultContentsWidth = 260
export const minimumContentsWidth = 160
export const maximumContentsWidth = 480
export const minimumDocumentWidth = 280

export function normalizeContentsWidth(value: unknown): number | undefined {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= minimumContentsWidth &&
    value <= maximumContentsWidth
    ? value
    : undefined
}

export function visibleContentsWidth(preferred: number, workspaceWidth: number): number {
  if (workspaceWidth <= 0) return preferred
  return Math.min(preferred, Math.max(minimumContentsWidth, workspaceWidth - minimumDocumentWidth))
}
