import type { EditorGroupId, SplitSide } from '../workspace'

export type TabDrop = { group: EditorGroupId; side?: SplitSide; inStrip?: boolean }
export type GroupArea = {
  group: EditorGroupId
  left: number
  right: number
  top: number
  bottom: number
  /** The bottom of the tab bar. */
  documentTop: number
}
/** The outer share of the document that splits it when a tab is dropped there. */
const splitEdge = 0.35

/**
 * Where a dragged tab would land. With one group, the document's outer edges make a new split.
 * With two, the other group takes it. Dropping back on its own group does nothing here, since
 * its strip handles reordering.
 */
export function tabDropTarget(
  x: number,
  y: number,
  source: EditorGroupId,
  areas: GroupArea[],
): TabDrop | null {
  const area = areas.find(
    (item) => x >= item.left && x <= item.right && y >= item.top && y <= item.bottom,
  )
  if (!area) return null
  if (areas.length > 1) {
    if (area.group === source) return null
    return { group: area.group, inStrip: y < area.documentTop }
  }
  if (y < area.documentTop) return null
  const share = (x - area.left) / Math.max(1, area.right - area.left)
  if (share <= splitEdge) return { group: area.group, side: 'left' }
  if (share >= 1 - splitEdge) return { group: area.group, side: 'right' }
  return null
}
