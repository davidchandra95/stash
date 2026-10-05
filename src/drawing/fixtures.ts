import { emptyDrawing, type DrawingData } from './model'

// A plain scene fixture keeps storage and editor tests independent of the canvas bundle.
export function drawingFixture(): DrawingData {
  return {
    ...emptyDrawing(),
    revision: 1,
    scene: {
      ...emptyDrawing().scene,
      elements: [
        {
          id: 'rectangle-1',
          type: 'rectangle',
          x: 10,
          y: 20,
          width: 120,
          height: 80,
          angle: 0,
          strokeColor: '#1e1e1e',
          backgroundColor: 'transparent',
          fillStyle: 'hachure',
          strokeWidth: 1,
          strokeStyle: 'solid',
          roughness: 1,
          opacity: 100,
          groupIds: [],
          frameId: null,
          roundness: null,
          seed: 10,
          version: 1,
          versionNonce: 11,
          isDeleted: false,
          boundElements: null,
          updated: 1,
          link: null,
          locked: false,
          index: null,
        },
      ],
    },
  }
}
export const previewFixture =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII='
