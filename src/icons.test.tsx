// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Plus, initializeSymbols, sfSymbolFor } from './icons'
import { platform } from './platform'

const invoke = vi.hoisted(() => vi.fn(async () => ({ plus: 'data:image/png;base64,dGVzdA==' })))
vi.mock('@tauri-apps/api/core', () => ({ invoke, isTauri: () => true }))

let root: Root | undefined
let host: HTMLDivElement | undefined
afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  host?.remove()
  root = undefined
  host = undefined
  platform.platform = 'browser'
  invoke.mockClear()
})

async function showIcon() {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(<Plus size={16} aria-hidden="true" />))
  return host.querySelector('svg')!
}

it('uses the native SF Symbol image on macOS while keeping the SVG size and tint', async () => {
  platform.platform = 'macos'
  await initializeSymbols()
  const svg = await showIcon()
  expect(sfSymbolFor(Plus)).toBe('plus')
  expect(invoke).toHaveBeenCalledWith('render_symbols', {
    names: expect.arrayContaining(['plus', 'folder', 'trash']),
  })
  expect(svg.getAttribute('width')).toBe('16')
  expect(svg.getAttribute('aria-hidden')).toBe('true')
  const mask = svg.querySelector('mask')!
  expect(mask.getAttribute('mask-type')).toBe('alpha')
  expect(mask.querySelector('image')?.getAttribute('href')).toContain('data:image/png;base64,')
  expect(svg.querySelector('rect')?.getAttribute('mask')).toBe(`url(#${mask.id})`)
})

it('keeps the Lucide SVG in the browser', async () => {
  const svg = await showIcon()
  expect(svg.querySelector('path')).not.toBeNull()
  expect(svg.querySelector('rect')).toBeNull()
  expect(invoke).not.toHaveBeenCalled()
})
