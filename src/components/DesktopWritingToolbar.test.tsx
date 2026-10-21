// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { writingExtensions } from '../editor/extensions'
import { runCommand } from '../editor/commands'
import { defaultAppearance } from '../storage/library'
import DesktopWritingToolbar from './DesktopWritingToolbar'
import { fitToolbar, toolbarTools } from './writingToolbar'
import { readImage } from '../editor/images'

vi.mock('../editor/images', async (original) => ({
  ...(await original<typeof import('../editor/images')>()),
  readImage: vi.fn(async () => 'data:image/png;base64,aGVsbG8='),
}))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
Element.prototype.scrollIntoView = vi.fn()
Range.prototype.getClientRects = () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () => new DOMRect()

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let editor: Editor
let dockWidth: number
let resize: () => void

beforeEach(() => {
  root = undefined!
  editor = undefined!
  dockWidth = 1000
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    return new DOMRect(
      0,
      0,
      this.dataset.tool === 'style' ? 76 : this.dataset.tool ? 28 : dockWidth,
      28,
    )
  })
  // The toolbar observes the dock for both fitting and bubble placement, so
  // notify every live observer.
  const observers = new Set<() => void>()
  resize = () => observers.forEach((callback) => callback())
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private callback: () => void) {}
      observe() {
        observers.add(this.callback)
      }
      disconnect() {
        observers.delete(this.callback)
      }
    },
  )
})
afterEach(async () => {
  if (root) await act(async () => root.unmount())
  editor?.view.dom.remove()
  editor?.destroy()
  host?.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.mocked(readImage).mockReset().mockResolvedValue('data:image/png;base64,aGVsbG8=')
})

async function mount(content = '<p>hello world</p>', width = 1000) {
  dockWidth = width
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
const toolbar = () => host.querySelector<HTMLElement>('[role="toolbar"]')!
const button = (label: string, parent: ParentNode = document) => {
  const match = [...parent.querySelectorAll<HTMLButtonElement>('button')].find(
    (item) => item.getAttribute('aria-label') === label || item.textContent === label,
  )
  expect(match, label).toBeDefined()
  return match!
}
const click = async (label: string, parent: ParentNode = document) => {
  const target = button(label, parent)
  await act(async () => target.click())
  await settle()
}
// Radix defers outside-pointer registration and close autofocus to the next task.
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 25))
  })
}
async function openOverflow() {
  const trigger = button('More writing tools', toolbar())
  await act(async () =>
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })),
  )
}
async function chooseOverflow(label: string) {
  await openOverflow()
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) =>
    item.textContent?.includes(label),
  )!
  expect(item).toBeDefined()
  await act(async () => item.click())
  await settle()
}
async function input(selector: string, value: string) {
  const field = document.querySelector<HTMLInputElement>(selector)!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

it('uses measured widths, reserves overflow space and preserves the core tools', () => {
  const widths = Object.fromEntries(toolbarTools.map((tool) => [tool.id, 28]))
  Object.assign(widths, { style: 76, overflow: 28 })
  expect(fitToolbar(1000, widths, 2, 8, false).size).toBe(0)
  const hidden = fitToolbar(310, widths, 2, 8, false)
  expect([...hidden]).toEqual([
    'superscript',
    'subscript',
    'checkbox',
    'sections',
    'drawing',
    'image',
    'divider',
    'code',
    'quote',
    'strike',
    'inline-code',
    'table',
    'alignment',
    'link',
    'task',
    'number',
    'bullet',
    'highlight',
  ])
  for (const core of ['style', 'bold', 'italic', 'underline', 'undo', 'redo'])
    expect(hidden.has(core)).toBe(false)
  expect(fitToolbar(804, widths, 2, 8, false).size).toBe(0)
  expect(fitToolbar(804, widths, 2, 8, true).has('superscript')).toBe(true)
})

it('moves icons into overflow and brings them back in stable order after resizing', async () => {
  await mount()
  const initial = [...toolbar().querySelectorAll('[data-tool]')].map((node) =>
    node.getAttribute('data-tool'),
  )
  // Even in a wide pane the floating toolbar is capped at 460px, so the
  // lowest-priority tools always live in the overflow menu.
  const widths = Object.fromEntries(toolbarTools.map((tool) => [tool.id, 28]))
  Object.assign(widths, { style: 76, overflow: 28 })
  const capped = fitToolbar(460, widths, 0, 0, false)
  expect(initial).toEqual([
    'style',
    ...toolbarTools.filter((tool) => !capped.has(tool.id)).map((tool) => tool.id),
  ])
  await act(async () => {
    dockWidth = 310
    resize()
  })
  expect(button('More writing tools', toolbar())).toBeDefined()
  expect(toolbar().querySelector('[data-tool="highlight"]')).toBeNull()
  expect(toolbar().lastElementChild?.getAttribute('aria-label')).toBe('More writing tools')
  await act(async () => {
    dockWidth = 1000
    resize()
  })
  expect(
    [...toolbar().querySelectorAll('[data-tool]')].map((node) => node.getAttribute('data-tool')),
  ).toEqual(initial)
  expect(toolbar().lastElementChild?.getAttribute('aria-label')).toBe('More writing tools')
})

it('keeps custom list controls enabled and checking availability never changes the document', async () => {
  await mount()
  const before = editor.getJSON()
  expect(button('Bullet list', toolbar()).disabled).toBe(false)
  await act(async () => {
    resize()
  })
  expect(editor.getJSON()).toEqual(before)
  await click('Bullet list', toolbar())
  expect(editor.isActive('mixedListItem', { kind: 'bullet' })).toBe(true)
})

it('applies color to the captured selection after document edits, and supports undo and redo', async () => {
  await mount()
  await click('Text color', toolbar())
  expect(document.querySelector('[role="dialog"][aria-label="Text color"]')).not.toBeNull()
  await act(async () => {
    editor.commands.insertContentAt(1, 'X')
    editor.commands.setTextSelection(12)
  })
  await click('Text color Red')
  const first = editor.getJSON().content![0].content!
  expect(first[0]).toMatchObject({ text: 'X' })
  expect(first[1]).toMatchObject({ text: 'hello' })
  expect(first[1].marks).toContainEqual(
    expect.objectContaining({
      type: 'textStyle',
      attrs: expect.objectContaining({ color: '#a83432' }),
    }),
  )
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  await click('Undo', toolbar())
  expect(editor.getHTML()).not.toContain('#a83432')
  await click('Redo', toolbar())
  expect(editor.getHTML()).toContain('#a83432')
})

it('shows the selected color and removes color without removing other formatting', async () => {
  await mount('<p><strong><span style="color:#216f9c">hello</span></strong> world</p>')
  await click('Text color', toolbar())
  expect(button('Text color Blue').getAttribute('aria-pressed')).toBe('true')
  await click('Remove text color')
  expect(editor.getHTML()).not.toContain('#216f9c')
  expect(editor.getHTML()).toContain('<strong>hello</strong>')
})

it('navigates color choices by keyboard and cancels without changing the note', async () => {
  await mount()
  const before = editor.getJSON()
  const trigger = button('Text color', toolbar())
  await click('Text color', toolbar())
  expect(document.activeElement).toBe(button('Text color Red'))
  await act(async () =>
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
    ),
  )
  await settle()
  expect(document.activeElement).toBe(button('Text color Orange'))
  await act(async () =>
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    ),
  )
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(editor.getJSON()).toEqual(before)
  await settle()
  expect(document.activeElement).toBe(trigger)
})

