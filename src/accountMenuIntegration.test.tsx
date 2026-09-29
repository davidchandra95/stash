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

async function clickSync() {
  await act(async () =>
    host!
      .querySelector<HTMLButtonElement>('.account-trigger')!
      .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })),
  )
  await act(async () =>
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .find((item) => item.textContent === 'Sync')!
      .click(),
  )
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  host?.remove()
  host = undefined
  root = undefined
  vi.restoreAllMocks()
})

it('opens Sync settings from the account menu when no connection exists', async () => {
  await mount(false)
  await clickSync()
  const dialog = document.querySelector('[role="dialog"]')!
  expect(dialog).not.toBeNull()
  expect(dialog.querySelector('#sync-server-url')).not.toBeNull()
})

it('shows a sync failure in the workspace alert and retries from there', async () => {
  await mount(true, 'Network unavailable')
  const sync = vi.spyOn(library, 'sync').mockResolvedValue()
  const alert = host!.querySelector<HTMLElement>('.save-error[role="alert"]')!
  expect(alert.textContent).toContain('Couldn’t sync')
  expect(alert.textContent).toContain('Network unavailable')
  const retry = [...alert.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent === 'Retry sync',
  )!
  await act(async () => retry.click())
  expect(sync).toHaveBeenCalledTimes(1)
  await clickSync()
  expect(sync).toHaveBeenCalledTimes(2)
})
