// @vitest-environment jsdom
import { act, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const native = vi.hoisted(() => ({ enabled: false, invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke, isTauri: () => native.enabled }))
import Settings from './Settings'
import { accentColors, accents } from '../appearance'
import type { Appearance } from '../model'
import { platform } from '../platform'
import { defaultAppearance, type LibraryState } from '../storage/library'
import { library } from '../storage/useLibrary'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let current: Appearance
let onSync: ReturnType<typeof vi.fn<() => void>>

function Harness({
  initial = defaultAppearance,
  startOpen = true,
  syncSettings,
  initialCategory,
}: {
  initial?: Appearance
  startOpen?: boolean
  syncSettings?: ReactNode
  initialCategory?: 'appearance' | 'sync'
}) {
  const [value, setValue] = useState(initial)
  const [open, setOpen] = useState(startOpen)
  current = value
  return (
    <>
      <button onClick={() => setOpen(true)}>Open settings</button>
      <Settings
        open={open}
        onOpenChange={setOpen}
        value={value}
        onChange={setValue}
        initialCategory={initialCategory}
        syncSettings={syncSettings}
        onSync={onSync}
      />
    </>
  )
}
const render = (props: Parameters<typeof Harness>[0] = {}) =>
  act(() => root.render(<Harness {...props} />))

beforeEach(() => {
  native.enabled = false
  native.invoke.mockReset().mockResolvedValue([])
  platform.platform = 'browser'
  onSync = vi.fn<() => void>()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(() => root.unmount())
  host.remove()
  platform.platform = 'browser'
  vi.restoreAllMocks()
})

const control = <T extends HTMLElement = HTMLInputElement>(label: string) =>
  document.querySelector<T>(`[aria-label="${label}"]`)
const title = () => document.querySelector('.settings-title')?.textContent
const categories = () =>
  [
    ...document.querySelectorAll<HTMLButtonElement>('nav[aria-label="Settings categories"] button'),
  ].map((button) => button.textContent)
async function category(name: string) {
  const button = [
    ...document.querySelectorAll<HTMLButtonElement>('nav[aria-label="Settings categories"] button'),
  ].find((el) => el.textContent === name)!
  await act(() => button.click())
}
const radios = (group: string) => [
  ...document.querySelectorAll<HTMLButtonElement>(
    `[role="radiogroup"][aria-label="${group}"] [role="radio"]`,
  ),
]
const radioName = (button: HTMLElement) => button.getAttribute('aria-label') ?? button.textContent
const radio = (group: string, name: string) =>
  radios(group).find((button) => radioName(button) === name)!
const checkedRadios = (group: string) =>
  radios(group)
    .filter((button) => button.getAttribute('aria-checked') === 'true')
    .map(radioName)
async function type(input: HTMLInputElement, value: string) {
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function slide(label: string, value: string) {
  const input = control(label)!
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}
const button = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find((el) => el.textContent === text)
const setLibraryState = (patch: Partial<LibraryState>) =>
  act(() => (library as unknown as { publish(p: Partial<LibraryState>): void }).publish(patch))

it('opens on Appearance with the search focused and switches between categories', async () => {
  await render()
  expect(categories()).toEqual(['Appearance', 'Typography', 'Editor', 'Shortcuts'])
  expect(title()).toBe('Appearance')
  expect(document.querySelector('[role="dialog"]')?.classList.contains('settings')).toBe(true)
  expect(document.activeElement).toBe(control('Search settings'))
  expect(document.querySelector('[aria-current="page"]')?.textContent).toBe('Appearance')
  expect(radios('Appearance')).toHaveLength(3)

  await category('Typography')
  expect(title()).toBe('Typography')
  expect(document.querySelector('[aria-current="page"]')?.textContent).toBe('Typography')
  expect(radios('Appearance')).toHaveLength(0)
  expect(control('Note font')).not.toBeNull()
  expect(control('Interface font')).toBeNull()
  expect(document.body.textContent).toContain('Installed fonts are available in the Mac app.')

  await category('Editor')
  expect(title()).toBe('Editor')
  expect(control('Writing width')).not.toBeNull()
  expect(control('Note font')).toBeNull()

  await category('Shortcuts')
  expect(title()).toBe('Shortcuts')
  expect(control('Search shortcuts')).not.toBeNull()
  expect(control('Edit New note shortcut')).not.toBeNull()
})

it('offers Light, Dark and Auto as one radio group and changes only the color mode', async () => {
  await render()
  expect(radios('Appearance').map(radioName)).toEqual(['Light', 'Dark', 'Auto'])
  expect(checkedRadios('Appearance')).toEqual(['Auto'])
  await act(() => radio('Appearance', 'Dark').click())
  expect(current).toEqual({ ...defaultAppearance, colorMode: 'dark' })
  expect(checkedRadios('Appearance')).toEqual(['Dark'])
  await act(() => radio('Appearance', 'Light').click())
  expect(current).toEqual({ ...defaultAppearance, colorMode: 'light' })
  expect(checkedRadios('Appearance')).toEqual(['Light'])
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
})

it('offers every accent color plus the macOS accent and changes only the accent', async () => {
  await render()
  expect(radios('Accent color').map(radioName)).toEqual([
    'Multicolor (follow macOS)',
    ...accentColors.map((accent) => accents[accent].label),
  ])
  expect(checkedRadios('Accent color')).toEqual(['Multicolor (follow macOS)'])
  expect(document.body.textContent).toContain('Follows your macOS accent color')
  await act(() => radio('Accent color', 'Pink').click())
  expect(current).toEqual({ ...defaultAppearance, accent: 'pink' })
  expect(checkedRadios('Accent color')).toEqual(['Pink'])
  expect(document.body.textContent).not.toContain('Follows your macOS accent color')
  await act(() => radio('Accent color', 'Multicolor (follow macOS)').click())
  expect(current.accent).toBe('system')
})

it('toggles switches with role=switch and aria-checked, changing one preference at a time', async () => {
  await render()
  const switches = () =>
    [...document.querySelectorAll<HTMLButtonElement>('[role="switch"]')].map((el) =>
      el.getAttribute('aria-label'),
    )
  expect(switches()).toEqual(['Translucent sidebar', 'Show note counts in sidebar', 'Animations'])
  const counts = control<HTMLButtonElement>('Show note counts in sidebar')!
  expect(counts.getAttribute('aria-checked')).toBe('true')
  await act(() => counts.click())
  expect(current).toEqual({ ...defaultAppearance, sidebarCounts: false })
  expect(counts.getAttribute('aria-checked')).toBe('false')
  await act(() => control<HTMLButtonElement>('Animations')!.click())
  expect(current).toEqual({ ...defaultAppearance, sidebarCounts: false, animationsEnabled: false })

  await category('Editor')
  expect(switches()).toEqual(['Always show formatting toolbar', 'Smooth caret animation'])
  await act(() => control<HTMLButtonElement>('Smooth caret animation')!.click())
  expect(current.cursorSmoothCaretAnimation).toBe('on')
  expect(control('Smooth caret animation')!.getAttribute('aria-checked')).toBe('true')
  await act(() => control<HTMLButtonElement>('Always show formatting toolbar')!.click())
  expect(current.showFormattingToolbar).toBe(true)
})

it('disables the translucent sidebar outside the Mac app', async () => {
  await render()
  const toggle = control<HTMLButtonElement>('Translucent sidebar')!
  expect(toggle.disabled).toBe(true)
  expect(toggle.getAttribute('aria-checked')).toBe('true')
  expect(toggle.closest('.settings-row')?.textContent).toContain('Available in the Mac app')
  await act(() => toggle.click())
  expect(current).toEqual(defaultAppearance)
})

it('lets the native Mac app turn the translucent sidebar off', async () => {
  native.enabled = true
  platform.platform = 'macos'
  await render()
  const toggle = control<HTMLButtonElement>('Translucent sidebar')!
  expect(toggle.disabled).toBe(false)
  expect(toggle.closest('.settings-row')?.textContent).not.toContain('Available in the Mac app')
  await act(() => toggle.click())
  expect(current).toEqual({ ...defaultAppearance, translucentSidebar: false })
  expect(native.invoke).toHaveBeenCalledWith('installed_fonts')
})

it('writes the note list mode to the library instead of the appearance', async () => {
  const setNoteListMode = vi.spyOn(library, 'setNoteListMode').mockImplementation(() => {})
  await render()
  const select = control<HTMLSelectElement>('Note list')!
  expect([...select.options].map((option) => option.textContent)).toEqual(['Compact', 'Preview'])
  expect(select.value).toBe('compact')
  await act(() => {
    select.value = 'preview'
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  expect(setNoteListMode).toHaveBeenCalledWith('preview')
  expect(current).toEqual(defaultAppearance)
})

it('updates sliders with their ranges and spoken values without changing other preferences', async () => {
  const initial = { ...defaultAppearance, lineSpacing: 1.8, paragraphSpacing: 12 }
  await render({ initial })
  await category('Typography')
  const size = control('Note font size')!
  expect([size.type, size.min, size.max, size.value]).toEqual(['range', '13', '23', '15'])
  expect(size.getAttribute('aria-valuetext')).toBe('15 pt')
  expect(size.parentElement?.querySelector('output')?.textContent).toBe('15 pt')
  await slide('Note font size', '18')
  expect(current).toEqual({ ...initial, size: 18 })
  expect(size.getAttribute('aria-valuetext')).toBe('18 pt')

  await category('Editor')
  expect(control('Line spacing')!.getAttribute('aria-valuetext')).toBe('1.8×')
  expect(control('Writing width')!.getAttribute('aria-valuetext')).toBe('80%')
  const spacing = control('List item spacing')!
  expect(spacing.value).toBe('0')
  expect(spacing.min).toBe('-8')
  await slide('List item spacing', '-4')
  expect(current).toEqual({ ...initial, size: 18, listItemSpacing: -4 })
  expect(spacing.getAttribute('aria-valuetext')).toBe('-4 px')
  await slide('Extra space below the note', '200')
  expect(current.editorBottomSpace).toBe(200)
  expect(control('Extra space below the note')!.step).toBe('8')
})

it('searches settings and shortcuts across categories and clears back to the category', async () => {
  await render()
  await category('Editor')
  await type(control('Search settings')!, 'heading')
  expect(title()).toBe('Search results')
  expect(document.querySelector('[aria-current="page"]')).toBeNull()
  expect(
    [...document.querySelectorAll('.settings-section-title')].map((h) => h.textContent),
  ).toEqual(['Typography', 'Shortcuts'])
  expect(document.querySelectorAll('.heading-style')).toHaveLength(6)
  expect(control('Edit Heading 2 shortcut')).not.toBeNull()
  expect(control('Edit New note shortcut')).toBeNull()

  await type(control('Search settings')!, 'ACCENT')
  expect(radios('Accent color')).toHaveLength(accentColors.length + 1)
  await act(() => radio('Accent color', 'Green').click())
  expect(current.accent).toBe('green')

  await type(control('Search settings')!, 'qqq-nothing')
  expect(document.querySelector('.settings-empty[role="status"]')?.textContent).toBe(
    'No results for “qqq-nothing”',
  )
  await act(() => control<HTMLButtonElement>('Clear settings search')!.click())
  expect(control('Search settings')!.value).toBe('')
  expect(control('Clear settings search')).toBeNull()
  expect(title()).toBe('Editor')
  expect(control('Writing width')).not.toBeNull()
})

it('filters the shortcut list and resets the filter when reopening', async () => {
  await render()
  await category('Shortcuts')
  const rows = () => document.querySelectorAll('.shortcut-row').length
  const all = rows()
  expect(all).toBeGreaterThan(10)
  await type(control('Search shortcuts')!, 'tab')
  expect(rows()).toBeLessThan(all)
  expect(control('Edit Next tab shortcut')).not.toBeNull()
  expect(control('Edit Bold shortcut')).toBeNull()
  expect(control('Search settings')!.value).toBe('')
  await type(control('Search shortcuts')!, 'zzzz')
  expect(rows()).toBe(0)
  expect(document.body.textContent).toContain('No shortcuts found.')
  await act(() => control<HTMLButtonElement>('Close settings')!.click())
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  await act(() => button('Open settings')!.click())
  expect(title()).toBe('Appearance')
  await category('Shortcuts')
  expect(control('Search shortcuts')!.value).toBe('')
  expect(rows()).toBe(all)
})

it('returns focus to the opener after closing', async () => {
  await render({ startOpen: false })
  const opener = button('Open settings')!
  opener.focus()
  await act(() => opener.click())
  expect(document.activeElement).toBe(control('Search settings'))
  await act(() => control<HTMLButtonElement>('Close settings')!.click())
  // Radix restores focus from a timeout after the dialog unmounts.
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
  expect(document.activeElement).toBe(opener)
})

it('shows the Sync category only when sync settings are provided', async () => {
  await render()
  expect(categories()).not.toContain('Sync')
  await type(control('Search settings')!, 'keychain')
  expect(document.querySelector('.settings-empty')).not.toBeNull()
  await act(() => root.unmount())
  root = createRoot(host)

  await render({ syncSettings: <p>Sync form</p>, initialCategory: 'sync' })
  expect(categories()).toEqual(['Appearance', 'Typography', 'Editor', 'Shortcuts', 'Sync'])
  expect(title()).toBe('Sync')
  expect(document.querySelector('[aria-current="page"]')?.textContent).toBe('Sync')
  expect(document.body.textContent).toContain('Sync form')
  expect(document.body.textContent).toContain('Not connected')
  expect(document.body.textContent).toContain('Add a server below to sync this library.')
  expect(button('Sync now')!.disabled).toBe(true)

  await setLibraryState({
    syncStatus: {
      url: 'https://sync.test',
      configured: true,
      lastSuccess: null,
      pending: 0,
      warnings: [],
    },
  })
  try {
    expect(document.body.textContent).toContain('Connected')
    expect(document.body.textContent).toContain('Not synced yet')
    expect(button('Sync now')!.disabled).toBe(false)
    await act(() => button('Sync now')!.click())
    expect(onSync).toHaveBeenCalledOnce()
    await category('Appearance')
    expect(title()).toBe('Appearance')
    expect(document.body.textContent).not.toContain('Sync form')
  } finally {
    await setLibraryState({ syncStatus: undefined })
  }
})
