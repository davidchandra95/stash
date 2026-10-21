// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it } from 'vitest'
import Settings from './app/Settings'
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
      <Settings
        open={open}
        onOpenChange={setOpen}
        value={value}
        onChange={setValue}
        onSync={() => {}}
      />
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
const modeGroup = () => document.querySelector('[role="radiogroup"][aria-label="Appearance"]')
const checked = (label: string) => control(label).getAttribute('aria-checked')
const radio = (group: string, name: string) =>
  [
    ...document.querySelectorAll<HTMLButtonElement>(
      `[role="radiogroup"][aria-label="${group}"] [role="radio"]`,
    ),
  ].find((button) => (button.getAttribute('aria-label') ?? button.textContent) === name)!
const categoryButton = (name: string) =>
  [
    ...document.querySelectorAll<HTMLButtonElement>('nav[aria-label="Settings categories"] button'),
  ].find((button) => button.textContent === name)
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
it('changes color mode independently of fonts and keeps it across reopening', async () => {
  await category('Typography')
  await openFontPicker('Note title font')
  await act(() => document.querySelector<HTMLElement>('[data-font-value="palatino"]')!.click())
  await category('Appearance')
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
  expect(host.contains(dialog)).toBe(false)
  expect(radio('Appearance', 'Auto').getAttribute('aria-checked')).toBe('true')
  for (const mode of ['Light', 'Dark']) {
    await act(() => radio('Appearance', mode).click())
    expect(radio('Appearance', mode).getAttribute('aria-checked')).toBe('true')
    expect([
      ...document.querySelectorAll(
        '[role="radiogroup"][aria-label="Appearance"] [aria-checked="true"]',
      ),
    ]).toHaveLength(1)
    // Portaled settings follow the document theme rather than carrying their own.
    expect(dialog.hasAttribute('data-theme')).toBe(false)
    expect(dialog.hasAttribute('data-palette')).toBe(false)
  }
  await category('Typography')
  expect(control('Note title font').textContent).toContain('Palatino')
  expect(control('Note font').textContent).toContain('System')
  await act(() => control('Close settings').click())
  await act(() => host.querySelector('button')!.click())
  expect(radio('Appearance', 'Dark').getAttribute('aria-checked')).toBe('true')
})
it('shows one category and preserves changed controls across category switches and reopening', async () => {
  expect(control('Search settings').closest('.field-shell')).not.toBeNull()
  expect(document.activeElement).toBe(control('Search settings'))
  expect(document.querySelector('.settings-title')?.textContent).toBe('Appearance')
  expect(modeGroup()).not.toBeNull()
  expect(control('Cursor style')).toBeNull()
  expect(categoryButton('Appearance')?.getAttribute('aria-current')).toBe('page')
  await category('Editor')
  expect(document.querySelector('.settings-title')?.textContent).toBe('Editor')
  expect(modeGroup()).toBeNull()
  expect(categoryButton('Editor')?.getAttribute('aria-current')).toBe('page')
  expect(categoryButton('Appearance')?.hasAttribute('aria-current')).toBe(false)
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
  expect(modeGroup()).not.toBeNull()
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
  expect(noteFont.textContent).toContain('System')
  await category('Editor')
  await category('Typography')
  expect(
    document.querySelector<HTMLButtonElement>('[aria-label="Note title font"]')!.textContent,
  ).toContain('Palatino')
  expect(
    document.querySelector<HTMLButtonElement>('[aria-label="Note font"]')!.textContent,
  ).toContain('System')
})
it('searches font options before choosing one', async () => {
  await category('Typography')
  const noteFont = document.querySelector<HTMLButtonElement>('[aria-label="Note font"]')!
  await openFontPicker('Note font')
  const searchInput = document.querySelector<HTMLInputElement>('[aria-label="Search Note font"]')!
  expect(searchInput.closest('.field-shell')).not.toBeNull()
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
  expect(noteFont.textContent).toContain('System')

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
  expect(document.querySelector('.settings-title')?.textContent).toBe('Search results')
  expect(categoryButton('Typography')?.hasAttribute('aria-current')).toBe(false)
  // "Animations" matches through its search terms (the writing cursor).
  expect(control('Animations')).not.toBeNull()
  expect(control('Cursor style')).not.toBeNull()
  expect(modeGroup()).toBeNull()
  expect(
    [...document.querySelectorAll('.settings-section-title')].map((h) => h.textContent),
  ).toEqual(['Appearance', 'Editor'])
  await search('vibrancy')
  expect(control('Translucent sidebar')).not.toBeNull()
  await search('nothing-matches-this')
  expect(document.querySelector('.settings-empty[role="status"]')?.textContent).toContain(
    'No results for “nothing-matches-this”',
  )
  await act(() => control('Clear settings search').click())
  expect(control('Search settings').value).toBe('')
  expect(document.activeElement).toBe(control('Search settings'))
  expect(control('Note font')).not.toBeNull()
  expect(control('Cursor style')).toBeNull()
})
it('keeps search results editable and resets search when reopening', async () => {
  await search('animations')
  const toggle = control('Animations')
  expect(toggle.getAttribute('role')).toBe('switch')
  expect(checked('Animations')).toBe(String(defaultAppearance.animationsEnabled))
  await act(() => toggle.click())
  expect(checked('Animations')).toBe(String(!defaultAppearance.animationsEnabled))
  await act(() => control('Close settings').click())
  await act(() => host.querySelector('button')!.click())
  expect(control('Search settings').value).toBe('')
  expect(checked('Animations')).toBe(String(!defaultAppearance.animationsEnabled))
})

it('records, validates, clears and resets shortcuts without changing appearance', async () => {
  await category('Shortcuts')
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
      .find((b) => b.textContent === 'Reset all…')!
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
  expect(radio('Appearance', 'Auto').getAttribute('aria-checked')).toBe('true')
})
it('pins the formatting toolbar from the Editor category', async () => {
  await category('Editor')
  const toggle = control('Always show formatting toolbar')
  expect(toggle.getAttribute('role')).toBe('switch')
  expect(checked('Always show formatting toolbar')).toBe('false')
  await act(() => toggle.click())
  expect(checked('Always show formatting toolbar')).toBe('true')
})
