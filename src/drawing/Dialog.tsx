import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type { Editor } from '@tiptap/core'
import type { Appearance } from '../model'
import { library } from '../storage/useLibrary'
import { platform } from '../platform'
import { X } from '../icons'
import { fontFamily } from '../fonts'
import { findDrawing } from './node'
import { readDrawing, drawingLabel, drawingPreview, type DrawingData } from './model'
import './drawing.css'

const Canvas = lazy(() => import('./Canvas'))
class CanvasBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? (
      <p role="alert">
        The drawing editor could not open. Your saved drawing has not been changed. Close and reopen
        to retry.
      </p>
    ) : (
      this.props.children
    )
  }
}
export default function DrawingDialog({
  editor,
  noteId,
  readOnly,
  appearance,
}: {
  editor: Editor
  noteId: string
  readOnly: boolean
  appearance?: Appearance
}) {
  const [open, setOpen] = useState<{
    id: string
    initial: DrawingData | null
    editing: boolean
  } | null>(null)
  const [closing, setClosing] = useState(false)
  const [error, setError] = useState('')
  const escapeHandler = useRef<(() => boolean) | null>(null)
  const lastId = useRef<string | null>(null)
  const generation = useRef(0)
  const state = useSyncExternalStore(library.subscribe, library.getSnapshot)
  const dark = appearance?.dark ?? state.appearance.dark
  useEffect(() => {
    const dom = editor.view.dom
    const show = (event: Event) => {
      const id = (event as CustomEvent<string>).detail,
        target = findDrawing(editor, id)
      if (!target) return
      ++generation.current
      lastId.current = id
      setError('')
      setClosing(false)
      setOpen({ id, initial: readDrawing(target.node.attrs.data), editing: editor.isEditable })
    }
    const dismiss = () => {
      ++generation.current
      setOpen(null)
      void library.flush().catch(() => {})
    }
    dom.addEventListener('drawing-open', show)
    dom.addEventListener('writing-deactivate', dismiss)
    return () => {
      ++generation.current
      dom.removeEventListener('drawing-open', show)
      dom.removeEventListener('writing-deactivate', dismiss)
    }
  }, [editor])
  useEffect(() => {
    if (!open) return
    const check = () => {
      if (!findDrawing(editor, open.id)) {
        ++generation.current
        setOpen(null)
      }
    }
    editor.on('transaction', check)
    return () => {
      editor.off('transaction', check)
    }
  }, [editor, open])
  const close = async () => {
    if (closing) return
    const token = generation.current
    setClosing(true)
    try {
      await library.flush()
      if (token === generation.current) setOpen(null)
    } catch (failure) {
      if (token === generation.current) setError(String(failure))
    } finally {
      if (token === generation.current) setClosing(false)
    }
  }
  const data = open ? readDrawing(findDrawing(editor, open.id)?.node.attrs.data) : null
  const preview = drawingPreview(data)
  const viewOnly = platform.mobile || !open?.editing || !open?.initial
  return (
    <Dialog.Root
      open={!!open}
      onOpenChange={(value) => {
        if (!value) void close()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className={`drawing-dialog ${platform.mobile ? 'drawing-dialog-mobile' : ''}`}
          style={{ fontFamily: fontFamily(appearance?.uiFont ?? state.appearance.uiFont) }}
          data-theme={dark ? 'dark' : 'light'}
          data-palette={appearance?.theme ?? state.appearance.theme}
          aria-describedby="drawing-description"
          onPointerDownOutside={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => {
            if (escapeHandler.current?.()) event.preventDefault()
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            if (!editor.isDestroyed && editor.view.dom.isConnected && lastId.current) {
              const target = findDrawing(editor, lastId.current)
              if (target) {
                editor.commands.setNodeSelection(target.pos)
                editor.commands.focus()
              }
            }
          }}
        >
          <header className="drawing-heading">
            <Dialog.Title>Drawing</Dialog.Title>
            <span role="status">
              {state.error
                ? "Couldn't save"
                : state.preview
                  ? 'Session only'
                  : state.status === 'saving'
                    ? 'Saving…'
                    : state.status === 'error'
                      ? "Couldn't save"
                      : platform.mobile
                        ? 'Saved on this device'
                        : 'Saved on this Mac'}
            </span>
            <button
              type="button"
              className="tool"
              aria-label="Close drawing"
              disabled={closing}
              onClick={() => void close()}
            >
              <X />
            </button>
          </header>
          <Dialog.Description id="drawing-description" className="drawing-description">
            {viewOnly
              ? 'Drawing preview. Edit this drawing on desktop.'
              : 'Changes save automatically. Close to return to your note.'}
          </Dialog.Description>
          {(error || state.error) && (
            <div className="drawing-error" role="alert">
              {error || state.error}
              <button
                type="button"
                disabled={closing}
                onClick={() => {
                  setError('')
                  void library.flush().catch((failure) => setError(String(failure)))
                }}
              >
                Retry
              </button>
            </div>
          )}
          {open &&
            (viewOnly ? (
              <div className="drawing-viewer">
                {preview ? <img src={preview} alt="Drawing" /> : <p>{drawingLabel(data)}</p>}
              </div>
            ) : (
              <CanvasBoundary key={open.id}>
                <Suspense fallback={<p role="status">Loading drawing editor…</p>}>
                  <Canvas
                    editor={editor}
                    noteId={noteId}
                    id={open.id}
                    initial={open.initial!}
                    dark={dark}
                    frozen={closing || readOnly}
                    escapeHandler={escapeHandler}
                  />
                </Suspense>
              </CanvasBoundary>
            ))}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
