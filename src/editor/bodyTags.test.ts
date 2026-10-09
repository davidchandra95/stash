// @vitest-environment jsdom
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { afterEach, expect, it, vi } from 'vitest'
import { insertLiteral } from './plainPaste'
import { BodyTagMark } from './tagMark'
import { tagsFromContent } from '../tags'
import { markdownExtensions, parseMarkdown, serializeMarkdown } from './markdown'
import { writingExtensions } from './extensions'
import { BodyTags, setBodyTagContext } from './bodyTags'

let editor: Editor | undefined
let host: HTMLDivElement | undefined

afterEach(() => {
  editor?.destroy()
  host?.remove()
  editor = undefined
  host = undefined
})

it('edits normally but opens a body hashtag with Command-click or keyboard activation', () => {
  host = document.createElement('div')
  document.body.append(host)
  editor = new Editor({
    element: host,
    extensions: [StarterKit, BodyTagMark, BodyTags],
    content: '<p>Try <span data-confirmed-tag="tutorial">#Tutorial</span>.</p>',
  })
  const open = vi.fn()
  setBodyTagContext(editor, { open })
  const tag = host.querySelector<HTMLElement>('[data-body-tag]')!
  expect(tag.textContent).toBe('#Tutorial')
  expect(tag.getAttribute('aria-label')).toBe('Open tag #tutorial')

  const ordinary = new MouseEvent('click', { bubbles: true, cancelable: true })
  tag.dispatchEvent(ordinary)
  expect(ordinary.defaultPrevented).toBe(false)
  expect(open).not.toHaveBeenCalled()

  const modified = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    metaKey: true,
  })
  tag.dispatchEvent(modified)
  expect(modified.defaultPrevented).toBe(true)
  expect(open).toHaveBeenCalledWith('tutorial')

  tag.focus()
  tag.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  tag.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }))
  expect(open).toHaveBeenCalledTimes(3)
})

it('shows the clickable cursor only while Command is held over a body tag', () => {
  host = document.createElement('div')
  document.body.append(host)
  editor = new Editor({
    element: host,
    extensions: [StarterKit, BodyTagMark, BodyTags],
    content:
      '<p>Try <span data-confirmed-tag="tutorial">#Tutorial</span> and <span data-confirmed-tag="ideas">#Ideas</span>.</p>',
  })
  const [first, second] = host.querySelectorAll<HTMLElement>('[data-body-tag]')
  const command = (type: 'keydown' | 'keyup', metaKey: boolean) =>
    document.dispatchEvent(new KeyboardEvent(type, { key: 'Meta', metaKey, bubbles: true }))
  const hover = (tag: HTMLElement, metaKey: boolean) =>
    tag.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, metaKey }))

  hover(first, false)
  expect(first.classList.contains('body-tag-command-hover')).toBe(false)
  command('keydown', true)
  expect(first.classList.contains('body-tag-command-hover')).toBe(true)
  command('keyup', false)
  expect(first.classList.contains('body-tag-command-hover')).toBe(false)

  command('keydown', true)
  hover(second, true)
  expect(first.classList.contains('body-tag-command-hover')).toBe(false)
  expect(second.classList.contains('body-tag-command-hover')).toBe(true)
  second.dispatchEvent(new PointerEvent('pointerout', { bubbles: true }))
  expect(second.classList.contains('body-tag-command-hover')).toBe(false)

  hover(first, true)
  window.dispatchEvent(new Event('blur'))
  expect(first.classList.contains('body-tag-command-hover')).toBe(false)
  editor.destroy()
  expect(first.classList.contains('body-tag-command-hover')).toBe(false)
})

function setup(content = '<p></p>', markdown = false) {
  host = document.createElement('div')
  document.body.append(host)
  editor = new Editor({
    element: host,
    extensions: markdown ? markdownExtensions : writingExtensions,
    content,
  })
  vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({ left: 10, right: 10, top: 10, bottom: 20 })
  editor.commands.setTextSelection(1)
  return editor
}
function type(text: string) {
  const { view } = editor!
  const { from, to } = view.state.selection
  let handled = false
  view.someProp('handleTextInput', (handler) => {
    handled = !!handler(view, from, to, text, () => view.state.tr.insertText(text))
    return handled
  })
  if (!handled) view.dispatch(view.state.tr.insertText(text))
}
function key(key: string) {
  editor!.view.someProp('handleKeyDown', (handler) =>
    handler(editor!.view, new KeyboardEvent('keydown', { key })),
  )
}
function tags() {
  return tagsFromContent(editor!.getJSON())
}

