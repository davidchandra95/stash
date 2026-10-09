// @vitest-environment jsdom
import { act, type ComponentProps } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import ContentSearch from './ContentSearch'
import { defaultAppearance } from '../storage/library'
import type { Note } from '../model'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const containers: { host: HTMLElement; root: ReturnType<typeof createRoot> }[] = []
afterEach(async () => {
  for (const { host, root } of containers.splice(0)) {
    await act(() => root.unmount())
    host.remove()
  }
  vi.useRealTimers()
})
const note = (id: string, text: string, updated = 1): Note => ({
  id,
  title: id,
  text,
  updated,
  tags: [],
  notebookIds: [],
  pinned: false,
  trashed: false,
  quickAccess: false,
  content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
})
async function mount(notes: Note[], readNote: ComponentProps<typeof ContentSearch>['readNote']) {
  const host = document.createElement('div'),
    root = createRoot(host)
  document.body.append(host)
  containers.push({ host, root })
  const onSelectMatch = vi.fn(),
    onOpenChange = vi.fn()
  await act(() =>
    root.render(
      <ContentSearch
        open
        notes={notes}
        notebooks={[]}
        appearance={{ ...defaultAppearance, animationsEnabled: false }}
        disabled={false}
        readNote={readNote}
        onSelectMatch={onSelectMatch}
        onOpenChange={onOpenChange}
        onQuickOpen={vi.fn()}
        initialQuery="fix"
      />,
    ),
  )
  return { onSelectMatch, onOpenChange }
}
const flush = async () => {
  // Preparation commits before the matching effect schedules its own work.
  for (let i = 0; i < 3; i++)
    await act(async () => {
      await vi.runAllTimersAsync()
    })
}
const field = () =>
  document.querySelector<HTMLInputElement>('input[aria-label="Search note bodies"]')!
async function press(key: string, extra: KeyboardEventInit = {}) {
  await act(() =>
    field().dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }),
    ),
  )
}
async function type(value: string) {
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field(), value)
    field().dispatchEvent(new Event('input', { bubbles: true }))
  })
}

it('shows partial counts and keeps the selected occurrence when a newer note arrives', async () => {
  vi.useFakeTimers()
  const old = note('old', 'fix fix', 1),
    newer = note('new', 'fix newer', 9),
    slow = note('slow', 'unread', 3)
  const pending = new Map<string, (note: Note) => void>()
  const { onSelectMatch } = await mount(
    [old, newer, slow],
    (id) => new Promise((resolve) => pending.set(id, resolve)),
  )
  await act(() => pending.get('old')!(old))
  await flush()
  expect(document.querySelector('.content-search-status')?.textContent).toContain(
    '2 matches in 1 note',
  )
  expect(document.querySelector('.global-search-results')?.getAttribute('aria-busy')).toBe('true')
  expect(document.querySelector('.global-search-empty')).toBeNull()
  await press('ArrowDown')
  const selectedBefore = field().getAttribute('aria-activedescendant')!
  await act(() => pending.get('new')!(newer))
  await flush()
  expect(field().getAttribute('aria-activedescendant')).toBe(selectedBefore)
  expect(document.getElementById(selectedBefore)?.getAttribute('aria-selected')).toBe('true')
  await press('Enter', { ctrlKey: true })
  expect(onSelectMatch).toHaveBeenCalledWith(
    expect.objectContaining({
      noteId: 'old',
      query: 'fix',
      match: expect.objectContaining({ offset: 4 }),
    }),
    true,
  )
})

it('keeps dense results bounded and supports wrap navigation to the last unmounted occurrence', async () => {
  vi.useFakeTimers()
  const dense = note('dense', 'fix '.repeat(20000))
  await mount([dense], async () => dense)
  await flush()
  expect(document.querySelector('.content-search-status')?.textContent).toContain(
    '20000 matches in 1 note',
  )
  expect(document.querySelectorAll('.content-search-match').length).toBeLessThan(40)
  await press('ArrowUp')
  const selected = document.getElementById(field().getAttribute('aria-activedescendant')!)!
  expect(selected.getAttribute('aria-posinset')).toBe('20000')
  expect(selected.getAttribute('aria-setsize')).toBe('20000')
  expect(document.querySelectorAll('.content-search-match').length).toBeLessThan(40)
  await press('ArrowDown')
  expect(
    document
      .getElementById(field().getAttribute('aria-activedescendant')!)
      ?.getAttribute('aria-posinset'),
  ).toBe('1')
  await type('absent')
  await type('fix')
  await flush()
  expect(document.querySelector('.content-search-status')?.textContent).toContain('20000 matches')
  await type('absent')
  await flush()
  expect(document.querySelector('.global-search-empty')?.textContent).toBe('No matches found.')
})

it('retains IME handling and reports read failures while searchable notes remain', async () => {
  vi.useFakeTimers()
  const a = note('a', 'fix'),
    b = note('b', 'bad')
  const { onSelectMatch } = await mount([a, b], async (id) => {
    if (id === 'b') throw Error('Synthetic unreadable')
    return a
  })
  await flush()
  expect(document.querySelector('.content-search-errors')?.textContent).toContain(
    'Synthetic unreadable',
  )
  expect(document.querySelectorAll('.content-search-match')).toHaveLength(1)
  await press('Enter', { isComposing: true })
  expect(onSelectMatch).not.toHaveBeenCalled()
  await press('Enter')
  expect(onSelectMatch).toHaveBeenCalledWith(expect.objectContaining({ noteId: 'a' }), false)
})
