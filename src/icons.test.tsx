// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Plus } from './icons'
import { platform } from './platform'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke, isTauri: () => true }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
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

it.each(['macos', 'browser', 'android'] as const)(
  'uses Lucide on %s and forwards size, refs, color and accessible props',
  async (name) => {
    platform.platform = name
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    const ref = createRef<SVGSVGElement>()
    await act(async () =>
      root!.render(
        <Plus
          ref={ref}
          size={16}
          className="test-icon"
          style={{ color: 'red' }}
          aria-label="Add"
          strokeWidth={1.5}
        />,
      ),
    )
    const svg = host.querySelector('svg')!
    expect(ref.current).toBe(svg)
    expect(svg.getAttribute('width')).toBe('16')
    expect(svg.getAttribute('aria-label')).toBe('Add')
    expect(svg.getAttribute('stroke')).toBe('currentColor')
    expect(svg.getAttribute('stroke-width')).toBe('1.5')
    expect(svg.style.color).toBe('red')
    expect(svg.classList.contains('ui-icon')).toBe(true)
    expect(svg.classList.contains('test-icon')).toBe(true)
    expect(svg.querySelector('path')).not.toBeNull()
    expect(svg.querySelector('mask, image')).toBeNull()
    expect(invoke).not.toHaveBeenCalled()
    await act(async () => root!.render(<Plus size={32} aria-hidden="true" />))
    expect(host.querySelector('svg')!.classList.contains('ui-icon')).toBe(false)
    expect(host.querySelector('svg')!.getAttribute('width')).toBe('32')
    expect(host.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true')
  },
)
