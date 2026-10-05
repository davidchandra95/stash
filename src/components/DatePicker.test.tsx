// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { writingExtensions } from '../editor/extensions'
import { markdownExtensions } from '../editor/markdown'
import { runCommand } from '../editor/commands'
import {
  calendarDate,
  dateOnlyFormatIndexes,
  moveCalendarDate,
  moveCalendarMonth,
} from '../editor/datePicker'
import { dateFormats } from '../editor/slashOptions'
import DatePicker from './DatePicker'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
Element.prototype.scrollIntoView = vi.fn()
vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
Range.prototype.getClientRects = () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () => new DOMRect()
let root: ReturnType<typeof createRoot> | undefined
let host: HTMLDivElement
let editor: Editor
const fixed = () => calendarDate(2024, 1, 28)
const dialog = () => document.querySelector<HTMLElement>('.date-picker')
const render = (readOnly = false) =>
  root!.render(<DatePicker editor={editor} readOnly={readOnly} />)
async function mount(markdown = false) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(fixed())
  editor = new Editor({
    extensions: markdown ? markdownExtensions : writingExtensions,
    content: '<p></p>',
  })
  host = document.createElement('div')
  document.body.append(host)
  host.append(editor.view.dom)
  root = createRoot(host.appendChild(document.createElement('div')))
  await act(async () => render())
  editor.view.focus()
}
async function type(text = '/date') {
  await act(async () => {
    editor.commands.insertContent(text)
  })
}
async function key(name: string, element?: HTMLElement) {
  await act(async () => {
    const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })
    if (element) element.dispatchEvent(event)
    else editor.view.someProp('handleKeyDown', (handle) => handle(editor.view, event))
  })
}
const button = (label: string) =>
  [...dialog()!.querySelectorAll<HTMLButtonElement>('button')].find(
    (node) => node.getAttribute('aria-label') === label || node.textContent === label,
  )!
async function click(label: string) {
  const node = button(label)
  expect(node).toBeDefined()
  await act(async () => node.click())
}
const dayLabel = (date: Date) =>
  date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  root = undefined
  editor?.destroy()
  host?.remove()
  vi.useRealTimers()
})

it.each([false, true])(
  'opens automatically without taking focus, inserts and undoes (Markdown: %s)',
  async (markdown) => {
    await mount(markdown)
    await type('/DaTe')
    expect(dialog()).not.toBeNull()
    expect(document.activeElement).toBe(editor.view.dom)
    expect(document.querySelector('.slash-menu:not([hidden])')).toBeNull()
    await key('Enter')
    expect(dialog()!.querySelectorAll('.date-format')).toHaveLength(6)
    expect(document.activeElement).toBe(dialog()!.querySelector('.date-format'))
    await click('2024-02-28')
    expect(editor.getText()).toBe('2024-02-28')
    expect(document.activeElement).toBe(editor.view.dom)
    expect(dialog()).toBeNull()
    await act(async () => {
      editor.commands.undo()
    })
    expect(editor.getText()).toBe('/DaTe')
  },
)

it.each(dateOnlyFormatIndexes)('inserts the picked leap day using format %s', async (format) => {
  await mount()
  await type()
  await click(dayLabel(calendarDate(2024, 1, 29)))
  await click(dateFormats(calendarDate(2024, 1, 29))[format])
  expect(editor.getText()).toBe(dateFormats(calendarDate(2024, 1, 29))[format])
})

it.each(['ArrowDown', 'Tab'])(
  'enters the calendar with %s and moves across months',
  async (enter) => {
    await mount()
    await type()
    await key(enter)
    expect(document.activeElement).toBe(button(dayLabel(fixed())))
    await key('ArrowRight', document.activeElement as HTMLElement)
    expect(document.activeElement).toBe(button(dayLabel(calendarDate(2024, 1, 29))))
    await key('ArrowRight', document.activeElement as HTMLElement)
    expect(document.activeElement).toBe(button(dayLabel(calendarDate(2024, 2, 1))))
    await key('ArrowDown', document.activeElement as HTMLElement)
    expect(document.activeElement).toBe(button(dayLabel(calendarDate(2024, 2, 8))))
    await click(dayLabel(calendarDate(2024, 2, 8)))
    await click('Back to calendar')
    expect(document.activeElement).toBe(button(dayLabel(calendarDate(2024, 2, 8))))
    await click('Today')
    await click('2024-02-28')
    expect(editor.getText()).toBe('2024-02-28')
  },
)

it('opens the calendar manually from the Date slash result', async () => {
  await mount()
  await type('/da')
  const option = document.querySelector<HTMLButtonElement>('.slash-option')!
  expect(option.textContent).toBe('Date')
  await act(async () => option.click())
  expect(document.activeElement).toBe(button(dayLabel(fixed())))
  await click(dayLabel(fixed()))
  await click('2024-02-28')
  expect(editor.getText()).toBe('2024-02-28')
})

