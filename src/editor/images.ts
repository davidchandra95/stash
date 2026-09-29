import { plainPasteEditors } from './clipboard'
import { Extension, type Editor } from '@tiptap/core'
import { closeHistory } from '@tiptap/pm/history'
import { Plugin } from '@tiptap/pm/state'
export function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Image could not be read.'))
    reader.readAsDataURL(file)
  })
}
export async function insertImages(
  editor: Editor,
  files: File[],
  position = editor.state.selection.from,
) {
  const valid = files.filter((f) => /^image\/(png|jpeg|gif|webp|avif|bmp)$/.test(f.type))
  if (!valid.length) throw new Error('Choose a PNG, JPEG, GIF, WebP, AVIF, or BMP image.')
  // Map the insertion point through any edits while file reads are pending.
  let mapped = position
  const track = ({ transaction }: { transaction: import('@tiptap/pm/state').Transaction }) => {
    mapped = transaction.mapping.map(mapped)
  }
  editor.on('transaction', track)
  try {
    const images = await Promise.all(
      valid.map(async (file) => ({
        type: 'image',
        attrs: { src: await readImage(file), alt: file.name, width: 360 },
      })),
    )
    if (!editor.isDestroyed) {
      editor.view.dispatch(closeHistory(editor.state.tr))
      editor.chain().insertContentAt(mapped, images).focus().run()
      editor.view.dispatch(closeHistory(editor.state.tr))
    }
  } finally {
    editor.off('transaction', track)
  }
}
export const ImageClipboard = Extension.create({
  name: 'imageClipboard',
  priority: 1300,
  addProseMirrorPlugins() {
    const editor = this.editor
    const insert = (files: File[], pos?: number) => {
      void insertImages(editor, files, pos).catch((error) =>
        editor.view.dom.dispatchEvent(
          new CustomEvent('writing-error', { bubbles: true, detail: String(error.message) }),
        ),
      )
    }
    return [
      new Plugin({
        props: {
          handlePaste: (_view, event) => {
            if (
              editor.isActive('codeBlock') ||
              plainPasteEditors.has(editor) ||
              event.clipboardData?.getData('text/html')
            )
              return false
            const files = Array.from(event.clipboardData?.files ?? [])
            if (!files.some((f) => f.type.startsWith('image/'))) return false
            insert(files)
            return true
          },
          handleDrop: (view, event, _slice, moved) => {
            if (moved || editor.isActive('codeBlock')) return false
            const files = Array.from(event.dataTransfer?.files ?? [])
            if (!files.some((f) => f.type.startsWith('image/'))) return false
            const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
            insert(files, pos)
            return true
          },
        },
      }),
    ]
  },
})
