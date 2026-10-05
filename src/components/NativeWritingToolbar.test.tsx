// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { writingExtensions } from '../editor/extensions'
import DesktopWritingToolbar from './DesktopWritingToolbar'
import {
  cancelNativeContextMenu,
  showNativeContextMenu,
  type NativeMenuAction,
} from '../nativeContextMenu'

vi.mock('../nativeContextMenu', () => ({
  usesNativeContextMenu: () => true,
  showNativeContextMenu: vi.fn(),
  cancelNativeContextMenu: vi.fn(async () => {}),
}))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
Element.prototype.scrollIntoView = vi.fn()
Range.prototype.getClientRects = () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () => new DOMRect()
let editor: Editor
let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let width: number
let resize: () => void
let menus: { actions: NativeMenuAction[]; resolve: () => void; reject: (error: Error) => void }[]
beforeEach(() => {
  width = 1000
  menus = []
  vi.mocked(showNativeContextMenu)
    .mockReset()
    .mockImplementation(
      (actions) =>
        new Promise<void>((resolve, reject) => {
          menus.push({ actions, resolve, reject })
        }),
    )
  vi.mocked(cancelNativeContextMenu).mockClear()
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    return new DOMRect(
      0,
      600,
      this.dataset.tool === 'style' ? 76 : this.dataset.tool ? 28 : width,
      28,
    )
  })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback
      }
      observe() {}
      disconnect() {}
    },
  )
})
afterEach(async () => {
  await act(async () => {
    root.unmount()
    menus.forEach((menu) => menu.resolve())
  })
  editor.view.dom.remove()
  editor.destroy()
  host.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
async function mount(content = '<p>hello world</p>') {
  editor = new Editor({ extensions: writingExtensions, content })
  document.body.append(editor.view.dom)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    editor.commands.setTextSelection({ from: 1, to: 6 })
    root.render(<DesktopWritingToolbar editor={editor} readOnly={false} />)
  })
}
const trigger = (label: string) =>
  host.querySelector<HTMLButtonElement>(`[role="toolbar"] button[aria-label="${label}"]`)!
async function open(label: string, keyboard = false) {
  await act(async () => {
    const button = trigger(label)
    expect(button).not.toBeNull()
    if (keyboard)
      button.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    else button.click()
  })
}
async function choose(label: string, menu = menus.at(-1)!) {
  await act(async () => {
    const action = menu.actions.find((action) => action.label === label)!
    expect(action).toBeDefined()
    expect(action.disabled).not.toBe(true)
    action.run()
    menu.resolve()
  })
}
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 25))
  })
}

it('uses native colors with a checkmark and applies to the mapped selection, then supports undo', async () => {
  await mount('<p><span style="color:#a83432">hello</span> world</p>')
  await open('Text color')
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(menus[0].actions).toHaveLength(7)
  expect(menus[0].actions[0]).toMatchObject({ label: 'Red', checked: true, color: '#a83432' })
  expect(showNativeContextMenu).toHaveBeenCalledWith(
    expect.any(Array),
    host.querySelector('[role="toolbar"]'),
    { x: 0, y: 592 },
    expect.any(Function),
    expect.objectContaining({ above: true, trackingId: expect.any(String) }),
  )
  await act(async () => {
    editor.commands.insertContentAt(1, 'X')
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
  })
  await choose('Blue')
  expect(
    editor.getJSON().content![0].content!.find((node) => 'text' in node && node.text === 'hello')
      ?.marks,
  ).toMatchObject([{ type: 'textStyle', attrs: { color: '#216f9c' } }])
  await settle()
  expect(editor.isFocused).toBe(true)
  await act(async () => editor.commands.undo())
  expect(editor.getHTML()).not.toContain('rgb(33, 111, 156)')
})

it('cancels without editing and returns keyboard focus to the launcher', async () => {
  await mount()
  const before = editor.getJSON()
  await open('Alignment', true)
  expect(menus[0].actions.find((action) => action.label === 'Left')?.checked).toBe(true)
  expect(menus[0].actions.map((action) => action.shortcutId)).toEqual([
    'align-left',
    'align-center',
    'align-right',
    'align-justify',
  ])
  await act(async () => menus[0].resolve())
  expect(editor.getJSON()).toEqual(before)
  expect(document.activeElement).toBe(trigger('Alignment'))
  expect(trigger('Alignment').getAttribute('aria-expanded')).toBe('false')
})

it('keeps focus on a field clicked while a native menu is dismissed', async () => {
  await mount()
  await open('Text color')
  const field = document.createElement('input')
  document.body.append(field)
  await act(async () => {
    field.focus()
    menus[0].resolve()
  })
  expect(document.activeElement).toBe(field)
  field.remove()
})