it('opens the same alignment picker from overflow without losing selection', async () => {
  await mount('<p>hello world</p>', 310)
  await chooseOverflow('Alignment')
  expect(document.querySelector('[role="menu"]')).toBeNull()
  expect(document.querySelector('[role="dialog"][aria-label="Alignment"]')).not.toBeNull()
  await click('Center')
  expect(editor.getAttributes('paragraph').textAlign).toBe('center')
})

it('routes hidden slash-command link pickers, validates URLs and removes slash text only after applying', async () => {
  await mount('<p>/link</p>', 270)
  await act(async () => {
    editor.commands.setTextSelection(6)
    runCommand(editor, 'link', { from: 1, to: 6 })
  })
  await input('#desktop-writing-link', 'javascript:bad')
  await click('Apply link')
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('Use an https://')
  expect(editor.getText()).toBe('/link')
  await input('#desktop-writing-link', 'https://example.com')
  await click('Apply link')
  expect(editor.getText()).toBe('https://example.com')
  expect(editor.getHTML()).toContain('href="https://example.com"')
})

it('routes color and image requests and preserves slash text on outside dismissal', async () => {
  await mount('<p>/format</p>', 270)
  await act(async () => runCommand(editor, 'format', { from: 1, to: 8 }))
  await settle()
  expect(document.querySelector('[role="dialog"][aria-label="Text color"]')).not.toBeNull()
  await act(async () =>
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })),
  )
  await act(async () => document.body.click())
  await settle()
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(editor.getText()).toBe('/format')
  await act(async () => runCommand(editor, 'image'))
  expect(document.querySelector<HTMLInputElement>('#desktop-writing-image')?.multiple).toBe(true)
})

