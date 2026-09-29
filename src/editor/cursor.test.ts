// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { CursorMetrics } from './cursorMetrics'
import {
  CursorLayer,
  cursorBlinkingModes,
  cursorSmoothCaretAnimationModes,
  cursorStyles,
  defaultCursorSettings,
  setCursorSettings,
} from './cursor'

const editors: Editor[] = []
const wrappers: HTMLElement[] = []
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 25))

// jsdom has no font rasterizer; font geometry has separate measurement tests.
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})

function make() {
  const wrapper = document.createElement('div')
  const mount = document.createElement('div')
  wrapper.append(mount)
  document.body.append(wrapper)
  const editor = new Editor({
    element: mount,
    extensions: [StarterKit, CursorLayer],
    content: '<p>alpha</p>',
  })
  editors.push(editor)
  wrappers.push(wrapper)
  vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    right: 300,
    top: 0,
    bottom: 100,
    width: 300,
    height: 100,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect)
  let focused = true
  vi.spyOn(editor.view, 'hasFocus').mockImplementation(() => focused)
  vi.spyOn(editor.view, 'coordsAtPos').mockImplementation((pos) => ({
    left: pos * 10,
    right: pos * 10,
    top: 0,
    bottom: 24,
  }))
  editor.commands.setTextSelection(1)
  return {
    editor,
    wrapper,
    setFocused(next: boolean) {
      focused = next
      editor.view.dom.dispatchEvent(new FocusEvent(next ? 'focus' : 'blur'))
    },
  }
}

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy())
  wrappers.splice(0).forEach((wrapper) => wrapper.remove())
  vi.restoreAllMocks()
})

describe('writing cursor layer', () => {
  it('exposes the requested VS Code-style option sets', () => {
    expect(cursorStyles).toEqual([
      'line',
      'block',
      'underline',
      'line-thin',
      'block-outline',
      'underline-thin',
    ])
    expect(cursorBlinkingModes).toEqual(['blinking', 'smooth', 'phase', 'expand', 'solid'])
    expect(cursorSmoothCaretAnimationModes).toEqual(['off', 'on'])
  })

  it.each(cursorStyles)('draws the %s cursor style with the native caret hidden', async (style) => {
    const offset = vi.spyOn(CursorMetrics.prototype, 'offset').mockReturnValue(-3)
    const { editor, wrapper } = make()
    setCursorSettings(editor, {
      ...defaultCursorSettings,
      cursorStyle: style,
      cursorBlinking: 'solid',
    })
    await settle()
    const cursor = wrapper.querySelector<HTMLElement>('.writing-cursor')
    expect(cursor?.dataset.style).toBe(style)
    expect(cursor?.dataset.blinking).toBe('solid')
    expect(editor.view.dom.dataset.cursorLayerActive).toBe('true')
    const line = style === 'line' || style === 'line-thin'
    expect(offset).toHaveBeenCalledTimes(line ? 1 : 0)
    if (line) {
      expect(wrapper.querySelector<HTMLElement>('.writing-cursor-motion')?.style.transform).toBe(
        'translate3d(10px, -3px, 0)',
      )
    }
  })

  it.each(cursorBlinkingModes)(
    'applies the %s blinking mode to the custom cursor',
    async (blinking) => {
      const { editor, wrapper } = make()
      setCursorSettings(editor, { ...defaultCursorSettings, cursorBlinking: blinking })
      await settle()
      expect(wrapper.querySelector<HTMLElement>('.writing-cursor')?.dataset.blinking).toBe(blinking)
      expect(editor.view.dom.dataset.cursorLayerActive).toBe('true')
    },
  )

  it('redraws a block cursor with the exact typography of the underlying character', async () => {
    const { editor, wrapper } = make()
    const paragraph = editor.view.dom.querySelector('p')!
    const originalClientRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects')
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: () => [{ width: 10 }],
    })
    paragraph.style.fontFamily = '"New York"'
    paragraph.style.fontSize = '17px'
    paragraph.style.fontWeight = '600'
    paragraph.style.fontStyle = 'italic'
    paragraph.style.fontKerning = 'normal'
    paragraph.style.fontFeatureSettings = '"liga" 1'
    paragraph.style.fontVariationSettings = '"opsz" 17'
    paragraph.style.letterSpacing = '0.25px'
    paragraph.style.wordSpacing = '1px'
    const text = paragraph.firstChild!
    vi.spyOn(editor.view, 'domAtPos').mockImplementation((pos) => ({
      node: text,
      offset: pos === 1 ? 0 : 1,
    }))

    try {
      setCursorSettings(editor, {
        ...defaultCursorSettings,
        cursorStyle: 'block',
        cursorBlinking: 'solid',
      })
      await settle()

      const cursor = wrapper.querySelector<HTMLElement>('.writing-cursor')!
      const source = getComputedStyle(paragraph)
      expect(cursor.textContent).toBe('a')
      for (const property of [
        'font-family',
        'font-size',
        'font-weight',
        'font-style',
        'font-kerning',
        'font-feature-settings',
        'font-variation-settings',
        'letter-spacing',
        'word-spacing',
      ]) {
        expect(cursor.style.getPropertyValue(property)).toBe(source.getPropertyValue(property))
      }
    } finally {
      if (originalClientRects)
        Object.defineProperty(Range.prototype, 'getClientRects', originalClientRects)
      else delete (Range.prototype as Partial<Range>).getClientRects
    }
  })

  it('returns to the native caret when the editor loses focus', async () => {
    const { editor, setFocused } = make()
    setCursorSettings(editor, { ...defaultCursorSettings, cursorBlinking: 'solid' })
    await settle()
    setFocused(false)
    await settle()
    expect(editor.view.dom.dataset.cursorLayerActive).toBeUndefined()
  })

  it('returns to the native caret for selections and IME composition', async () => {
    const { editor } = make()
    setCursorSettings(editor, { ...defaultCursorSettings, cursorBlinking: 'solid' })
    await settle()
    editor.commands.setTextSelection({ from: 1, to: 2 })
    await settle()
    expect(editor.view.dom.dataset.cursorLayerActive).toBeUndefined()
    editor.commands.setTextSelection(1)
    editor.view.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    await settle()
    expect(editor.view.dom.dataset.cursorLayerActive).toBeUndefined()
    editor.view.dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    await settle()
    expect(editor.view.dom.dataset.cursorLayerActive).toBe('true')
  })
})
