import type { JSONContent } from '@tiptap/core'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { AppState, BinaryFiles } from '@excalidraw/excalidraw/types'

export interface DrawingScene {
  elements: readonly ExcalidrawElement[]
  appState: Pick<AppState, 'viewBackgroundColor' | 'gridSize' | 'gridStep'>
  files: BinaryFiles
}
export interface DrawingData {
  version: 1
  scene: DrawingScene
  revision: number
  preview: string | null
  previewRevision: number | null
}
export const emptyDrawing = (): DrawingData => ({
  version: 1,
  scene: {
    elements: [],
    appState: { viewBackgroundColor: '#ffffff', gridSize: 20, gridStep: 5 },
    files: {},
  },
  revision: 0,
  preview: null,
  previewRevision: null,
})
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)
const raster = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=\r\n]+$/
const elementTypes = new Set([
  'rectangle',
  'diamond',
  'ellipse',
  'arrow',
  'line',
  'freedraw',
  'text',
  'image',
  'frame',
  'magicframe',
])

/** Do not repair saved payloads in place: an unsupported drawing must survive unchanged. */
export function readDrawing(value: unknown): DrawingData | null {
  if (
    !record(value) ||
    value.version !== 1 ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 0
  )
    return null
  const scene = value.scene
  if (
    !record(scene) ||
    !Array.isArray(scene.elements) ||
    !record(scene.files) ||
    !record(scene.appState)
  )
    return null
  const state = scene.appState
  if (
    typeof state.viewBackgroundColor !== 'string' ||
    !/^(#[\da-f]{3,8}|transparent)$/i.test(state.viewBackgroundColor) ||
    (state.gridSize !== null && (!finite(state.gridSize) || state.gridSize <= 0)) ||
    !finite(state.gridStep) ||
    state.gridStep <= 0
  )
    return null
  const ids = new Set<string>()
  for (const element of scene.elements) {
    if (
      !record(element) ||
      typeof element.id !== 'string' ||
      !element.id ||
      ids.has(element.id) ||
      !elementTypes.has(String(element.type)) ||
      !['x', 'y', 'width', 'height', 'angle', 'version', 'versionNonce', 'seed'].every((key) =>
        finite(element[key]),
      ) ||
      !Array.isArray(element.groupIds) ||
      !element.groupIds.every((id) => typeof id === 'string') ||
      typeof element.isDeleted !== 'boolean' ||
      typeof element.strokeColor !== 'string' ||
      typeof element.backgroundColor !== 'string'
    )
      return null
    if (
      element.type === 'text' &&
      (typeof element.text !== 'string' ||
        !finite(element.fontSize) ||
        !finite(element.fontFamily) ||
        !finite(element.lineHeight))
    )
      return null
    if (
      ['line', 'arrow', 'freedraw'].includes(String(element.type)) &&
      (!Array.isArray(element.points) ||
        !element.points.every(
          (point) => Array.isArray(point) && point.length === 2 && point.every(finite),
        ))
    )
      return null
    if (
      element.type === 'freedraw' &&
      (!Array.isArray(element.pressures) || !element.pressures.every(finite))
    )
      return null
    if (
      element.type === 'image' &&
      (!Array.isArray(element.scale) || element.scale.length !== 2 || !element.scale.every(finite))
    )
      return null
    ids.add(element.id)
  }
  for (const [id, file] of Object.entries(scene.files)) {
    if (
      !record(file) ||
      file.id !== id ||
      typeof file.dataURL !== 'string' ||
      !raster.test(file.dataURL) ||
      !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(String(file.mimeType)) ||
      !finite(file.created)
    )
      return null
  }
  if (
    value.preview !== null &&
    (typeof value.preview !== 'string' ||
      !/^data:image\/png;base64,[A-Za-z0-9+/=\r\n]+$/.test(value.preview))
  )
    return null
  if (
    value.previewRevision !== null &&
    (!Number.isSafeInteger(value.previewRevision) || Number(value.previewRevision) < 0)
  )
    return null
  return value as unknown as DrawingData
}

/** Copy mutable library objects before they enter Tiptap's immutable document. */
export function captureScene(
  elements: readonly ExcalidrawElement[],
  appState: AppState,
  files: BinaryFiles,
): DrawingScene {
  const usedFiles: BinaryFiles = Object.create(null)
  const visible = elements.filter((element) => !element.isDeleted)
  for (const element of visible) {
    if (element.type === 'image' && element.fileId && files[element.fileId])
      usedFiles[element.fileId] = files[element.fileId]
  }
  return structuredClone({
    elements: visible,
    appState: {
      viewBackgroundColor: appState.viewBackgroundColor,
      gridSize: appState.gridSize,
      gridStep: appState.gridStep,
    },
    files: usedFiles,
  })
}
export const sceneSignature = (scene: DrawingScene) => JSON.stringify(scene)
export const drawingPreview = (data: DrawingData | null) =>
  data && data.previewRevision === data.revision ? data.preview : null
export function drawingLabel(data: DrawingData | null) {
  if (!data) return 'This drawing uses unsupported or damaged data.'
  return data.scene.elements.some((element) => !element.isDeleted)
    ? 'Drawing preview unavailable. Open on desktop to refresh.'
    : 'Empty drawing'
}
export function copyDrawingIds(content: JSONContent): JSONContent {
  return {
    ...content,
    ...(content.type === 'drawing' ? { attrs: { ...content.attrs, id: crypto.randomUUID() } } : {}),
    ...(content.content ? { content: content.content.map(copyDrawingIds) } : {}),
  }
}

/** A preview is derived data. Apply it only to the exact scene that produced it. */
export function replaceDrawingPreview(
  content: JSONContent,
  id: string,
  rendered: DrawingData,
): JSONContent {
  if (content.type === 'drawing' && content.attrs?.id === id) {
    const current = readDrawing(content.attrs.data)
    if (
      current &&
      current.revision === rendered.revision &&
      sceneSignature(current.scene) === sceneSignature(rendered.scene) &&
      (current.preview !== rendered.preview || current.previewRevision !== rendered.previewRevision)
    )
      return {
        ...content,
        attrs: {
          ...content.attrs,
          data: {
            ...current,
            preview: rendered.preview,
            previewRevision: rendered.previewRevision,
          },
        },
      }
  }
  if (!content.content) return content
  const children = content.content.map((child) => replaceDrawingPreview(child, id, rendered))
  return children.some((child, index) => child !== content.content![index])
    ? { ...content, content: children }
    : content
}