it('closes menus and blocks saved portal actions when the note becomes read-only', async () => {
  await mount()
  await click('Text color', toolbar())
  const oldButton = button('Text color Red')
  const before = editor.getJSON()
  await act(async () => root.render(<DesktopWritingToolbar editor={editor} readOnly />))
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(button('Text color', toolbar()).disabled).toBe(true)
  await act(async () => oldButton.click())
  expect(editor.getJSON()).toEqual(before)
  await act(async () => runCommand(editor, 'link'))
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})

it('shows all table actions and cell backgrounds in the focused table picker', async () => {
  await mount()
  // Table is beyond the 460px toolbar cap, so it is reached from overflow.
  await chooseOverflow('Table')
  await click('Insert table')
  expect(editor.isActive('table')).toBe(true)
  await chooseOverflow('Table')
  expect(document.querySelectorAll('[aria-label="Table actions"] button')).toHaveLength(12)
  await click('Cell background Green')
  expect(editor.getAttributes('tableHeader').backgroundColor).toBe('#64ae7040')
})

it('keeps contextual quote background available even when all toolbar icons fit', async () => {
  await mount('<blockquote><p>hello world</p></blockquote>')
  await chooseOverflow('Quote background')
  await click('Quote background Blue')
  expect(editor.getAttributes('blockquote').backgroundColor).toBe('#5b9cd440')
})

it('inserts images at the captured selection and ignores a file read after deactivation', async () => {
  await mount()
  await chooseOverflow('Insert image')
  let finish!: (src: string) => void
  vi.mocked(readImage).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const field = document.querySelector<HTMLInputElement>('#desktop-writing-image')!
  Object.defineProperty(field, 'files', {
    value: [new File(['image'], 'test.png', { type: 'image/png' })],
  })
  await act(async () => field.dispatchEvent(new Event('change', { bubbles: true })))
  await act(async () => editor.view.dom.dispatchEvent(new Event('writing-deactivate')))
  await act(async () => finish('data:image/png;base64,aGVsbG8='))
  expect(editor.getHTML()).not.toContain('<img')
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})

it('inserts selected image files and exposes width and removal actions', async () => {
  await mount()
  await chooseOverflow('Insert image')
  const field = document.querySelector<HTMLInputElement>('#desktop-writing-image')!
  Object.defineProperty(field, 'files', {
    value: [new File(['image'], 'test.png', { type: 'image/png' })],
  })
  await act(async () => field.dispatchEvent(new Event('change', { bubbles: true })))
  await settle()
  expect(editor.getJSON().content![0].content![0].type).toBe('image')
  await act(async () => editor.commands.setNodeSelection(1))
  await chooseOverflow('Insert image')
  await click('600px')
  expect(editor.getJSON().content![0].content![0]).toMatchObject({
    type: 'image',
    attrs: { width: 600 },
  })
  await act(async () => editor.commands.setNodeSelection(1))
  await chooseOverflow('Insert image')
  await click('Remove image')
  expect(editor.getHTML()).not.toContain('<img')
})

it('uses highlight colors and keeps the section actions and contextual backgrounds reachable', async () => {
  await mount()
  await click('Highlight', toolbar())
  await click('Highlight Yellow')
  expect(editor.getAttributes('highlight').color).toBe('#e3d84a45')
  await click('Highlight', toolbar())
  await click('Remove highlight')
  expect(editor.isActive('highlight')).toBe(false)
  await chooseOverflow('Sections')
  await click('Wrap selection in section')
  expect(editor.isActive('collapsibleHeader')).toBe(true)
  await chooseOverflow('Sections')
  expect(document.querySelector('[aria-label="Header background"]')).not.toBeNull()
  await click('Header background Purple')
  expect(editor.getAttributes('collapsibleHeader').backgroundColor).toBe('#a885cc40')
  let bodyPosition = 0
  editor.state.doc.descendants((node, position) => {
    if (node.isText && node.text?.startsWith('hello')) bodyPosition = position
  })
  expect(bodyPosition).toBeGreaterThan(0)
  await act(async () => editor.commands.setTextSelection(bodyPosition))
  await chooseOverflow('Sections')
  await click('Body background Green')
  expect(editor.getAttributes('collapsibleBody').backgroundColor).toBe('#64ae7040')
  await chooseOverflow('Sections')
  await click('Unwrap section')
  expect(editor.isActive('collapsible')).toBe(false)
})

it('closes the previous note picker when the editor instance changes', async () => {
  await mount()
  await click('Text color', toolbar())
  const previous = editor
  const before = previous.getJSON()
  const next = new Editor({ extensions: writingExtensions, content: '<p>other note</p>' })
  document.body.append(next.view.dom)
  await act(async () => root.render(<DesktopWritingToolbar editor={next} readOnly={false} />))
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(previous.getJSON()).toEqual(before)
  previous.view.dom.remove()
  previous.destroy()
  editor = next
})