it('can reopen by finishing the command after cancelling a manual picker', async () => {
  await mount()
  await type('/da')
  await act(async () => document.querySelector<HTMLButtonElement>('.slash-option')!.click())
  await key('Escape', document.activeElement as HTMLElement)
  expect(dialog()).toBeNull()
  expect(document.activeElement).toBe(editor.view.dom)
  await type('te')
  expect(dialog()).not.toBeNull()
  expect(editor.getText()).toBe('/date')
})

it('does not reopen on unchanged Escape dismissal, but reopens after editing', async () => {
  await mount()
  await type()
  await key('Escape')
  expect(editor.getText()).toBe('/date')
  expect(dialog()).toBeNull()
  await act(async () => {
    editor.commands.setTextSelection(6)
  })
  expect(dialog()).toBeNull()
  await key('Enter')
  expect(dialog()).toBeNull()
  await act(async () => {
    editor.commands.deleteRange({ from: 5, to: 6 })
    editor.commands.setTextSelection(5)
  })
  await type('e')
  expect(dialog()).not.toBeNull()
})

it('closes on continued typing and resumes ordinary slash searching', async () => {
  await mount()
  await type()
  await type('x')
  expect(dialog()).toBeNull()
  expect(editor.getText()).toBe('/datex')
  await act(async () => {
    editor.commands.setContent('<p></p>')
  })
  await type('/today')
  expect(document.querySelectorAll('.slash-menu:not([hidden]) .slash-option')).toHaveLength(9)
})

it('maps the original range through edits before it without resetting the picked day', async () => {
  await mount()
  await type('Before /date')
  await click(dayLabel(calendarDate(2024, 1, 29)))
  await act(async () => {
    editor.commands.insertContentAt(1, 'New ')
  })
  await click('2024-02-29')
  expect(editor.getText()).toBe('New Before 2024-02-29')
})

it('discards an invalidated target and ignores stale format buttons', async () => {
  await mount()
  await type()
  await key('Enter')
  const stale = button('2024-02-28')
  await act(async () => {
    editor.commands.insertContentAt({ from: 1, to: 6 }, 'Changed')
  })
  expect(dialog()).toBeNull()
  await act(async () => stale.click())
  expect(editor.getText()).toBe('Changed')
})

it.each(['writing-deactivate', 'writing-dismiss'])(
  'discards pending insertion on %s',
  async (event) => {
    await mount()
    await type()
    await act(async () => editor.view.dom.dispatchEvent(new Event(event)))
    expect(dialog()).toBeNull()
    expect(editor.getText()).toBe('/date')
  },
)

it('closes on read-only changes and rejects subsequent requests', async () => {
  await mount()
  await type()
  await act(async () => {
    editor.setEditable(false)
    render(true)
  })
  expect(dialog()).toBeNull()
  expect(runCommand(editor, 'date', { from: 1, to: 6 })).toBe(false)
  expect(editor.getText()).toBe('/date')
})

it('closes on editor destruction', async () => {
  await mount()
  await type()
  await act(async () => editor.destroy())
  expect(dialog()).toBeNull()
})

it('outside clicks leave the command unchanged and keep the destination focus', async () => {
  await mount()
  await type()
  const outside = document.createElement('button')
  document.body.append(outside)
  // Radix installs the document pointer listener on the next timer tick.
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
  await act(async () => {
    outside.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    outside.focus()
    outside.click()
  })
  expect(dialog()).toBeNull()
  expect(editor.getText()).toBe('/date')
  expect(document.activeElement).toBe(outside)
  outside.remove()
})

it('discards the old target when switching the shared picker to another note', async () => {
  await mount()
  await type()
  await key('Enter')
  const old = editor
  const stale = button('2024-02-28')
  editor = new Editor({ extensions: writingExtensions, content: '<p>Another note</p>' })
  host.append(editor.view.dom)
  await act(async () => render())
  expect(dialog()).toBeNull()
  await act(async () => stale.click())
  expect(old.getText()).toBe('/date')
  expect(editor.getText()).toBe('Another note')
  old.destroy()
})

it('calculates leap, year and local calendar boundaries', () => {
  expect(moveCalendarDate(calendarDate(2024, 1, 28), 1)).toEqual(calendarDate(2024, 1, 29))
  expect(moveCalendarMonth(calendarDate(2024, 0, 31), 1)).toEqual(calendarDate(2024, 1, 29))
  expect(moveCalendarMonth(calendarDate(2023, 0, 31), 1)).toEqual(calendarDate(2023, 1, 28))
  expect(moveCalendarMonth(calendarDate(2023, 11, 31), 1)).toEqual(calendarDate(2024, 0, 31))
  expect(moveCalendarDate(calendarDate(2024, 0, 1), -1)).toEqual(calendarDate(2023, 11, 31))
  expect(calendarDate(2024, 1, 29).getDate()).toBe(29)
})
