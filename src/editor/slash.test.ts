// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { writingExtensions } from './extensions'
import { dateFormats } from './slashOptions'
import { searchSlash, slashCatalog } from './slashCatalog'

let editor: Editor | undefined
Element.prototype.scrollIntoView = vi.fn()
Range.prototype.getClientRects = () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () =>
  ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }) as DOMRect

const options = () => [
  ...document.querySelectorAll<HTMLElement>('.slash-menu:not([hidden]) .slash-option'),
]
const selectedIndex = () =>
  options().findIndex((row) => row.getAttribute('aria-selected') === 'true')
function key(key: string) {
  editor!.view.someProp('handleKeyDown', (handle) =>
    handle(editor!.view, new KeyboardEvent('keydown', { key })),
  )
}
function openDates() {
  editor = new Editor({ extensions: writingExtensions, content: '<p></p>' })
  editor.commands.insertContent('/today')
  expect(options()).toHaveLength(9)
}
afterEach(() => {
  editor?.destroy()
  editor = undefined
})

it.each(['da', 'dat', 'DA'])('shows only Date for /%s', (query) => {
  editor = new Editor({ extensions: writingExtensions, content: '<p></p>' })
  editor.commands.insertContent(`/${query}`)
  expect(options().map((option) => option.getAttribute('aria-label'))).toEqual(['Date'])
  expect(options()[0].parentElement!.classList.contains('slash-menu-dates')).toBe(false)
})

it.each(['d', 'da', 'dat', 'date', 'day', 'friday'])(
  'excludes Today previews from %s searches',
  (query) => {
    expect(
      searchSlash(slashCatalog(), query).some((entry) => entry.command?.startsWith('today-')),
    ).toBe(false)
  },
)

it.each(['t', 'to', 'tod', 'toda', 'today', 'TODAY'])(
  'keeps all Today formats for /%s',
  (query) => {
    expect(
      searchSlash(slashCatalog(), query).filter((entry) => entry.command?.startsWith('today-')),
    ).toHaveLength(9)
  },
)

it('keeps date keyboard selection when a stationary pointer re-enters rebuilt rows', async () => {
  openDates()
  const menu = options()[0].parentElement!
  // Browsers can send mouseenter to a new row under an unmoved pointer.
  const pointer = new MutationObserver((changes) => {
    if (changes.some((change) => change.addedNodes.length))
      options()[0]?.dispatchEvent(new MouseEvent('mouseenter'))
  })
  pointer.observe(menu, { childList: true })
  try {
    for (let index = 1; index < 9; index++) {
      key('ArrowDown')
      await Promise.resolve()
      expect(selectedIndex()).toBe(index)
      expect(editor!.getText()).toBe('/today')
    }
    key('ArrowDown')
    await Promise.resolve()
    expect(selectedIndex()).toBe(0)
    key('ArrowUp')
    await Promise.resolve()
    expect(selectedIndex()).toBe(8)
    key('Enter')
    expect(editor!.getText()).toBe(dateFormats()[8])
    expect(options()).toHaveLength(0)
  } finally {
    pointer.disconnect()
  }
})

it('lets pointer movement select a date after keyboard navigation', () => {
  openDates()
  key('ArrowDown')
  options()[5].dispatchEvent(new MouseEvent('mousemove'))
  expect(selectedIndex()).toBe(5)
  key('ArrowDown')
  expect(selectedIndex()).toBe(6)
  options()[3].click()
  expect(editor!.getText()).toBe(dateFormats()[3])
})
