// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import App from './App'
import { accents, accentValue, normalizeAppearance } from './appearance'
import { library } from './storage/useLibrary'
import { defaultAppearance } from './storage/library'
import { clearSessions, getEditor } from './editor/session'
import { fontFamily } from './fonts'
import type { Appearance } from './model'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
Element.prototype.scrollIntoView = vi.fn()
Range.prototype.getClientRects = () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () =>
  ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }) as DOMRect

type Saved = Parameters<typeof normalizeAppearance>[0]
const saved = (value: Record<string, unknown>) => value as Saved

describe('normalizeAppearance', () => {
  it('uses defaults when nothing was saved', () => {
    expect(normalizeAppearance(null, defaultAppearance)).toEqual(defaultAppearance)
    expect(normalizeAppearance(undefined, defaultAppearance)).toEqual(defaultAppearance)
    expect(normalizeAppearance({}, defaultAppearance)).toEqual(defaultAppearance)
  })

  it.each([
    [true, 'dark'],
    [false, 'light'],
  ] as const)('migrates legacy dark: %s to colorMode %s and drops retired keys', (dark, mode) => {
    const result = normalizeAppearance(
      saved({
        dark,
        theme: 'aster',
        appStyle: 'cards',
        uiFont: 'avenir',
        noteFont: 'palatino',
        size: 19,
      }),
      defaultAppearance,
    )
    expect(result).toEqual({
      ...defaultAppearance,
      colorMode: mode,
      layout: 'cards',
      noteFont: 'palatino',
      size: 19,
    })
    for (const key of ['dark', 'theme', 'appStyle', 'uiFont'])
      expect(result).not.toHaveProperty(key)
  })

  it('prefers a saved colorMode over a legacy dark flag', () => {
    expect(
      normalizeAppearance(saved({ colorMode: 'system', dark: true }), defaultAppearance).colorMode,
    ).toBe('system')
    expect(
      normalizeAppearance(saved({ colorMode: 'light', dark: true }), defaultAppearance).colorMode,
    ).toBe('light')
  })

  it.each([undefined, null, 'sepia', 1, 'true'])(
    'falls back to the default color mode for %s with no legacy flag',
    (colorMode) => {
      expect(normalizeAppearance(saved({ colorMode }), defaultAppearance).colorMode).toBe(
        defaultAppearance.colorMode,
      )
    },
  )

  it('ignores a non-boolean legacy dark flag', () => {
    expect(normalizeAppearance(saved({ dark: 'yes' }), defaultAppearance).colorMode).toBe(
      defaultAppearance.colorMode,
    )
  })

  it.each(['system', 'blue', 'purple', 'pink', 'red', 'orange', 'yellow', 'green', 'graphite'])(
    'keeps the valid accent %s',
    (accent) => {
      expect(normalizeAppearance(saved({ accent }), defaultAppearance).accent).toBe(accent)
    },
  )

  it.each(['teal', '', null, 3, '#ff0000'])(
    'replaces the invalid accent %s with the default',
    (accent) => {
      const defaults: Appearance = { ...defaultAppearance, accent: 'green' }
      expect(normalizeAppearance(saved({ accent }), defaults).accent).toBe('green')
    },
  )

  it('keeps boolean sidebar switches and defaults non-boolean ones', () => {
    expect(
      normalizeAppearance(
        saved({ translucentSidebar: false, sidebarCounts: false }),
        defaultAppearance,
      ),
    ).toMatchObject({ translucentSidebar: false, sidebarCounts: false })
    const defaults: Appearance = {
      ...defaultAppearance,
      translucentSidebar: false,
      sidebarCounts: false,
    }
    expect(
      normalizeAppearance(saved({ translucentSidebar: 'true', sidebarCounts: 1 }), defaults),
    ).toMatchObject({ translucentSidebar: false, sidebarCounts: false })
    expect(
      normalizeAppearance(saved({ translucentSidebar: null, sidebarCounts: undefined }), defaults),
    ).toMatchObject({ translucentSidebar: false, sidebarCounts: false })
  })

  it('keeps a saved layout and turns the v1 Modern cards style into the cards layout', () => {
    expect(normalizeAppearance({ layout: 'cards' }, defaultAppearance).layout).toBe('cards')
    expect(
      normalizeAppearance({ appStyle: 'cards' } as unknown as Saved, defaultAppearance).layout,
    ).toBe('cards')
    expect(
      normalizeAppearance({ appStyle: 'default' } as unknown as Saved, defaultAppearance).layout,
    ).toBe('standard')
    expect(
      normalizeAppearance({ layout: 'grid' } as unknown as Saved, defaultAppearance).layout,
    ).toBe('standard')
  })

  it('does not mutate the saved object or the defaults', () => {
    const input = { dark: true, theme: 'aster', accent: 'pink' }
    const defaults = { ...defaultAppearance }
    normalizeAppearance(saved(input), defaults)
    expect(input).toEqual({ dark: true, theme: 'aster', accent: 'pink' })
    expect(defaults).toEqual(defaultAppearance)
  })
})

