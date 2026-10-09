// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Editor, type JSONContent } from '@tiptap/core'
import { writingExtensions } from './extensions'
import { markdownExtensions, parseMarkdown, serializeMarkdown } from './markdown'
import { renderMermaid } from './mermaid'

vi.mock('./mermaid', () => ({ renderMermaid: vi.fn() }))
const render = vi.mocked(renderMermaid)
const editors: Editor[] = []
const hosts: HTMLElement[] = []
const content = (text: string, language = 'mermaid'): JSONContent => ({
  type: 'doc',
  content: [
    { type: 'codeBlock', attrs: { language }, content: text ? [{ type: 'text', text }] : [] },
  ],
})
function make(doc = content('graph TD\nA-->B'), markdown = false) {
  const host = document.createElement('div')
  document.body.append(host)
  hosts.push(host)
  const editor = new Editor({
    element: host,
    extensions: markdown ? markdownExtensions : writingExtensions,
    content: doc,
  })
  editors.push(editor)
  return editor
}
beforeEach(() => {
  vi.useFakeTimers()
  render.mockResolvedValue('<svg><text>Diagram</text></svg>')
})
afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy())
  hosts.splice(0).forEach((host) => host.remove())
  render.mockReset()
  vi.useRealTimers()
})

it('renders without changing the document, saved HTML, clipboard or update callbacks', async () => {
  const editor = make()
  const changed = vi.fn()
  editor.on('update', changed)
  const before = editor.getJSON()
  await vi.advanceTimersByTimeAsync(200)
  expect(editor.view.dom.querySelector('.mermaid-preview svg')).not.toBeNull()
  expect(editor.view.dom.querySelector('pre code')?.textContent).toBe('graph TD\nA-->B')
  expect(editor.getJSON()).toEqual(before)
  expect(changed).not.toHaveBeenCalled()
  expect(editor.getHTML()).toContain('language-mermaid')
  expect(editor.getHTML()).not.toContain('<svg')
  editor.commands.selectAll()
  expect(
    editor.view.serializeForClipboard(editor.state.selection.content()).dom.querySelector('svg'),
  ).toBeNull()
  expect(render).toHaveBeenCalledTimes(1)
})

it('updates after source edits and follows undo while keeping code keyboard behavior', async () => {
  const editor = make(content('graph TD\nA-->B'))
  await vi.advanceTimersByTimeAsync(200)
  const before = editor.getJSON()
  editor.commands.setTextSelection(editor.state.doc.firstChild!.nodeSize - 1)
  editor.commands.insertContent('\nB-->C')
  await vi.advanceTimersByTimeAsync(200)
  expect(render).toHaveBeenLastCalledWith('graph TD\nA-->B\nB-->C', editor.view.dom)
  expect(editor.isActive('codeBlock')).toBe(true)
  expect(editor.commands.undo()).toBe(true)
  await vi.advanceTimersByTimeAsync(200)
  expect(editor.getJSON().content?.[0]).toEqual(before.content?.[0])
  expect(render).toHaveBeenLastCalledWith('graph TD\nA-->B', editor.view.dom)
})

it('keeps linked Markdown source exact before rendering and serializes source edits', async () => {
  const source = '```mermaid\r\ngraph TD\r\nA-->B\r\n```\r\n'
  const editor = make(parseMarkdown(source), true)
  editor.setEditable(false, false)
  await vi.advanceTimersByTimeAsync(200)
  expect(editor.view.dom.querySelector('.mermaid-preview svg')).not.toBeNull()
  expect(serializeMarkdown(editor.getJSON(), source)).toBe(source)
  editor.setEditable(true, false)
  editor.commands.setTextSelection(1)
  editor.commands.insertContent('%% edited\n')
  expect(serializeMarkdown(editor.getJSON(), source)).toContain('```mermaid\r\n%% edited\r\n')
  expect(serializeMarkdown(editor.getJSON(), source)).not.toContain('<svg')
})

it('ignores stale results and errors after another edit or editor destruction', async () => {
  let resolveOld!: (svg: string) => void
  let rejectLatest!: (error: Error) => void
  render.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveOld = resolve
      }),
  )
  const editor = make()
  await vi.advanceTimersByTimeAsync(200)
  editor.commands.setContent(content('graph TD\nB-->C'))
  await vi.advanceTimersByTimeAsync(200)
  resolveOld('<svg><text>Old result</text></svg>')
  await vi.advanceTimersByTimeAsync(0)
  expect(editor.view.dom.querySelector('.mermaid-preview')?.textContent).toBe('Diagram')
  render.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        rejectLatest = reject
      }),
  )
  editor.commands.setContent(content('graph TD\nC-->D'))
  await vi.advanceTimersByTimeAsync(200)
  const preview = editor.view.dom.querySelector('.mermaid-preview')!
  editor.destroy()
  rejectLatest(Error('Late failure'))
  await vi.advanceTimersByTimeAsync(0)
  expect(preview.textContent).not.toContain('Late failure')
})

it('shows syntax failures as plain text and recovers after the source is fixed', async () => {
  render.mockRejectedValueOnce(Error('<img src=x onerror=alert(1)> Invalid syntax'))
  const editor = make(content('invalid'))
  await vi.advanceTimersByTimeAsync(200)
  expect(editor.view.dom.querySelector('.mermaid-error')?.textContent).toContain('Invalid syntax')
  expect(editor.view.dom.querySelector('.mermaid-preview img')).toBeNull()
  expect(editor.view.dom.querySelector('.mermaid-preview')?.getAttribute('aria-busy')).toBe('false')
  editor.commands.setContent(content('graph TD\nA-->B'))
  await vi.advanceTimersByTimeAsync(200)
  expect(editor.view.dom.querySelector('.mermaid-error')).toBeNull()
  expect(editor.view.dom.querySelector('.mermaid-preview svg')).not.toBeNull()
})

it('adds and removes the preview when changing a code block language', async () => {
  const editor = make(content('graph TD\nA-->B', 'plaintext'))
  expect(editor.view.dom.querySelector('.mermaid-preview')).toBeNull()
  editor.commands.setTextSelection(1)
  editor.commands.updateAttributes('codeBlock', { language: 'mermaid' })
  await vi.advanceTimersByTimeAsync(200)
  expect(editor.view.dom.querySelector('.mermaid-preview svg')).not.toBeNull()
  editor.commands.updateAttributes('codeBlock', { language: 'typescript' })
  expect(editor.view.dom.querySelector('.mermaid-preview')).toBeNull()
  expect(editor.view.dom.querySelector('pre code')?.className).toBe('language-typescript')
  expect(editor.getText()).toContain('graph TD\nA-->B')
})

it('keeps empty diagrams local and refreshes previews on ancestor appearance changes', async () => {
  const editor = make(content(''))
  await vi.advanceTimersByTimeAsync(200)
  expect(render).not.toHaveBeenCalled()
  expect(editor.view.dom.querySelector('.mermaid-preview')?.textContent).toContain(
    'Write Mermaid code',
  )
  editor.commands.setContent(content('graph TD\nA-->B'))
  await vi.advanceTimersByTimeAsync(200)
  const before = editor.getJSON()
  hosts[0].setAttribute('data-theme', 'dark')
  await vi.advanceTimersByTimeAsync(200)
  expect(render).toHaveBeenCalledTimes(2)
  expect(editor.getJSON()).toEqual(before)
})
