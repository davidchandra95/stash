// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { useWorkspace } from './useWorkspace'

it('saves reordering without reactivating the document or changing its history', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const notes = [{ id: 'a' }, { id: 'b' }] as never
  const saved = {
    activeTabId: 'one',
    tabs: [
      { id: 'one', noteId: 'a', view: 'all' as const, query: '', scroll: 80 },
      { id: 'two', noteId: 'b', view: 'all' as const, query: '', scroll: 30, preview: true },
    ],
  }
  const save = vi.fn(),
    onActivate = vi.fn()
  let workspace: ReturnType<typeof useWorkspace>
  function Harness() {
    workspace = useWorkspace({
      notes,
      ready: true,
      saved,
      save,
      view: 'all',
      query: '',
      onActivate,
      disabled: false,
    })
    return null
  }
  const host = document.createElement('div'),
    root = createRoot(host)
  try {
    await act(() => root.render(<Harness />))
    save.mockClear()
    onActivate.mockClear()
    const history = workspace!.tabs[1].entries
    await act(() => workspace!.reorderTab('two', 0))
    expect(workspace!.tabs.map((t) => t.id)).toEqual(['two', 'one'])
    expect(workspace!.tabs[0].entries).toBe(history)
    expect(workspace!.activeTabId).toBe('one')
    expect(workspace!.activation).toBe(0)
    expect(onActivate).not.toHaveBeenCalled()
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0][0].tabs.map((t: { id: string }) => t.id)).toEqual(['two', 'one'])
    await act(() => workspace!.setPinned('one', true))
    expect(onActivate).not.toHaveBeenCalled()
    expect(workspace!.activeTabId).toBe('one')
    save.mockClear()
    await act(() => workspace!.closeActive())
    expect(workspace!.tabs).toHaveLength(2)
    expect(save).not.toHaveBeenCalled()
    await act(() => workspace!.close('one'))
    expect(workspace!.tabs.map(t => t.id)).toEqual(['two'])
  } finally {
    await act(() => root.unmount())
  }
})