describe('accentValue', () => {
  it('uses the reported macOS accent for system, falling back to blue for the color mode', () => {
    expect(accentValue('system', false, '#ff2d55')).toEqual({ color: '#ff2d55' })
    expect(accentValue('system', true, '#ff2d55')).toEqual({ color: '#ff2d55' })
    expect(accentValue('system', false, null)).toEqual({ color: accents.blue.light })
    expect(accentValue('system', true, null)).toEqual({ color: accents.blue.dark })
  })

  it('picks the light or dark shade of a fixed accent and ignores the system color', () => {
    expect(accentValue('purple', false, '#ff2d55')).toEqual({ color: '#953d96', ink: undefined })
    expect(accentValue('purple', true, null)).toEqual({ color: '#a550a7', ink: undefined })
  })

  it('returns dark ink for yellow so filled controls stay legible', () => {
    expect(accentValue('yellow', false, null)).toEqual({ color: '#f5b323', ink: '#1d1d1f' })
    expect(accentValue('yellow', true, null)).toEqual({ color: '#ffc600', ink: '#1d1d1f' })
  })
})

it('switches color mode and accent without replacing the editor, draft, selection, scroll or tabs', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  library.setAppearance(defaultAppearance)
  const html = document.documentElement
  try {
    await act(async () => root.render(<App />))
    const surface = host.querySelector<HTMLElement>('.window')!
    expect(surface).not.toBeNull()
    expect(surface.style.getPropertyValue('--heading-h1-font')).toBe(
      fontFamily(defaultAppearance.noteFont),
    )
    // Without matchMedia or a native accent, Auto resolves light with the blue fallback.
    expect(html.dataset.theme).toBe('light')
    expect(html.style.colorScheme).toBe('light')
    expect(html.style.getPropertyValue('--accent')).toBe(accents.blue.light)
    expect(html.style.getPropertyValue('--on-accent')).toBe('#ffffff')
    expect(html.style.getPropertyValue('--ui-font')).toBe('')

    await act(() =>
      library.setAppearance({
        ...defaultAppearance,
        headingStyles: {
          ...defaultAppearance.headingStyles,
          h2: { font: 'palatino', weight: 700, italic: true, color: '#216f9c' },
        },
      }),
    )
    expect(surface.style.getPropertyValue('--heading-h2-font')).toBe(fontFamily('palatino'))
    expect(surface.style.getPropertyValue('--heading-h2-weight')).toBe('700')
    expect(surface.style.getPropertyValue('--heading-h2-style')).toBe('italic')
    expect(surface.style.getPropertyValue('--heading-h2-color')).toBe('#216f9c')
    await act(() => library.setAppearance(defaultAppearance))

    expect(
      [...host.querySelectorAll<HTMLButtonElement>('button.side-row')]
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
    const unchanged = () => {
      expect(host.querySelector('.window')).toBe(surface)
      expect(host.querySelector('.tiptap')).toBe(editorDOM)
      expect(editor.getJSON()).toEqual(content)
      expect(editor.state.selection.toJSON()).toEqual(selection)
      expect(scroll.scrollTop).toBe(121)
      expect(host.querySelector('[role="tablist"]')!.textContent).toBe(tabs)
    }

    await act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Settings"]')!.click())
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
    expect(dialog).not.toBeNull()
    expect(dialog.hasAttribute('data-theme')).toBe(false)
    const radio = (group: string, name: string) =>
      [
        ...document.querySelectorAll<HTMLButtonElement>(
          `[role="radiogroup"][aria-label="${group}"] [role="radio"]`,
        ),
      ].find((button) => (button.getAttribute('aria-label') ?? button.textContent) === name)!

    for (const [mode, theme] of [
      ['Dark', 'dark'],
      ['Light', 'light'],
      ['Dark', 'dark'],
    ] as const) {
      await act(() => radio('Appearance', mode).click())
      expect(radio('Appearance', mode).getAttribute('aria-checked')).toBe('true')
      expect(library.getSnapshot().appearance.colorMode).toBe(theme)
      expect(html.dataset.theme).toBe(theme)
      expect(html.style.colorScheme).toBe(theme)
      expect(html.style.getPropertyValue('--accent')).toBe(accents.blue[theme])
      expect(document.querySelector('[role="dialog"]')).toBe(dialog)
      unchanged()
    }

    for (const accent of ['purple', 'yellow', 'graphite'] as const) {
      await act(() => radio('Accent color', accents[accent].label).click())
      expect(library.getSnapshot().appearance.accent).toBe(accent)
      expect(html.style.getPropertyValue('--accent')).toBe(accents[accent].dark)
      expect(html.style.getPropertyValue('--on-accent')).toBe(accents[accent].ink ?? '#ffffff')
      expect(html.dataset.theme).toBe('dark')
      expect(document.querySelector('[role="dialog"]')).toBe(dialog)
      unchanged()
    }

    await act(() =>
      library.setAppearance({ ...library.getSnapshot().appearance, colorMode: 'light' }),
    )
    expect(html.dataset.theme).toBe('light')
    expect(html.style.getPropertyValue('--accent')).toBe(accents.graphite.light)
    await act(() => radio('Accent color', 'Multicolor (follow macOS)').click())
    expect(html.style.getPropertyValue('--accent')).toBe(accents.blue.light)
    expect(html.style.getPropertyValue('--on-accent')).toBe('#ffffff')
    unchanged()
  } finally {
    await act(() => root.unmount())
    host.remove()
    clearSessions()
    library.setAppearance(defaultAppearance)
  }
})