it('only confirms typed tags with Enter or a clicked choice', () => {
  setup()
  setBodyTagContext(editor!, { open: vi.fn(), tags: () => ['tutorial'] })
  type('#tut')
  expect(tags()).toEqual([])
  expect(host!.querySelector('[data-body-tag]')).toBeNull()
  key('Enter')
  expect(tags()).toEqual(['tutorial'])
  expect(editor!.getText()).toBe('#tutorial')
  type(' ')
  type('#new')
  const create = document.querySelector<HTMLButtonElement>('.body-tag-menu button:last-child')!
  expect(create.textContent).toContain('Create new tag')
  create.click()
  expect(tags()).toEqual(['tutorial', 'new'])
})

it('dismisses without confirmation and does not offer tags on cursor movement or paste', () => {
  setup('<p>#abcdef #external</p>')
  editor!.commands.setTextSelection(8)
  key('Enter')
  expect(tags()).toEqual([])
  type('#typed')
  key('Escape')
  key('Enter')
  expect(tags()).toEqual([])
  type('#space')
  type(' ')
  key('Enter')
  expect(tags()).toEqual([])
})

it('removes confirmation on edits and supports undo and redo', () => {
  setup()
  type('#tutorial')
  key('Enter')
  expect(tags()).toEqual(['tutorial'])
  editor!.commands.undo()
  expect(tags()).toEqual([])
  expect(editor!.getText()).toBe('#tutorial')
  editor!.commands.redo()
  expect(tags()).toEqual(['tutorial'])
  editor!.commands.setTextSelection(4)
  type('x')
  expect(tags()).toEqual([])
  key('Escape')
  editor!.commands.undo()
  expect(tags()).toEqual(['tutorial'])
})

it('does not extend confirmed marks when typing at their edges', () => {
  setup('<p><span data-confirmed-tag="tag">#tag</span></p>')
  editor!.commands.setTextSelection(5)
  type('x')
  expect(tags()).toEqual(['tag'])
  expect(editor!.getJSON().content![0].content!.at(-1)!.marks).toBeUndefined()
})

it('round trips confirmed tags through Markdown but leaves ordinary hashtags alone', () => {
  setup()
  type('#tutorial')
  key('Enter')
  const source = serializeMarkdown(editor!.getJSON())
  expect(source).toContain('<span data-confirmed-tag="tutorial">#tutorial</span>')
  expect(tagsFromContent(parseMarkdown(source + '\n\n#abcdef #plain'))).toEqual(['tutorial'])
  expect(tagsFromContent(parseMarkdown('`' + source.trim() + '`'))).toEqual([])
})

it('allows confirming tags in the Markdown editor', () => {
  setup('<p></p>', true)
  type('#linked')
  key('Enter')
  expect(tags()).toEqual(['linked'])
  expect(tagsFromContent(parseMarkdown(serializeMarkdown(editor!.getJSON())))).toEqual(['linked'])
})

it.each(['two_words', 'a*b', 'a&b', '中文', 'a<b', 'a"b', 'a\\b'])(
  'preserves tag name %s through Markdown',
  (name) => {
    setup()
    type(`#${name}`)
    key('Enter')
    const source = serializeMarkdown(editor!.getJSON())
    expect(tagsFromContent(parseMarkdown(source))).toEqual([name])
  },
)

it('keeps partial formatting inside a confirmed tag through Markdown', () => {
  setup('<p><span data-confirmed-tag="tutorial">#<strong>tut</strong>orial</span></p>')
  const source = serializeMarkdown(editor!.getJSON())
  const parsed = parseMarkdown(source)
  expect(tagsFromContent(parsed)).toEqual(['tutorial'])
  expect(JSON.stringify(parsed)).toContain('bold')
})

