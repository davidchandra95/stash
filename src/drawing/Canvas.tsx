import './assetPath'
import { useEffect, useRef, useState } from 'react'
import {
  Excalidraw,
  MainMenu,
  DefaultSidebar,
  exportToCanvas,
  getNonDeletedElements,
} from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import type { Editor } from '@tiptap/core'
import { captureScene, type DrawingData, type DrawingScene } from './model'
import { DrawingSession } from './session'
import { library } from '../storage/useLibrary'
import { openExternalUrl } from '../platform'

async function preview(scene: DrawingScene) {
  const canvas = await exportToCanvas({
    elements: getNonDeletedElements(scene.elements),
    appState: { ...scene.appState, exportBackground: true, exportWithDarkMode: false },
    files: scene.files,
    maxWidthOrHeight: 1600,
  })
  return canvas.toDataURL('image/png')
}
export default function Canvas({
  editor,
  noteId,
  id,
  initial,
  dark,
  frozen,
  escapeHandler,
}: {
  editor: Editor
  noteId: string
  id: string
  initial: DrawingData
  dark: boolean
  frozen: boolean
  escapeHandler: React.RefObject<(() => boolean) | null>
}) {
  const [error, setError] = useState('')
  const [initialScene] = useState(() => structuredClone(initial.scene))
  const [, refresh] = useState(0)
  const api = useRef<ExcalidrawImperativeAPI | null>(null)
  const session = useRef<DrawingSession | null>(null)
  const inputError = useRef(false)
  useEffect(() => {
    let mounted = true
    const current = new DrawingSession(
      editor,
      id,
      preview,
      () => {
        if (mounted) refresh((v) => v + 1)
      },
      (data) => library.saveDrawingPreview(noteId, id, data),
    )
    session.current = current
    const unregister = library.registerFlush(async () => {
      if (inputError.current) throw Error('Resolve the drawing error before continuing.')
      await current.flushPreview()
    })
    void current.flushPreview()
    escapeHandler.current = () => {
      const state = api.current?.getAppState()
      return (
        !!state &&
        !!(
          state.openMenu ||
          state.openDialog ||
          state.openSidebar ||
          state.editingTextElement ||
          state.editingLinearElement ||
          state.multiElement ||
          state.newElement ||
          state.activeTool.type !== 'selection'
        )
      )
    }
    return () => {
      mounted = false
      unregister()
      current.dispose()
      session.current = null
      escapeHandler.current = null
    }
  }, [editor, noteId, id, escapeHandler])
  return (
    <>
      {(error || session.current?.previewError) && (
        <div className="drawing-error" role="alert">
          {error || session.current?.previewError}
          {!error && (
            <button type="button" onClick={() => void session.current?.flushPreview()}>
              Retry preview
            </button>
          )}
        </div>
      )}
      <div
        className="drawing-canvas"
        onClickCapture={(event) => {
          const anchor = (event.target as Element).closest('a[href]')
          if (!anchor) return
          event.preventDefault()
          event.stopPropagation()
          const href = anchor.getAttribute('href') ?? ''
          if (/^(https?:|mailto:)/i.test(href))
            void openExternalUrl(href).catch((failure) => setError(String(failure)))
        }}
        onDropCapture={(event) => {
          if (
            Array.from(event.dataTransfer.files).some((file) => !file.type.startsWith('image/'))
          ) {
            event.preventDefault()
            event.stopPropagation()
            setError('Only images can be added to this drawing.')
          }
        }}
      >
        <Excalidraw
          excalidrawAPI={(value) => {
            api.current = value
          }}
          initialData={{ ...initialScene, scrollToContent: true }}
          theme={dark ? 'dark' : 'light'}
          viewModeEnabled={frozen}
          autoFocus
          handleKeyboardGlobally={false}
          aiEnabled={false}
          isCollaborating={false}
          validateEmbeddable={false}
          UIOptions={{
            canvasActions: {
              loadScene: false,
              saveToActiveFile: false,
              saveAsImage: false,
              export: false,
              toggleTheme: false,
            },
          }}
          onLinkOpen={(element, event) => {
            event.preventDefault()
            if (element.link && /^(https?:|mailto:)/i.test(element.link))
              void openExternalUrl(element.link).catch((failure) => setError(String(failure)))
          }}
          onChange={(elements, state, files) => {
            const store = library.getSnapshot()
            if (frozen || !session.current || store.quitting || store.syncing || store.converting)
              return
            try {
              session.current.change(captureScene(elements, state, files))
              inputError.current = false
              setError('')
            } catch (failure) {
              inputError.current = true
              setError(String(failure))
            }
          }}
        >
          <MainMenu>
            <MainMenu.DefaultItems.ClearCanvas />
            <MainMenu.DefaultItems.ChangeCanvasBackground />
          </MainMenu>
          <DefaultSidebar>
            <div className="drawing-library-disabled">Libraries are unavailable in Stash.</div>
          </DefaultSidebar>
        </Excalidraw>
      </div>
    </>
  )
}
