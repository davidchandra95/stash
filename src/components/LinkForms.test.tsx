// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { writingExtensions } from '../editor/extensions'
import { markdownExtensions } from '../editor/markdown'
import { runCommand } from '../editor/commands'
import { platform } from '../platform'
import WritingTools from './WritingTools'
import MarkdownTools from './MarkdownTools'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
Element.prototype.scrollIntoView = vi.fn()
Range.prototype.getClientRects = () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () => new DOMRect()
let root: ReturnType<typeof createRoot>, host: HTMLDivElement, editor: Editor
let markdown = false
const render = (readOnly = false) =>
  root.render(
    markdown ? (
      <MarkdownTools editor={editor} readOnly={readOnly} />
    ) : (
      <WritingTools editor={editor} readOnly={readOnly} />
    ),
  )
async function mount(linked = false, content = '<p><strong>hello</strong> world</p>') {
  markdown = linked
  platform.mobile = !linked
  editor = new Editor({ extensions: linked ? markdownExtensions : writingExtensions, content })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    editor.commands.setTextSelection({ from: 1, to: 6 })
    render()
  })
}
async function click(label: string) {
  const b = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.getAttribute('aria-label') === label || b.textContent === label,
  )!
  expect(b).toBeDefined()
  await act(async () => b.click())
}
async function input(label: string, value: string) {
  const labelNode = [...host.querySelectorAll('label')].find(
    (l) => l.textContent?.trim() === label,
  )!
  const field = labelNode.htmlFor
    ? host.querySelector<HTMLInputElement>(`#${labelNode.htmlFor}`)!
    : labelNode.querySelector('input')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
  return field
}
afterEach(async () => {
  if (root) await act(async () => root.unmount())
  editor?.destroy()
  host?.remove()
  platform.mobile = false
})
it.each([false, true])(
  'edits captured titles and mapped selections in mobile/Markdown forms (Markdown: %s)',
  async (linked) => {
    await mount(linked)
    await click(linked ? 'Insert link or image' : 'Insert link')
    const title = await input('Link title', 'New label')
    expect(title.disabled).toBe(false)
    await input('Link address', linked ? 'other-note.md' : 'https://example.com')
    await act(async () => {
      editor.commands.insertContentAt(1, 'Before ')
      editor.commands.setTextSelection(1)
    })
    await click('Apply link')
    expect(editor.getText()).toBe('Before New label world')
    expect(editor.getHTML()).toContain('<strong>New label</strong>')
    expect(editor.getHTML()).toContain(
      linked ? 'href="other-note.md"' : 'href="https://example.com"',
    )
  },
)
it('mobile slash insertion and cancellation preserve the slash until Apply', async () => {
  await mount(false, '<p>/link</p>')
  await act(async () => {
    editor.commands.setTextSelection(6)
    runCommand(editor, 'link', { from: 1, to: 6 })
  })
  await input('Link title', 'Example')
  await input('Link address', 'https://example.com')
  await click('Close writing tools')
  expect(editor.getText()).toBe('/link')
  await act(async () => runCommand(editor, 'link', { from: 1, to: 6 }))
  await input('Link title', 'Example')
  await input('Link address', 'https://example.com')
  await click('Apply link')
  expect(editor.getText()).toBe('Example')
})
it.each([false, true])(
  'closes mobile/Markdown forms on read-only transitions (Markdown: %s)',
  async (linked) => {
    await mount(linked)
    await click(linked ? 'Insert link or image' : 'Insert link')
    await input('Link title', 'Changed')
    await input('Link address', 'https://example.com')
    const before = editor.getJSON(),
      old = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
        (b) => b.textContent === 'Apply link',
      )!
    await act(async () => render(true))
    expect(host.querySelector('[role="dialog"]')).toBeNull()
    await act(async () => old.click())
    expect(editor.getJSON()).toEqual(before)
  },
)
