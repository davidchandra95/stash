import type { Editor } from '@tiptap/core'
import { Slice } from '@tiptap/pm/model'
import { copyDrawingIds } from './model'
import { clipboardText } from '../editor/copy'

export const drawingClipboardType = 'application/x-stash-note-fragment+json'
// WKWebView can strip custom MIME data from the system pasteboard. An opaque
// HTML token recovers the last Stash copy without exposing scene JSON in HTML.
let lastCopy: { token: string; json: string } | undefined

export function copyDrawings(editor: Editor, event: ClipboardEvent, cut: boolean) {
  const { selection } = editor.state
  if (!event.clipboardData || selection.empty || (cut && !editor.isEditable)) return false
  const slice = selection.content()
  let containsDrawing = false
  slice.content.descendants((node) => {
    if (node.type.name === 'drawing') containsDrawing = true
  })
  if (!containsDrawing) return false
  const serialized = editor.view.serializeForClipboard(slice)
  const token = crypto.randomUUID(),
    json = JSON.stringify(slice.toJSON())
  lastCopy = { token, json }
  const wrapper = document.createElement('div')
  wrapper.dataset.stashClipboard = token
  wrapper.append(...serialized.dom.childNodes)
  event.clipboardData.clearData()
  event.clipboardData.setData('text/html', wrapper.outerHTML)
  event.clipboardData.setData('text/plain', clipboardText(editor))
  event.clipboardData.setData(drawingClipboardType, json)
  event.preventDefault()
  if (cut) editor.commands.deleteSelection()
  return true
}

export function pasteDrawings(editor: Editor, data: DataTransfer) {
  const token = /data-stash-clipboard=["']([a-zA-Z0-9-]+)["']/.exec(data.getData('text/html'))?.[1]
  const raw =
    data.getData(drawingClipboardType) || (token && token === lastCopy?.token ? lastCopy.json : '')
  if (!raw || !editor.isEditable) return false
  try {
    const json = JSON.parse(raw)
    if (
      !json ||
      !Array.isArray(json.content) ||
      !Number.isInteger(json.openStart ?? 0) ||
      !Number.isInteger(json.openEnd ?? 0)
    )
      return false
    json.content = json.content.map(copyDrawingIds)
    const slice = Slice.fromJSON(editor.schema, json)
    slice.content.forEach((node) => node.check())
    editor.view.dispatch(
      editor.state.tr.replaceSelection(slice).setMeta('paste', true).scrollIntoView(),
    )
    return true
  } catch {
    return false
  }
}
