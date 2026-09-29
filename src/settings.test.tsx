// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it } from 'vitest'
import Appearance from './components/Appearance'
import { defaultAppearance } from './storage/library'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
function Harness() {
  const [value, setValue] = useState(defaultAppearance)
  const [open, setOpen] = useState(true)
  return (
    <>
      <button onClick={() => setOpen(true)}>Open settings</button>
      <Appearance open={open} onOpenChange={setOpen} value={value} onChange={setValue} />
    </>
  )
}
beforeEach(async () => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(() => root.render(<Harness />))
})
afterEach(async () => {
  await act(() => root.unmount())
  host.remove()
})
const control = (label: string) =>
  document.querySelector(`[aria-label="${label}"]`) as HTMLInputElement
async function category(name: string) {
  const button = [
    ...document.querySelectorAll<HTMLButtonElement>('nav[aria-label="Settings categories"] button'),
  ].find((el) => el.textContent === name)!
  await act(() => button.click())
}
async function openFontPicker(label: string) {
  const button = document.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!
  await act(() => button.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 })))
}
async function search(value: string) {
  await act(() => {
    const input = control('Search settings')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
it('shows one category and preserves changed controls across category switches and reopening', async () => {
  expect(control('Search settings').classList.contains('text-field')).toBe(true)
  expect(control('Search settings').parentElement?.classList.contains('text-field-shell')).toBe(
    true,
  )
  expect(control('Theme')).not.toBeNull()
  expect(control('Cursor style')).toBeNull()
  expect(
    [
      ...document.querySelectorAll<HTMLButtonElement>(
        'nav[aria-label="Settings categories"] button',
      ),
    ]
      .find((button) => button.textContent === 'Appearance')
      ?.getAttribute('aria-current'),
  ).toBe('page')
  await category('Editor')
  expect(control('Theme')).toBeNull()
  expect(
    [
      ...document.querySelectorAll<HTMLButtonElement>(
        'nav[aria-label="Settings categories"] button',
      ),
    ]
      .find((button) => button.textContent === 'Editor')
      ?.getAttribute('aria-current'),
  ).toBe('page')
  const select = control('Cursor style')
  await act(() => {
    select.value = 'underline'
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await category('Typography')
  expect(control('Note font')).not.toBeNull()
  expect(control('Note title font')).not.toBeNull()
  expect(control('Writing width')).toBeNull()
  await category('Editor')
  expect(control('Cursor style').value).toBe('underline')
  await act(() => control('Close settings').click())
  await act(() => host.querySelector('button')!.click())
  expect(control('Theme')).not.toBeNull()
  await category('Editor')
  expect(control('Cursor style').value).toBe('underline')
})
it('keeps the note title font separate from the note-body font', async () => {
  await category('Typography')
  const titleFont = document.querySelector<HTMLButtonElement>('[aria-label="Note title font"]')!
  const noteFont = document.querySelector<HTMLButtonElement>('[aria-label="Note font"]')!
  await openFontPicker('Note title font')
  await act(() => document.querySelector<HTMLElement>('[data-font-value="palatino"]')!.click())
  expect(titleFont.textContent).toContain('Palatino')
  expect(noteFont.textContent).toContain('Georgia')
  await category('Editor')
  await category('Typography')
  expect(
    document.querySelector<HTMLButtonElement>('[aria-label="Note title font"]')!.textContent,
  ).toContain('Palatino')
  expect(
    document.querySelector<HTMLButtonElement>('[aria-label="Note font"]')!.textContent,
  ).toContain('Georgia')
})
it('searches font options before choosing one', async () => {
  await category('Typography')
  const noteFont = document.querySelector<HTMLButtonElement>('[aria-label="Note font"]')!
  await openFontPicker('Note font')
  const searchInput = document.querySelector<HTMLInputElement>('[aria-label="Search Note font"]')!
  expect(searchInput.classList.contains('text-field')).toBe(true)
  expect(searchInput.parentElement?.classList.contains('text-field-shell')).toBe(true)
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      searchInput,
      'pal',
    )
    searchInput.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(document.querySelector('[data-font-value="palatino"]')).not.toBeNull()
  expect(document.querySelector('[data-font-value="georgia"]')).toBeNull()
  await act(() => document.querySelector<HTMLElement>('[data-font-value="palatino"]')!.click())
  expect(noteFont.textContent).toContain('Palatino')
})
it('customizes and resets each heading style without changing the note font', async () => {
  await category('Typography')
  const headingStyles = document.querySelectorAll<HTMLDetailsElement>('.heading-style')
  expect(headingStyles).toHaveLength(6)
  headingStyles[1].open = true

  const noteFont = document.querySelector<HTMLButtonElement>('[aria-label="Note font"]')!
  const h2Font = document.querySelector<HTMLButtonElement>('[aria-label="Heading 2 font"]')!
  expect(h2Font.textContent).toContain('Use note font')
  await openFontPicker('Heading 2 font')
  await act(() => document.querySelector<HTMLElement>('[data-font-value="palatino"]')!.click())
  expect(h2Font.textContent).toContain('Palatino')
  expect(noteFont.textContent).toContain('Georgia')

  const weight = document.querySelector<HTMLSelectElement>('[aria-label="Heading 2 weight"]')!
  await act(() => {
    weight.value = '700'
    weight.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await act(() => control('Heading 2 italic').click())
  await act(() => control('Heading 2 color: Red').click())
  expect(weight.value).toBe('700')
  expect(control('Heading 2 italic').checked).toBe(true)
  expect(control('Heading 2 color: Red').getAttribute('aria-pressed')).toBe('true')

  const customColor = control('Custom color for Heading 2')
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      customColor,
      '#123456',
    )
    customColor.dispatchEvent(new Event('change', { bubbles: true }))
  })
  expect(customColor.value).toBe('#123456')

  await act(() =>
    [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === 'Reset Heading 2')!
      .click(),
  )
  expect(h2Font.textContent).toContain('Use note font')
  expect(weight.value).toBe('600')
  expect(control('Heading 2 italic').checked).toBe(false)
  expect(control('Heading 2 color: Default').getAttribute('aria-pressed')).toBe('true')
})
it('searches labels and descriptions across categories and restores the selected category', async () => {
  await category('Typography')
  await search('  CURSOR  ')
  expect(control('Enable animations')).not.toBeNull()
  expect(control('Cursor style')).not.toBeNull()
  expect(control('Theme')).toBeNull()
  await search('navigation')
  expect(control('Interface font')).not.toBeNull()
  await search('nothing-matches-this')
  expect(document.querySelector('[role="status"]')?.textContent).toContain('No settings found')
  await act(() => control('Clear settings search').click())
  expect(control('Note font')).not.toBeNull()
  expect(control('Cursor style')).toBeNull()
})
it('keeps search results editable and resets search when reopening', async () => {
  await search('animations')
  const toggle = control('Enable animations')
  expect(toggle.getAttribute('role')).toBe('switch')
  await act(() => toggle.click())
  expect(control('Enable animations').checked).toBe(!defaultAppearance.animationsEnabled)
  await act(() => control('Close settings').click())
  await act(() => host.querySelector('button')!.click())
  expect(control('Search settings').value).toBe('')
  expect(control('Enable animations').checked).toBe(!defaultAppearance.animationsEnabled)
})

it('records, validates, clears and resets shortcuts without changing appearance', async () => {
  await category('Keyboard shortcuts')
  await act(() => control('Edit New note shortcut').click())
  const record = () =>
    document.querySelector<HTMLElement>('[aria-label="Record New note shortcut"]')!
  const press = async (key: string, extra: KeyboardEventInit = {}) =>
    act(() =>
      record().dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }),
      ),
    )
  await press('b', { ctrlKey: true })
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('Bold')
  const save = () =>
    [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === 'Save shortcut',
    )!
  expect(save().disabled).toBe(true)
  await press('z', { ctrlKey: true })
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('Undo')
  await press('n', { ctrlKey: true, altKey: true })
  await act(() => save().click())
  const row = () => control('Edit New note shortcut').closest('.shortcut-row')!
  expect(row().querySelector('kbd')?.textContent).toBe('Ctrl+Alt+N')
  await act(() => control('Clear New note shortcut').click())
  expect(row().querySelector('kbd')?.textContent).toBe('Unassigned')
  await act(() => control('Reset New note shortcut').click())
  expect(row().querySelector('kbd')?.textContent).toBe('Ctrl+N')
  await act(() => control('Clear New note shortcut').click())
  await act(() =>
    [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent === 'Reset all to defaults')!
      .click(),
  )
  expect(row().querySelector('kbd')?.textContent).toBe('Unassigned')
  await act(() =>
    [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent === 'Reset shortcuts')!
      .click(),
  )
  expect(row().querySelector('kbd')?.textContent).toBe('Ctrl+N')
  await act(() => control('Edit New note shortcut').click())
  await press('Escape')
  expect(record()).toBeNull()
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  await category('Appearance')
  expect(control('Theme').value).toBe(defaultAppearance.theme)
})