it('displays writing errors in the portaled picker', async () => {
  await mount()
  await act(async () =>
    editor.view.dom.dispatchEvent(
      new CustomEvent('writing-error', { detail: 'Image could not be read.' }),
    ),
  )
  const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-label="Writing error"]')!
  expect(dialog.classList.contains('popover')).toBe(true)
  expect(dialog.querySelector('[role="alert"]')?.textContent).toBe('Image could not be read.')
})

it('shows the complete link title, preserves formatting for address edits, and edits title with initial marks', async () => {
  await mount('<p><a href="https://old.com"><strong>hello</strong> <em>world</em></a> after</p>')
  await act(async () => editor.commands.setTextSelection(3))
  await click('Insert or edit link', toolbar())
  expect(document.querySelector<HTMLInputElement>('#desktop-writing-link-title')!.value).toBe(
    'hello world',
  )
  await input('#desktop-writing-link', 'https://new.com')
  await click('Apply link')
  expect(editor.getHTML()).toContain('<strong>hello</strong>')
  expect(editor.getHTML()).toContain('<em>world</em>')
  await click('Insert or edit link', toolbar())
  await input('#desktop-writing-link-title', 'New label')
  await click('Apply link')
  expect(editor.getText()).toBe('New label after')
  expect(editor.getHTML()).toContain('<strong>New label</strong>')
})

it('keeps mapped link targets and ignores cancelled or revoked title forms', async () => {
  await mount('<p>hello world</p>')
  await click('Insert or edit link', toolbar())
  await input('#desktop-writing-link-title', 'New title')
  await input('#desktop-writing-link', 'https://example.com')
  await act(async () => editor.commands.insertContentAt(1, 'Before '))
  await click('Apply link')
  expect(editor.getText()).toBe('Before New title world')
  await click('Insert or edit link', toolbar())
  await input('#desktop-writing-link-title', 'Cancelled')
  await click('Close writing menu')
  expect(editor.getText()).toBe('Before New title world')
  await click('Insert or edit link', toolbar())
  const apply = button('Apply link'),
    before = editor.getJSON()
  await act(async () => root.render(<DesktopWritingToolbar editor={editor} readOnly />))
  await act(async () => apply.click())
  expect(editor.getJSON()).toEqual(before)
})

it('disables title editing across blocks while still allowing an address', async () => {
  await mount('<p>first</p><p>second</p>')
  await act(async () => editor.commands.selectAll())
  await click('Insert or edit link', toolbar())
  expect(document.querySelector<HTMLInputElement>('#desktop-writing-link-title')!.disabled).toBe(
    true,
  )
  await input('#desktop-writing-link', 'https://example.com')
  await click('Apply link')
  expect(editor.state.doc.textContent).toBe('firstsecond')
})

it('stays collapsed until text is selected, a picker opens, or the toolbar is pinned', async () => {
  await mount()
  const collapsed = () => toolbar().hasAttribute('data-collapsed')
  // A selection reveals the toolbar only while the editor has focus.
  expect(collapsed()).toBe(true)
  await act(async () => {
    editor.view.focus()
    editor.commands.setTextSelection({ from: 1, to: 6 })
  })
  expect(editor.isFocused).toBe(true)
  expect(collapsed()).toBe(false)
  await act(async () => {
    editor.commands.setTextSelection(3)
  })
  expect(collapsed()).toBe(true)
  // Slash and shortcut pickers need a visible toolbar to anchor to.
  await act(async () => {
    editor.view.dom.dispatchEvent(new CustomEvent('writing-panel', { detail: { id: 'link' } }))
  })
  expect(document.querySelector('#desktop-writing-link')).toBeTruthy()
  expect(collapsed()).toBe(false)
  await act(async () => {
    editor.view.dom.dispatchEvent(new Event('writing-dismiss'))
  })
  await settle()
  expect(document.querySelector('#desktop-writing-link')).toBeNull()
  expect(collapsed()).toBe(true)
  await act(async () =>
    root.render(
      <DesktopWritingToolbar
        editor={editor}
        readOnly={false}
        appearance={{ ...defaultAppearance, showFormattingToolbar: true }}
      />,
    ),
  )
  expect(collapsed()).toBe(false)
  await act(async () => {
    editor.commands.setTextSelection({ from: 1, to: 6 })
    root.render(<DesktopWritingToolbar editor={editor} readOnly />)
  })
  expect(collapsed()).toBe(true)
})

it('stays revealed while keyboard focus is inside it', async () => {
  await mount()
  const bold = button('Bold', toolbar())
  await act(async () => bold.focus())
  await act(async () => {
    editor.commands.setTextSelection(3)
  })
  expect(toolbar().hasAttribute('data-collapsed')).toBe(false)
  await act(async () => bold.blur())
  expect(toolbar().hasAttribute('data-collapsed')).toBe(true)
})