it('copies mixed tags as HTML, drops partial tags, and leaves plain paste unconfirmed', () => {
  setup('<p><span data-confirmed-tag="tutorial">#Tutorial</span> #abcdef #plain</p>')
  editor!.commands.selectAll()
  const copied = editor!.view.serializeForClipboard(editor!.state.selection.content())
  const destination = new Editor({ extensions: writingExtensions, content: '<p></p>' })
  const paste = (html: string, text = '') => {
    const event = {
      clipboardData: {
        getData: (type: string) =>
          type === 'text/html' ? html : type === 'text/plain' ? text : '',
        files: [],
        items: [],
      },
    } as unknown as ClipboardEvent
    if (html) destination.view.pasteHTML(html, event)
    else destination.view.pasteText(text, event)
  }
  try {
    paste(copied.dom.innerHTML, copied.text)
    expect(tagsFromContent(destination.getJSON())).toEqual(['tutorial'])
    expect(destination.getText()).toBe('#Tutorial #abcdef #plain')
    destination.commands.clearContent()
    paste('', copied.text)
    expect(tagsFromContent(destination.getJSON())).toEqual([])
    editor!.commands.setTextSelection({ from: 2, to: 5 })
    const partial = editor!.view.serializeForClipboard(editor!.state.selection.content())
    destination.commands.clearContent()
    paste(partial.dom.innerHTML, partial.text)
    expect(destination.getText()).toBe('Tut')
    expect(tagsFromContent(destination.getJSON())).toEqual([])
    destination.commands.clearContent()
    paste('<p style="color:#abcdef">#external #abcdef</p>')
    expect(tagsFromContent(destination.getJSON())).toEqual([])
    destination.commands.clearContent()
    insertLiteral(destination, '#plain')
    expect(tagsFromContent(destination.getJSON())).toEqual([])
  } finally {
    destination.destroy()
  }
})

it('ignores code and composing input', () => {
  setup('<pre><code></code></pre>')
  type('#code')
  expect(document.querySelector<HTMLElement>('.body-tag-menu')!.hidden).toBe(true)
  expect(tags()).toEqual([])
  editor!.commands.setContent('<p></p>')
  editor!.view.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
  type('#composing')
  key('Enter')
  expect(tags()).toEqual([])
})

it('preserves typed case and removes confirmation even for a case-only edit', () => {
  setup()
  type('#Tutorial')
  key('Enter')
  expect(editor!.getText()).toBe('#Tutorial')
  expect(tags()).toEqual(['tutorial'])
  editor!.view.dispatch(editor!.state.tr.insertText('t', 2, 3))
  expect(editor!.getText()).toBe('#tutorial')
  expect(tags()).toEqual([])
  editor!.commands.undo()
  expect(tags()).toEqual(['tutorial'])
})

it('confirms the entire edited token when typing inside a hashtag', () => {
  setup('<p><span data-confirmed-tag="tag">#tag</span></p>')
  editor!.commands.setTextSelection(3)
  type('x')
  expect(tags()).toEqual([])
  key('Enter')
  expect(editor!.getText()).toBe('#txag')
  expect(tags()).toEqual(['txag'])
  expect(editor!.state.selection.from).toBe(6)
})

it('keeps tag identity across formatted runs when copying HTML', () => {
  setup('<p><span data-confirmed-tag="tutorial">#<strong>tut</strong>orial</span></p>')
  editor!.commands.selectAll()
  const { dom } = editor!.view.serializeForClipboard(editor!.state.selection.content())
  expect(dom.querySelectorAll('[data-confirmed-tag]')).toHaveLength(1)
  const destination = new Editor({ extensions: writingExtensions, content: dom.innerHTML })
  try {
    expect(tagsFromContent(destination.getJSON())).toEqual(['tutorial'])
    expect(destination.getHTML()).toContain('<strong>tut</strong>')
  } finally {
    destination.destroy()
  }
})

it('offers confirmation after composition finishes, never while composing', async () => {
  setup()
  editor!.view.focus()
  editor!.view.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
  type('#中文')
  expect(document.querySelector<HTMLElement>('.body-tag-menu')!.hidden).toBe(true)
  editor!.view.dom.dispatchEvent(
    new CompositionEvent('compositionend', { bubbles: true, data: '中文' }),
  )
  await new Promise((resolve) => requestAnimationFrame(resolve))
  expect(document.querySelector<HTMLElement>('.body-tag-menu')!.hidden).toBe(false)
  key('Enter')
  expect(tags()).toEqual(['中文'])
})

it.each(['bold', 'italic', 'strike', 'code', 'link'])(
  'preserves tags with %s formatting in Markdown',
  (mark) => {
    setup()
    editor!.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: '#tutorial',
              marks: [
                { type: 'bodyTag', attrs: { tag: 'tutorial' } },
                {
                  type: mark,
                  ...(mark === 'link' ? { attrs: { href: 'https://example.com' } } : {}),
                },
              ],
            },
          ],
        },
      ],
    })
    expect(tagsFromContent(parseMarkdown(serializeMarkdown(editor!.getJSON())))).toEqual([
      'tutorial',
    ])
  },
)
