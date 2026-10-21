// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import App from './App'
import { library } from './storage/useLibrary'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
Element.prototype.scrollIntoView = vi.fn()
Range.prototype.getClientRects = () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () =>
  ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }) as DOMRect

let host: HTMLDivElement | undefined
let root: ReturnType<typeof createRoot> | undefined

async function mount(configured: boolean, syncError = '') {
  vi.spyOn(library, 'getSnapshot').mockReturnValue({
    ...library.getSnapshot(),
    preview: false,
    syncStatus: {
      url: 'https://example.test',
      configured,
      lastSuccess: null,
      pending: 0,
      warnings: [],
    },
    syncError,
  })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(<App />))
}

const footer = () => host!.querySelector<HTMLElement>('.sidebar-footer')!
const syncButton = () => footer().querySelector<HTMLButtonElement>('button.sync-status')!
const footerButton = (label: string) =>
  footer().querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!
const settingsTitle = () => document.querySelector('[role="dialog"] .settings-title')?.textContent

async function clickSync() {
  await act(async () => syncButton().click())
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  host?.remove()
  host = undefined
  root = undefined
  vi.restoreAllMocks()
})

it('opens Sync settings from the footer sync status when no connection exists', async () => {
  await mount(false)
  const sync = vi.spyOn(library, 'sync').mockResolvedValue()
  expect(syncButton().textContent).toBe('Sync is off')
  expect(syncButton().disabled).toBe(false)
  await clickSync()
  const dialog = document.querySelector('[role="dialog"]')!
  expect(dialog).not.toBeNull()
  expect(settingsTitle()).toBe('Sync')
  expect(dialog.querySelector('#sync-server-url')).not.toBeNull()
  expect(sync).not.toHaveBeenCalled()
})

it('shows a sync failure in the workspace notice and retries from there and the footer', async () => {
  await mount(true, 'Network unavailable')
  const sync = vi.spyOn(library, 'sync').mockResolvedValue()
  expect(syncButton().textContent).toBe('Couldn’t sync')
  const alert = host!.querySelector<HTMLElement>('.notices .notice[role="alert"]')!
  expect(alert.textContent).toContain('Couldn’t sync')
  expect(alert.textContent).toContain('Network unavailable')
  const retry = [...alert.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent === 'Retry sync',
  )!
  await act(async () => retry.click())
  expect(sync).toHaveBeenCalledTimes(1)
  await clickSync()
  expect(sync).toHaveBeenCalledTimes(2)
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})

it('opens Trash from the footer and Settings on Appearance', async () => {
  await mount(true)
  await act(async () =>
    host!
      .querySelector('button[aria-label="Sort and view options"]')!
      .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })),
  )
  await act(async () =>
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .find((item) => item.textContent === 'Hide notes list')!
      .click(),
  )
  expect(host!.querySelector('#note-list')?.hasAttribute('inert')).toBe(true)
  const trash = footerButton('Trash')
  expect(trash.getAttribute('aria-pressed')).toBe('false')
  await act(async () => trash.click())
  expect(footerButton('Trash').getAttribute('aria-pressed')).toBe('true')
  expect(host!.querySelector('.list-title')?.textContent).toContain('Trash')
  expect(host!.querySelector('#note-list')?.hasAttribute('inert')).toBe(false)

  await act(async () => footerButton('Settings').click())
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  expect(settingsTitle()).toBe('Appearance')
})
