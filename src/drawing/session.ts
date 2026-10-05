import type { Editor } from '@tiptap/core'
import type { DrawingData, DrawingScene } from './model'
import { readDrawing, sceneSignature } from './model'
import { findDrawing } from './node'
import { closeHistory } from '@tiptap/pm/history'

/** A session belongs to one editor and one block. It never follows active-note state. */
export class DrawingSession {
  private alive = true
  private signature: string
  private timer?: ReturnType<typeof setTimeout>
  private previewJob?: Promise<void>
  previewError = ''
  constructor(
    readonly editor: Editor,
    readonly id: string,
    private exportPreview: (scene: DrawingScene) => Promise<string>,
    private notify: () => void = () => {},
    private persistPreview: (data: DrawingData) => void = () => {},
  ) {
    this.signature = sceneSignature(this.data!.scene)
    editor.view.dispatch(closeHistory(editor.state.tr))
  }
  get data() {
    return readDrawing(findDrawing(this.editor, this.id)?.node.attrs.data)
  }
  private write(data: DrawingData) {
    const target = this.alive && findDrawing(this.editor, this.id)
    if (!target) return false
    this.editor.view.dispatch(
      this.editor.state.tr
        .setNodeMarkup(target.pos, undefined, { ...target.node.attrs, data })
        .setMeta('addToHistory', false),
    )
    return true
  }
  change(scene: DrawingScene) {
    if (!this.alive || this.editor.isDestroyed || !this.editor.isEditable) return false
    const data = this.data,
      signature = sceneSignature(scene)
    if (!data || signature === this.signature) return false
    const next = { ...data, scene, revision: data.revision + 1 }
    if (!readDrawing(next))
      throw Error(
        'This drawing contains unsupported content. Remove the last added item and try again.',
      )
    if (!this.write(next)) return false
    this.signature = signature
    this.previewError = ''
    // Throttle, rather than restart on every stroke, so continuous drawing gets previews.
    this.timer ??= setTimeout(() => {
      this.timer = undefined
      void this.flushPreview()
    }, 750)
    return true
  }
  flushPreview = async (): Promise<void> => {
    clearTimeout(this.timer)
    this.timer = undefined
    if (this.previewJob) return this.previewJob
    this.previewJob = this.renderLatest().finally(() => {
      this.previewJob = undefined
    })
    return this.previewJob
  }
  private async renderLatest() {
    while (this.alive) {
      const data = this.data
      if (!data || data.previewRevision === data.revision) return
      try {
        const preview = await (data.scene.elements.some((element) => !element.isDeleted)
          ? this.exportPreview(data.scene)
          : Promise.resolve(null))
        const current = this.data
        if (this.alive && current?.revision === data.revision) {
          const rendered = { ...current, preview, previewRevision: current.revision }
          this.write(rendered)
          this.persistPreview(rendered)
          this.previewError = ''
          return
        }
      } catch {
        this.previewError =
          'The preview could not be created. The drawing remains editable; check its save status above.'
        return
      } finally {
        this.notify()
      }
    }
  }
  dispose() {
    this.alive = false
    clearTimeout(this.timer)
  }
}
