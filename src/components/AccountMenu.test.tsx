// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import AccountMenu from './AccountMenu'
import { defaultAppearance, type LibraryState } from '../storage/library'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
Element.prototype.scrollIntoView = vi.fn()

let host: HTMLDivElement | undefined
let root: ReturnType<typeof createRoot> | undefined

const handlers = {
  onSync: vi.fn(),
  onTrash: vi.fn(),
  onSettings: vi.fn(),
}

function makeState(): LibraryState {
  return {
    syncing: false,
    converting: false,
    conversionProgress: '',
    syncGeneration: 0,
    syncStatus: { url: '', configured: true, lastSuccess: null, pending: 0, warnings: [] },
    syncError: '',
    syncProgress: '',
    notes: [],
    notebooks: [],
    appearance: defaultAppearance,
    workspace: null,
    ready: true,
    startupError: '',
    noteErrors: {},
    loaded: new Set(),
    status: 'saved',
    error: '',
    path: '',
    quitting: false,
    quitFailed: false,
    preview: false,
    roots: [],
    conflicts: {},
  }
}

async function mount(state = makeState()) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () =>
    root!.render(
      <AccountMenu
        state={state}
        trashCount={9}
        trashSelected={false}
        dark={true}
        palette="default"
        settingsTitle="Settings (⌘,)"
        {...handlers}
      />,
    ),
  )
}

async function open() {
  const trigger = host!.querySelector<HTMLButtonElement>('.account-trigger')!
  await act(async () =>
    trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })),
  )
  return trigger
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  host?.remove()
  host = undefined
  root = undefined
  vi.clearAllMocks()
})

it('uses one avatar and name button and opens the compact action menu', async () => {
  await mount()
  const trigger = host!.querySelector<HTMLButtonElement>('.account-trigger')!
  expect(trigger.textContent).toBe('David')
  expect(host!.querySelectorAll('button')).toHaveLength(1)

  await open()
  const menu = document.querySelector('[role="menu"][aria-label="Account menu"]')!
  expect(menu).not.toBeNull()
  expect(menu.getAttribute('data-side')).toBe('top')
  expect([...menu.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent)).toEqual([
    'Sync',
    'Trash9',
    'Settings',
  ])
})

it('runs each action and closes the menu', async () => {
  await mount()
  for (const [label, handler] of [
    ['Sync', handlers.onSync],
    ['Trash', handlers.onTrash],
    ['Settings', handlers.onSettings],
  ] as const) {
    await open()
    await act(async () =>
      [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
        .find((item) => item.textContent?.startsWith(label))!
        .click(),
    )
    expect(handler).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[role="menu"]')).toBeNull()
  }
})

it('opens by keyboard and closes with Escape or an outside pointer', async () => {
  await mount()
  const trigger = host!.querySelector<HTMLButtonElement>('.account-trigger')!
  trigger.focus()
  await act(async () =>
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })),
  )
  expect(document.querySelector('[role="menu"]')).not.toBeNull()
  await act(async () =>
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    ),
  )
  expect(document.querySelector('[role="menu"]')).toBeNull()
  expect(document.activeElement).toBe(trigger)

  await open()
  await act(async () =>
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })),
  )
  expect(document.querySelector('[role="menu"]')).toBeNull()
})

it('hides Sync in browser preview and disables the trigger during sync', async () => {
  await mount({ ...makeState(), preview: true })
  await open()
  expect(
    [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent),
  ).toEqual(['Trash9', 'Settings'])
  await act(async () =>
    root!.render(
      <AccountMenu
        state={{ ...makeState(), syncing: true }}
        trashCount={9}
        trashSelected={false}
        dark={true}
        palette="default"
        settingsTitle="Settings"
        {...handlers}
      />,
    ),
  )
  expect(host!.querySelector<HTMLButtonElement>('.account-trigger')!.disabled).toBe(true)
})