it('routes overflow to the same native picker after dismissal and retains the selection', async () => {
  await mount()
  width = 250
  await act(async () => resize())
  expect(trigger('Text color')).toBeNull()
  await open('More writing tools', true)
  expect(menus[0].actions.map((action) => action.label)).toContain('Text color')
  await choose('Text color', menus[0])
  expect(menus).toHaveLength(2)
  expect(menus[1].actions.at(-1)?.label).toBe('Remove text color')
  await choose('Green')
  expect(editor.getJSON().content![0].content![0]).toMatchObject({
    text: 'hello',
    marks: [{ type: 'textStyle', attrs: { color: '#387342' } }],
  })
})

it('keeps the native action available when resizing hides its launcher', async () => {
  await mount()
  await open('Text color')
  width = 250
  await act(async () => resize())
  expect(trigger('Text color')).toBeNull()
  expect(vi.mocked(showNativeContextMenu).mock.calls[0][1].isConnected).toBe(true)
  await choose('Blue')
  expect(editor.getAttributes('textStyle').color).toBe('#216f9c')
})

it('routes a new writing request while a native menu is being dismissed', async () => {
  await mount()
  await open('Highlight')
  await act(async () =>
    editor.view.dom.dispatchEvent(new CustomEvent('writing-panel', { detail: { id: 'format' } })),
  )
  expect(cancelNativeContextMenu).toHaveBeenCalled()
  expect(menus).toHaveLength(2)
  await choose('Yellow', menus[0])
  expect(editor.isActive('highlight')).toBe(false)
  await choose('Blue', menus[1])
  expect(editor.getAttributes('textStyle').color).toBe('#216f9c')
})

it('keeps link and table forms available from native overflow and preserves slash removal', async () => {
  await mount('<p>/link</p>')
  width = 250
  await act(async () => resize())
  await act(async () =>
    editor.view.dom.dispatchEvent(
      new CustomEvent('writing-panel', { detail: { id: 'link', range: { from: 1, to: 6 } } }),
    ),
  )
  await settle()
  const input = document.querySelector<HTMLInputElement>('#desktop-writing-link')!
  expect(input).not.toBeNull()
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      input,
      'https://example.com',
    )
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () =>
    input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  )
  await settle()
  expect(editor.getHTML()).not.toContain('/link')
  expect(editor.getHTML()).toContain('href="https://example.com"')
  await open('More writing tools')
  await choose('Table')
  await settle()
  expect(document.querySelector('input[type="number"]')).not.toBeNull()
})

it('cancels tracking for read-only notes and ignores an already queued native choice', async () => {
  await mount()
  await open('Text color')
  const before = editor.getJSON()
  const options = vi.mocked(showNativeContextMenu).mock.calls[0][4]!
  await act(async () => root.render(<DesktopWritingToolbar editor={editor} readOnly />))
  expect(cancelNativeContextMenu).toHaveBeenCalledWith(options.trackingId)
  await choose('Blue')
  expect(editor.getJSON()).toEqual(before)
  expect(trigger('Text color').disabled).toBe(true)
})

it('cancels the old native menu when changing notes', async () => {
  await mount()
  const previous = editor
  const before = previous.getJSON()
  await open('Highlight')
  const next = new Editor({ extensions: writingExtensions, content: '<p>other note</p>' })
  document.body.append(next.view.dom)
  await act(async () => root.render(<DesktopWritingToolbar editor={next} readOnly={false} />))
  expect(cancelNativeContextMenu).toHaveBeenCalled()
  await choose('Yellow')
  expect(previous.getJSON()).toEqual(before)
  expect(next.getHTML()).toBe('<p>other note</p>')
  previous.view.dom.remove()
  previous.destroy()
  editor = next
})

it('retains section commands, disabled states, and contextual header colors', async () => {
  await mount()
  await open('Sections')
  expect(menus[0].actions.find((action) => action.label === 'Unwrap section')?.disabled).toBe(true)
  await choose('Wrap selection in section')
  await open('Sections')
  expect(menus[1].actions.find((action) => action.label === 'Header background')?.disabled).toBe(
    true,
  )
  await choose('Purple')
  expect(editor.getAttributes('collapsibleHeader').backgroundColor).toBe('#a885cc40')
})

it('retains quote backgrounds and removal through native overflow', async () => {
  await mount('<blockquote><p>hello world</p></blockquote>')
  await open('More writing tools')
  await choose('Quote background')
  await choose('Blue')
  expect(editor.getAttributes('blockquote').backgroundColor).toBe('#5b9cd440')
  await open('More writing tools')
  await choose('Quote background')
  await choose('Remove quote background')
  expect(editor.getAttributes('blockquote').backgroundColor).toBeNull()
})

it('reports native failures in an accessible popup', async () => {
  await mount()
  await open('Text color')
  await act(async () => menus[0].reject(new Error('menu unavailable')))
  await settle()
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    'Could not open writing menu: Error: menu unavailable',
  )
  expect(editor.getHTML()).toBe('<p>hello world</p>')
})
