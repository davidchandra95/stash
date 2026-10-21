// @vitest-environment jsdom
import * as tauriCore from '@tauri-apps/api/core'
import { act, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import MobileSettings from './MobileSettings'
import type { SettingsCategory } from './navigation'
import type { Appearance } from '../model'
import { useMotionPreference } from '../motion'
import { defaultAppearance } from '../storage/library'
import { library } from '../storage/useLibrary'

vi.mock('@tauri-apps/api/core', async (importOriginal) => ({
  ...(await importOriginal<typeof tauriCore>()),
  isTauri: vi.fn(() => false),
  invoke: vi.fn(async () => undefined),
}))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let current: Appearance
let onCategory: ReturnType<typeof vi.fn<(category: SettingsCategory) => void>>
let onSync: ReturnType<typeof vi.fn<() => void>>
let media: {
  matches: boolean
  addEventListener: (event: string, cb: () => void) => void
  removeEventListener: () => void
}
let notifyMedia: () => void

function Harness({
  initial = defaultAppearance,
  category,
  syncSettings,
}: {
  initial?: Appearance
  category?: SettingsCategory
  syncSettings?: ReactNode
}) {
  const [value, setValue] = useState(initial)
  current = value
  useMotionPreference(value.animationsEnabled)
  return (
    <MobileSettings
      value={value}
      onChange={setValue}
      syncSettings={syncSettings}
      onSync={onSync}
      category={category}
      onCategory={onCategory}
    />
  )
}
const render = (props: Parameters<typeof Harness>[0] = {}) =>
  act(() => root.render(<Harness {...props} />))

beforeEach(() => {
  media = {
    matches: false,
    addEventListener: (_event, callback) => {
      notifyMedia = callback
    },
    removeEventListener: () => {},
  }
  vi.stubGlobal('matchMedia', () => media)
  onCategory = vi.fn<(category: SettingsCategory) => void>()
  onSync = vi.fn<() => void>()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
  vi.mocked(tauriCore.isTauri).mockReturnValue(false)
  vi.mocked(tauriCore.invoke).mockReset()
})

const control = <T extends HTMLElement = HTMLInputElement>(label: string) =>
  host.querySelector<T>(`[aria-label="${label}"]`)
const categoryButtons = () => [
  ...host.querySelectorAll<HTMLButtonElement>('nav[aria-label="Settings categories"] button'),
]
async function setValue(
  element: HTMLInputElement | HTMLSelectElement,
  value: string,
  event: string,
) {
  await act(() => {
    const proto =
      element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(element, value)
    element.dispatchEvent(new Event(event, { bubbles: true }))
  })
}

it('lists the desktop categories that apply on mobile and opens one through navigation', async () => {
  await render()
  expect(categoryButtons().map((button) => button.textContent)).toEqual([
    'Appearance',
    'Typography',
    'Editor',
  ])
  await act(() => categoryButtons()[2].click())
  expect(onCategory).toHaveBeenCalledWith('editor')
  await act(() => root.unmount())
  root = createRoot(host)
  await render({ syncSettings: <p>Sync form</p> })
  expect(categoryButtons().map((button) => button.textContent)).toContain('Sync')
})

it('changes color mode and accent like desktop without touching other preferences', async () => {
  await render({ category: 'appearance' })
  const modes = [
    ...host.querySelectorAll<HTMLButtonElement>(
      '[role="radiogroup"][aria-label="Appearance"] button',
    ),
  ]
  expect(modes.map((mode) => [mode.textContent, mode.getAttribute('aria-checked')])).toEqual([
    ['Light', 'false'],
    ['Dark', 'false'],
    ['Auto', 'true'],
  ])
  await act(() => modes[1].click())
  expect(current).toEqual({ ...defaultAppearance, colorMode: 'dark' })
  // Android has no system accent, so the automatic choice shows as Blue.
  expect(control('Multicolor (follow macOS)')).toBeNull()
  expect(control('Blue')!.getAttribute('aria-checked')).toBe('true')
  await act(() => control('Orange')!.click())
  expect(current).toEqual({ ...defaultAppearance, colorMode: 'dark', accent: 'orange' })
  expect(control('Blue')!.getAttribute('aria-checked')).toBe('false')
  expect(control('Translucent sidebar')).toBeNull()
})

it('keeps the animations switch and explains a Reduce Motion override', async () => {
  await render({ category: 'appearance' })
  const toggle = control<HTMLButtonElement>('Animations')!
  expect(toggle.getAttribute('role')).toBe('switch')
  expect(toggle.getAttribute('aria-checked')).toBe('true')
  expect(host.textContent).not.toContain('Off while this device reduces motion')
  await act(() => {
    media.matches = true
    notifyMedia()
  })
  expect(host.textContent).toContain('Off while this device reduces motion')
  await act(() => toggle.click())
  expect(current).toEqual({ ...defaultAppearance, animationsEnabled: false })
})

it('switches the saved note list view and the navigation counts', async () => {
  await act(async () => library.setNoteListMode('compact'))
  await render({ category: 'appearance' })
  await setValue(control<HTMLSelectElement>('Note list')!, 'preview', 'change')
  expect(library.getSnapshot().workspace?.noteListMode).toBe('preview')
  await act(() => control('Show note counts in navigation')!.click())
  expect(current).toEqual({ ...defaultAppearance, sidebarCounts: false })
})

it('updates list item spacing on mobile without changing other writing preferences', async () => {
  const initial = { ...defaultAppearance, lineSpacing: 1.8, paragraphSpacing: 12 }
  await render({ initial, category: 'editor' })
  // Desktop-only editor controls are hidden on mobile.
  for (const label of [
    'Writing width',
    'Always show formatting toolbar',
    'Cursor style',
    'Cursor blinking',
    'Smooth caret animation',
    'Extra space below the note',
  ])
    expect(control(label)).toBeNull()
  expect(control('Space at the bottom of the editor')).not.toBeNull()
  const spacing = control('List item spacing')!
  expect(spacing.value).toBe('0')
  expect(spacing.min).toBe('-8')
  await setValue(spacing, '-4', 'change')
  expect(current).toEqual({ ...initial, listItemSpacing: -4 })
  expect(spacing.getAttribute('aria-valuetext')).toBe('-4 px')
  expect(host.textContent).toContain('-4 px')
})

it('uses system font families and keeps a font chosen elsewhere selectable', async () => {
  await render({ category: 'typography' })
  const noteFont = control<HTMLSelectElement>('Note font')!
  expect(noteFont.tagName).toBe('SELECT')
  expect([...noteFont.options].map((option) => option.value)).toEqual([
    'system',
    'georgia',
    'menlo',
  ])
  await setValue(noteFont, 'georgia', 'change')
  expect(current).toEqual({ ...defaultAppearance, noteFont: 'georgia' })
  // The default code font is a desktop preset; it stays selected instead of showing System sans.
  const codeFont = control<HTMLSelectElement>('Code font')!
  expect(codeFont.value).toBe('sf-mono')
  expect(codeFont.selectedOptions[0].textContent).toBe('SF Mono')
  expect(vi.mocked(tauriCore.invoke)).not.toHaveBeenCalled()
})

it('loads installed fonts in the native app and reports a failure', async () => {
  vi.mocked(tauriCore.isTauri).mockReturnValue(true)
  vi.mocked(tauriCore.invoke).mockResolvedValueOnce(['Inter', 'Atkinson', 'Inter'])
  await render({ category: 'typography' })
  expect(vi.mocked(tauriCore.invoke)).toHaveBeenCalledWith('installed_fonts')
  const installed = control<HTMLSelectElement>('Note font')!.querySelector('optgroup')!
  expect(installed.label).toBe('Installed')
  expect([...installed.querySelectorAll('option')].map((option) => option.value)).toEqual([
    'font:Atkinson',
    'font:Inter',
  ])
  await act(() => root.unmount())
  root = createRoot(host)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.mocked(tauriCore.invoke).mockRejectedValueOnce(Error('denied'))
  await render({ category: 'typography' })
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(
    'Couldn’t load this device’s fonts. Reopen Settings to try again.',
  )
})

it('searches by setting name and shows the matching controls inline', async () => {
  await render()
  await setValue(control('Search settings')!, 'list item', 'input')
  expect(categoryButtons()).toHaveLength(0)
  expect([...host.querySelectorAll('.settings-section-title')].map((h) => h.textContent)).toEqual([
    'Editor',
  ])
  expect(host.textContent).not.toContain('list-spacing')
  const spacing = control('List item spacing')!
  await setValue(spacing, '6', 'change')
  expect(current).toEqual({ ...defaultAppearance, listItemSpacing: 6 })
  await setValue(control('Search settings')!, 'accent', 'input')
  expect(host.textContent).not.toContain('color-mode')
  expect(control('Accent color')).not.toBeNull()
  await act(() => control<HTMLButtonElement>('Clear settings search')!.click())
  expect(categoryButtons()).toHaveLength(3)
  await setValue(control('Search settings')!, 'nothing-matches', 'input')
  expect(host.querySelector('[role="status"]')?.textContent).toBe(
    'No results for “nothing-matches”',
  )
})

it('shows sync status with Sync now beside the connection form', async () => {
  await render({ category: 'sync', syncSettings: <p>Sync form</p> })
  expect(host.textContent).toContain('Not connected')
  expect(host.textContent).toContain('Sync form')
  const syncNow = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Sync now')!
  expect(syncNow.disabled).toBe(true)
  expect(onSync).not.toHaveBeenCalled()
})
