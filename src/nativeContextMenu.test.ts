// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest'
import { Files, FolderInput, Trash2 } from './icons'
const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke, isTauri: () => true }))
import { showNativeContextMenu } from './nativeContextMenu'
beforeEach(() => {
  invoke.mockReset()
  document.body.innerHTML = '<button>Note</button>'
})
it('uses outline symbols and preserves shortcuts, separators and the action launcher', async () => {
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
        symbol: 'doc.on.doc',
        shortcut: 'Mod+Shift+d',
        disabled: false,
        separator: false,
      },
      { label: 'Move', symbol: 'folder', shortcut: null, disabled: false, separator: false },
      { label: 'Delete', symbol: 'trash', shortcut: null, disabled: true, separator: true },
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
