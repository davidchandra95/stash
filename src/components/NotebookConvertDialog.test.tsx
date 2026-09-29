// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import NotebookConvertDialog from './NotebookConvertDialog'
import { defaultAppearance } from '../storage/library'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})
async function mount(onConfirm: () => Promise<void>, onClose = vi.fn()) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () =>
    root.render(
      <NotebookConvertDialog
        notebook={{ id: 'root', name: 'Imported', color: 'green', icon: 'folder' }}
        appearance={defaultAppearance}
        progress="Reading files…"
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    ),
  )
  return onClose
}
function button(label: string) {
  return [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent === label,
  )!
}
it('explains conversion, blocks dismissal while busy, and closes after success', async () => {
  let release!: () => void
  const work = new Promise<void>((resolve) => {
    release = resolve
  })
  const confirm = vi.fn(() => work)
  const close = await mount(confirm)
  expect(document.body.textContent).toContain('all its sub-notebooks')
  expect(document.body.textContent).toContain('external links')
  expect(document.body.textContent).toContain('files will stay untouched')
  await act(async () => button('Convert notebook').click())
  expect(button('Cancel')).toBeUndefined()
  expect(document.querySelector('[role="dialog"]')?.getAttribute('data-busy')).toBe('true')
  expect(document.querySelector('.notebook-convert-overlay')?.getAttribute('data-busy')).toBe(
    'true',
  )
  expect(document.body.textContent).toContain('Converting notebook…')
  expect(document.querySelector('[role="status"]')?.textContent).toBe('Reading files…')
  await act(async () =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
  )
  expect(close).not.toHaveBeenCalled()
  await act(async () => {
    release()
    await work
  })
  expect(close).toHaveBeenCalledOnce()
})
it('keeps failures visible and allows retry', async () => {
  const confirm = vi
    .fn()
    .mockRejectedValueOnce(Error('pic.png is missing'))
    .mockResolvedValueOnce(undefined)
  const close = await mount(confirm)
  await act(async () => button('Convert notebook').click())
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('pic.png')
  expect(close).not.toHaveBeenCalled()
  await act(async () => button('Convert notebook').click())
  expect(close).toHaveBeenCalledOnce()
})
