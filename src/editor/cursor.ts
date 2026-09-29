import { Extension, type Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { CursorMetrics } from './cursorMetrics'

export const cursorStyles = [
  'line',
  'block',
  'underline',
  'line-thin',
  'block-outline',
  'underline-thin',
] as const
export type CursorStyle = (typeof cursorStyles)[number]
export const cursorBlinkingModes = ['blinking', 'smooth', 'phase', 'expand', 'solid'] as const
export type CursorBlinking = (typeof cursorBlinkingModes)[number]
export const cursorSmoothCaretAnimationModes = ['off', 'on'] as const
export type CursorSmoothCaretAnimation = (typeof cursorSmoothCaretAnimationModes)[number]
export type CursorSettings = {
  cursorStyle: CursorStyle
  cursorBlinking: CursorBlinking
  cursorSmoothCaretAnimation: CursorSmoothCaretAnimation
}
export const defaultCursorSettings: CursorSettings = {
  cursorStyle: 'line',
  cursorBlinking: 'blinking',
  cursorSmoothCaretAnimation: 'off',
}

const cursorSettingsByEditor = new WeakMap<Editor, CursorSettings>()
const cursorViewsByEditor = new WeakMap<Editor, Set<CursorLayerView>>()
export const cursorLayerKey = new PluginKey('writingCursorLayer')

// The block cursor is rendered outside the editable document. Do not use the
// `font` shorthand here: WebKit may serialize that shorthand incompletely,
// which makes the redrawn character fall back to the UI font. Copy the
// concrete font properties from the source character instead.
const blockCursorTypographyProperties = [
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'font-stretch',
  'font-kerning',
  'font-optical-sizing',
  'font-feature-settings',
  'font-variation-settings',
  'font-size-adjust',
  'font-synthesis',
  'font-variant',
  'letter-spacing',
  'word-spacing',
  'text-transform',
  'text-decoration-color',
  'text-decoration-line',
  'text-decoration-style',
  'text-decoration-thickness',
  'text-rendering',
  '-webkit-font-smoothing',
] as const

export function setCursorSettings(editor: Editor, settings: CursorSettings) {
  const next = { ...defaultCursorSettings, ...settings }
  cursorSettingsByEditor.set(editor, next)
  cursorViewsByEditor.get(editor)?.forEach((view) => view.setSettings(next))
}

type CursorGeometry = {
  left: number
  top: number
  height: number
  width: number
  character: string
  source: Element | null
}

function characterAt(view: EditorView, pos: number) {
  if (pos >= view.state.doc.content.size) return null
  try {
    const start = view.domAtPos(pos)
    const end = view.domAtPos(pos + 1)
    const range = view.dom.ownerDocument.createRange()
    range.setStart(start.node, start.offset)
    range.setEnd(end.node, end.offset)
    const rect = [...range.getClientRects()].find((candidate) => candidate.width > 0)
    const source = start.node.nodeType === 1 ? (start.node as Element) : start.node.parentElement
    return {
      width: rect?.width,
      character: Array.from(range.toString())[0] ?? '',
      source,
    }
  } catch {
    return null
  }
}

class CursorLayerView {
  private readonly metrics = new CursorMetrics()
  private settings: CursorSettings
  private host: HTMLElement | null = null
  private scrollTarget: HTMLElement | null = null
  private frame: number | null = null
  private resizeObserver: ResizeObserver | null = null
  private last: CursorGeometry | null = null
  private discontinuous = true
  private composition = false
  private restartRequested = true
  private readonly layer: HTMLDivElement
  private readonly motion: HTMLDivElement
  private readonly cursor: HTMLDivElement

  constructor(
    private readonly editor: Editor,
    private readonly view: EditorView,
  ) {
    this.settings = cursorSettingsByEditor.get(editor) ?? defaultCursorSettings
    const document = view.dom.ownerDocument
    this.layer = document.createElement('div')
    this.layer.className = 'writing-cursor-layer'
    this.layer.setAttribute('aria-hidden', 'true')
    this.layer.setAttribute('role', 'presentation')
    this.layer.contentEditable = 'false'
    this.motion = document.createElement('div')
    this.motion.className = 'writing-cursor-motion'
    this.motion.dataset.visible = 'false'
    this.cursor = document.createElement('div')
    this.cursor.className = 'writing-cursor'
    this.motion.append(this.cursor)
    this.layer.append(this.motion)
    view.dom.addEventListener('focus', this.schedule, true)
    view.dom.addEventListener('blur', this.onBlur, true)
    view.dom.addEventListener('compositionstart', this.onCompositionStart)
    view.dom.addEventListener('compositionend', this.onCompositionEnd)
    view.dom.addEventListener('mousedown', this.onPointerJump)
    view.dom.addEventListener('writing-deactivate', this.onDeactivate)
    document.addEventListener('selectionchange', this.schedule)
    document.fonts?.addEventListener('loadingdone', this.onFontsLoaded)
    document.defaultView?.addEventListener('resize', this.onResize)
    if (typeof ResizeObserver !== 'undefined')
      this.resizeObserver = new ResizeObserver(this.onResize)
    const views = cursorViewsByEditor.get(editor) ?? new Set<CursorLayerView>()
    views.add(this)
    cursorViewsByEditor.set(editor, views)
    this.ensureHost()
    this.schedule()
  }

  update() {
    this.ensureHost()
    this.schedule()
  }

  destroy() {
    this.view.dom.removeEventListener('focus', this.schedule, true)
    this.view.dom.removeEventListener('blur', this.onBlur, true)
    this.view.dom.removeEventListener('compositionstart', this.onCompositionStart)
    this.view.dom.removeEventListener('compositionend', this.onCompositionEnd)
    this.view.dom.removeEventListener('mousedown', this.onPointerJump)
    this.view.dom.removeEventListener('writing-deactivate', this.onDeactivate)
    const document = this.view.dom.ownerDocument
    document.removeEventListener('selectionchange', this.schedule)
    document.fonts?.removeEventListener('loadingdone', this.onFontsLoaded)
    document.defaultView?.removeEventListener('resize', this.onResize)
    this.scrollTarget?.removeEventListener('scroll', this.onScroll)
    this.resizeObserver?.disconnect()
    if (this.frame !== null) document.defaultView?.cancelAnimationFrame(this.frame)
    const views = cursorViewsByEditor.get(this.editor)
    views?.delete(this)
    if (!views?.size) cursorViewsByEditor.delete(this.editor)
    delete this.view.dom.dataset.cursorLayerActive
    this.layer.remove()
  }

  private ensureHost() {
    const next = this.view.dom.parentElement
    if (!next || next === this.host) return Boolean(next)
    this.resizeObserver?.disconnect()
    this.scrollTarget?.removeEventListener('scroll', this.onScroll)
    this.host = next
    this.host.append(this.layer)
    this.resizeObserver?.observe(this.host)
    this.scrollTarget = this.view.dom.closest<HTMLElement>('.note-scroll')
    this.scrollTarget?.addEventListener('scroll', this.onScroll, { passive: true })
    this.discontinuous = true
    return true
  }

  setSettings(settings: CursorSettings) {
    this.settings = { ...defaultCursorSettings, ...settings }
    this.discontinuous = true
    this.restartRequested = true
    this.schedule()
  }
  private onBlur = () => {
    this.discontinuous = true
    this.schedule()
  }
  private onCompositionStart = () => {
    this.composition = true
    this.schedule()
  }
  private onCompositionEnd = () => {
    this.composition = false
    this.discontinuous = true
    this.restartRequested = true
    this.schedule()
  }
  private onPointerJump = () => {
    this.discontinuous = true
  }
  private onDeactivate = () => this.hide()
  private onScroll = () => {
    this.discontinuous = true
    this.schedule()
  }
  private onResize = () => {
    this.discontinuous = true
    this.schedule()
  }
  private onFontsLoaded = () => {
    this.metrics.clear()
    this.schedule()
  }
  private schedule = () => {
    if (this.frame !== null) return
    const window = this.view.dom.ownerDocument.defaultView
    if (!window?.requestAnimationFrame) {
      queueMicrotask(() => this.render())
      return
    }
    this.frame = window.requestAnimationFrame(() => {
      this.frame = null
      this.render()
    })
  }

  private render() {
    if (
      !this.host ||
      !this.view.editable ||
      !this.view.hasFocus() ||
      !this.view.state.selection.empty ||
      this.composition ||
      this.view.composing
    ) {
      this.hide()
      return
    }
    const geometry = this.geometry()
    if (!geometry) {
      this.hide()
      return
    }
    const previous = this.last
    const nearby =
      previous &&
      Math.abs(geometry.left - previous.left) <= Math.max(48, geometry.height * 3) &&
      Math.abs(geometry.top - previous.top) < 1
    const smooth =
      this.settings.cursorSmoothCaretAnimation === 'on' &&
      !this.prefersReducedMotion() &&
      Boolean(nearby && !this.discontinuous)
    const changed =
      !previous ||
      geometry.left !== previous.left ||
      geometry.top !== previous.top ||
      geometry.width !== previous.width ||
      geometry.height !== previous.height
    this.motion.dataset.smooth = smooth ? 'true' : 'false'
    this.cursor.dataset.style = this.settings.cursorStyle
    this.cursor.dataset.blinking = this.settings.cursorBlinking
    this.position(geometry)
    this.motion.dataset.visible = 'true'
    this.view.dom.dataset.cursorLayerActive = 'true'
    this.last = geometry
    this.discontinuous = false
    if ((changed || this.restartRequested) && !this.prefersReducedMotion()) this.restartBlink()
    this.restartRequested = false
  }

  private geometry(): CursorGeometry | null {
    if (!this.host) return null
    try {
      const pos = this.view.state.selection.head
      const caret = this.view.coordsAtPos(pos)
      const host = this.host.getBoundingClientRect()
      const height = Math.max(1, caret.bottom - caret.top)
      const next = characterAt(this.view, pos)
      let offset = 0
      if (this.settings.cursorStyle === 'line' || this.settings.cursorStyle === 'line-thin') {
        const { node, offset: domOffset } = this.view.domAtPos(pos)
        const adjacent =
          node.nodeType === 1
            ? (node.childNodes[domOffset] ?? node.childNodes[Math.max(0, domOffset - 1)] ?? node)
            : node
        const source = adjacent.nodeType === 1 ? (adjacent as Element) : adjacent.parentElement
        if (source) offset = this.metrics.offset(source, height)
      }
      return {
        left: caret.left - host.left,
        top: caret.top - host.top + offset,
        height,
        width: Math.max(1, next?.width ?? height * 0.45),
        character: next?.character ?? '',
        source: next?.source ?? null,
      }
    } catch {
      return null
    }
  }

  private position(geometry: CursorGeometry) {
    const style = this.settings.cursorStyle
    const thin = style.endsWith('-thin')
    const line = style === 'line' || style === 'line-thin'
    const underline = style === 'underline' || style === 'underline-thin'
    const thickness = thin ? 1 : 2
    const height = line ? geometry.height : underline ? thickness : geometry.height
    const width = line ? thickness : geometry.width
    const offset = underline ? geometry.height - thickness : 0
    this.motion.style.transform = `translate3d(${geometry.left}px, ${geometry.top + offset}px, 0)`
    this.cursor.style.width = `${width}px`
    this.cursor.style.height = `${height}px`
    this.cursor.textContent = style === 'block' ? geometry.character : ''
    if (style === 'block' && geometry.source) {
      this.copyBlockTypography(geometry.source)
      this.cursor.style.lineHeight = `${geometry.height}px`
    } else {
      this.clearBlockTypography()
      this.cursor.style.lineHeight = ''
    }
  }

  private copyBlockTypography(source: Element) {
    const computed = getComputedStyle(source)
    blockCursorTypographyProperties.forEach((property) => {
      this.cursor.style.setProperty(property, computed.getPropertyValue(property))
    })
  }

  private clearBlockTypography() {
    blockCursorTypographyProperties.forEach((property) => {
      this.cursor.style.removeProperty(property)
    })
  }

  private restartBlink() {
    if (this.settings.cursorBlinking === 'solid') return
    this.cursor.style.animation = 'none'
    void this.cursor.offsetWidth
    this.cursor.style.animation = ''
  }

  private prefersReducedMotion() {
    return this.view.dom.ownerDocument.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)')
      .matches
  }

  private hide() {
    this.motion.dataset.visible = 'false'
    this.motion.dataset.smooth = 'false'
    delete this.view.dom.dataset.cursorLayerActive
    this.last = null
  }
}

export const CursorLayer = Extension.create({
  name: 'writingCursorLayer',
  priority: 1500,
  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin({
        key: cursorLayerKey,
        view: (view) => new CursorLayerView(editor, view),
      }),
    ]
  },
})
