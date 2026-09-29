// @vitest-environment jsdom
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { afterEach, expect, it, vi } from 'vitest'
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
    extensions: [StarterKit, BodyTags],
    content: '<p>Try #Tutorial.</p>',
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
    extensions: [StarterKit, BodyTags],
    content: '<p>Try #Tutorial and #Ideas.</p>',
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
