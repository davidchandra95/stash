// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'
import { defaultAppearance, type LibraryState } from '../storage/library'
import SyncConnection from './SyncConnection'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let host: HTMLDivElement | undefined
let root: ReturnType<typeof createRoot> | undefined

function state(url = '', configured = false): LibraryState {
  return {
    syncing: false,
    converting: false,
    conversionProgress: '',
    syncGeneration: 0,
    syncStatus: { url, configured, lastSuccess: null, pending: 0, warnings: [] },
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

async function mount(value: LibraryState) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(<SyncConnection state={value} />))
  return host.querySelector<HTMLInputElement>('#sync-server-url')!
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  host?.remove()
  host = undefined
  root = undefined
})

it('starts a new self-hosted connection with an empty URL', async () => {
  const input = await mount(state())
  expect(input.value).toBe('')
  expect(input.placeholder).toBe('https://stash.example.com')
})

it('keeps an existing saved server URL', async () => {
  const input = await mount(state('https://notes.example.net', true))
  expect(input.value).toBe('https://notes.example.net')
})
