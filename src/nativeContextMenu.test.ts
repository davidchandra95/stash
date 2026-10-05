// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest'
import { Files, FolderInput, Trash2 } from './icons'
const invoke = vi.hoisted(() => vi.fn())
const nativeMenuIcon = vi.hoisted(() => vi.fn())
vi.mock('./nativeMenuIcon', () => ({ nativeMenuIcon }))
vi.mock('@tauri-apps/api/core', () => ({ invoke, isTauri: () => true }))
import { cancelNativeContextMenu, showNativeContextMenu } from './nativeContextMenu'
beforeEach(() => {
  invoke.mockReset()
  nativeMenuIcon.mockReset().mockResolvedValue('png-base64')
  document.body.innerHTML = '<button>Note</button>'
})
it('uses Lucide PNGs and preserves shortcuts, separators and the action launcher', async () => {
  invoke.mockResolvedValue(0)
  const launcher = document.querySelector('button')!
  const run = vi.fn()
  await showNativeContextMenu(
    [
      { label: 'Duplicate', icon: Files, shortcutId: 'duplicate', run },
      { label: 'Move', icon: FolderInput, run },
      { label: 'Delete', icon: Trash2, disabled: true, separator: true, run },
    ],
    launcher,
    { x: 10, y: 20 },
    () => 'Mod+Shift+d',
  )
  expect(invoke).toHaveBeenCalledWith('show_outline_menu', {
    actions: [
      {
        label: 'Duplicate',
        iconPng: 'png-base64',
        shortcut: 'Mod+Shift+d',
        disabled: false,
        separator: false,
      },
      { label: 'Move', iconPng: 'png-base64', shortcut: null, disabled: false, separator: false },
      { label: 'Delete', iconPng: 'png-base64', shortcut: null, disabled: true, separator: true },
    ],
    x: 10,
    y: 20,
  })
  expect(run).toHaveBeenCalledExactlyOnceWith(launcher)
})
it.each([null, 0, 99])(
  'does not dispatch dismissed, disabled or unknown choices (%s)',
  async (selected) => {
    invoke.mockResolvedValue(selected)
    const run = vi.fn()
    await showNativeContextMenu(
      [{ label: 'Delete', icon: Trash2, disabled: true, run }],
      document.querySelector('button')!,
      { x: 0, y: 0 },
    )
    expect(run).not.toHaveBeenCalled()
  },
)
it('propagates native failures without running an action', async () => {
  invoke.mockRejectedValue(new Error('popup failed'))
  const run = vi.fn()
  await expect(
    showNativeContextMenu(
      [{ label: 'Duplicate', icon: Files, run }],
      document.querySelector('button')!,
      { x: 0, y: 0 },
    ),
  ).rejects.toThrow('popup failed')
  expect(run).not.toHaveBeenCalled()
})
it('passes checked colors, toolbar placement and cancellation tokens to AppKit', async () => {
  invoke.mockResolvedValue(null)
  await showNativeContextMenu(
    [{ label: 'Blue', icon: Files, checked: true, color: '#216f9c', run: vi.fn() }],
    document.querySelector('button')!,
    { x: 20, y: 500 },
    undefined,
    { above: true, trackingId: 'writing-menu' },
  )
  expect(invoke).toHaveBeenCalledWith(
    'show_outline_menu',
    expect.objectContaining({
      actions: [expect.objectContaining({ checked: true, color: '#216f9c' })],
      above: true,
      trackingId: 'writing-menu',
      x: 20,
      y: 500,
    }),
  )
  await cancelNativeContextMenu('writing-menu')
  expect(invoke).toHaveBeenLastCalledWith('cancel_outline_menu', { trackingId: 'writing-menu' })
})

it('opens without an icon and reports conversion failures', async () => {
  nativeMenuIcon.mockRejectedValue(new Error('canvas unavailable'))
  const report = vi.spyOn(console, 'error').mockImplementation(() => {})
  invoke.mockResolvedValue(null)
  try {
    await showNativeContextMenu(
      [{ label: 'Move', icon: FolderInput, run: vi.fn() }],
      document.querySelector('button')!,
      { x: 0, y: 0 },
    )
    expect(invoke).toHaveBeenCalledWith(
      'show_outline_menu',
      expect.objectContaining({
        actions: [expect.objectContaining({ iconPng: null })],
      }),
    )
    expect(report).toHaveBeenCalledWith(expect.stringContaining('Move'), expect.any(Error))
  } finally {
    report.mockRestore()
  }
})
it('does not open a menu cancelled during icon preparation', async () => {
  let complete!: (png: string) => void
  nativeMenuIcon.mockReturnValue(
    new Promise<string>((resolve) => {
      complete = resolve
    }),
  )
  const pending = showNativeContextMenu(
    [{ label: 'Move', icon: FolderInput, run: vi.fn() }],
    document.querySelector('button')!,
    { x: 0, y: 0 },
    undefined,
    { trackingId: 'pending-menu' },
  )
  await cancelNativeContextMenu('pending-menu')
  complete('png-base64')
  await pending
  expect(invoke.mock.calls.map(([command]) => command)).toEqual(['cancel_outline_menu'])
})
it('does not dispatch a choice received after cancellation', async () => {
  let complete!: (selected: number) => void
  invoke.mockImplementation((command) =>
    command === 'show_outline_menu'
      ? new Promise<number>((resolve) => {
          complete = resolve
        })
      : Promise.resolve(),
  )
  const run = vi.fn()
  const pending = showNativeContextMenu(
    [{ label: 'Move', icon: FolderInput, run }],
    document.querySelector('button')!,
    { x: 0, y: 0 },
    undefined,
    { trackingId: 'tracking-menu' },
  )
  await vi.waitFor(() => expect(complete).toBeDefined())
  await cancelNativeContextMenu('tracking-menu')
  complete(0)
  await pending
  expect(run).not.toHaveBeenCalled()
})
it('skips rasterization for color swatches', async () => {
  invoke.mockResolvedValue(null)
  await showNativeContextMenu(
    [{ label: 'Blue', icon: Files, color: '#216f9c', run: vi.fn() }],
    document.querySelector('button')!,
    { x: 0, y: 0 },
  )
  expect(nativeMenuIcon).not.toHaveBeenCalled()
  expect(invoke).toHaveBeenCalledWith(
    'show_outline_menu',
    expect.objectContaining({
      actions: [expect.objectContaining({ iconPng: null, color: '#216f9c' })],
    }),
  )
})
it('does not open after its launcher is removed during preparation', async () => {
  let complete!: (png: string) => void
  nativeMenuIcon.mockReturnValue(
    new Promise<string>((resolve) => {
      complete = resolve
    }),
  )
  const launcher = document.querySelector('button')!
  const pending = showNativeContextMenu(
    [{ label: 'Move', icon: FolderInput, run: vi.fn() }],
    launcher,
    { x: 0, y: 0 },
  )
  launcher.remove()
  complete('png-base64')
  await pending
  expect(invoke).not.toHaveBeenCalled()
})
