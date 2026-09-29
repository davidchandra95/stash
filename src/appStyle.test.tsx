// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import App from './App'
import { library } from './storage/useLibrary'
import { defaultAppearance } from './storage/library'
import { clearSessions, getEditor } from './editor/session'
import { fontFamily } from './fonts'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
Element.prototype.scrollIntoView = vi.fn()
Range.prototype.getClientRects = () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () =>
  ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }) as DOMRect

it('switches style across workspace and portals without replacing the editor, draft, selection, scroll or tabs', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  library.setAppearance(defaultAppearance)
  try {
    await act(async () => root.render(<App />))
    expect(document.documentElement.style.getPropertyValue('--ui-font')).toBe(
      fontFamily(defaultAppearance.uiFont),
    )
    const app = host.querySelector<HTMLElement>('.app')!
    expect(app.style.getPropertyValue('--heading-h1-font')).toBe(
      fontFamily(defaultAppearance.noteFont),
    )
    await act(() => library.setAppearance({ ...defaultAppearance, uiFont: 'avenir' }))
    expect(document.documentElement.style.getPropertyValue('--ui-font')).toBe(fontFamily('avenir'))
    await act(() =>
      library.setAppearance({
        ...defaultAppearance,
        headingStyles: {
          ...defaultAppearance.headingStyles,
          h2: { font: 'palatino', weight: 700, italic: true, color: '#216f9c' },
        },
      }),
    )
    expect(app.style.getPropertyValue('--heading-h2-font')).toBe(fontFamily('palatino'))
    expect(app.style.getPropertyValue('--heading-h2-weight')).toBe('700')
    expect(app.style.getPropertyValue('--heading-h2-style')).toBe('italic')
    expect(app.style.getPropertyValue('--heading-h2-color')).toBe('#216f9c')
    await act(() => library.setAppearance(defaultAppearance))
    expect(
      [...host.querySelectorAll<HTMLButtonElement>('.nav-item')]
        .find((button) => button.textContent?.startsWith('All notes'))
        ?.getAttribute('aria-current'),
    ).toBe('page')
    const title = host.querySelector<HTMLInputElement>('[aria-label="Note title"]')!.value
    const note = library.getSnapshot().notes.find((n) => n.title === title)!
    const editor = getEditor(note.id, note.content)
    await act(async () => {
      editor.commands.insertContent('Unsaved style-check text ')
      editor.commands.setTextSelection(4)
    })
    const content = editor.getJSON()
    const selection = editor.state.selection.toJSON()
    const editorDOM = host.querySelector('.tiptap')
    const scroll = host.querySelector('.note-scroll')!
    scroll.scrollTop = 121
    const tabs = host.querySelector('[role="tablist"]')!.textContent
    await act(() =>
      host
        .querySelector<HTMLButtonElement>('.account-trigger')!
        .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })),
    )
    await act(() =>
      [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
        .find((item) => item.textContent === 'Settings')!
        .click(),
    )
    for (const style of ['cards', 'default'] as const) {
      await act(() =>
        document
          .querySelector<HTMLInputElement>(`input[name="app-style"][value="${style}"]`)!
          .click(),
      )
      expect(document.documentElement.dataset.appStyle).toBe(style)
      expect(document.body.querySelector('[role="dialog"]')).not.toBeNull()
      expect(host.querySelector('.tiptap')).toBe(editorDOM)
      expect(editor.getJSON()).toEqual(content)
      expect(editor.state.selection.toJSON()).toEqual(selection)
      expect(scroll.scrollTop).toBe(121)
      expect(host.querySelector('[role="tablist"]')!.textContent).toBe(tabs)
    }
  } finally {
    await act(() => root.unmount())
    host.remove()
    clearSessions()
  }
})
