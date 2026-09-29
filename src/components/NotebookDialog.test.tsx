// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import NotebookDialog from './NotebookDialog'
import { defaultAppearance } from '../storage/library'
import type { Notebook } from '../model'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let host: HTMLDivElement | undefined
let root: ReturnType<typeof createRoot> | undefined
afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  host?.remove()
  host = undefined
  root = undefined
  vi.restoreAllMocks()
})

const book: Notebook = {
  id: 'work',
  name: 'Work',
  color: '#899ab4',
  icon: 'briefcase',
  rootId: 'work',
  relativePath: '',
}

async function mount(onUpdated = vi.fn()) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () =>
    root!.render(
      <NotebookDialog
        open
        onOpenChange={vi.fn()}
        notebook={book}
        onCreated={vi.fn()}
        onUpdated={onUpdated}
        fontFamily="system"
        dark={defaultAppearance.dark}
        palette={defaultAppearance.theme}
      />,
    ),
  )
  return onUpdated
}

async function setInput(label: string, value: string, event = 'input') {
  const input = document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event(event, { bubbles: true }))
  })
}

it('prefills edit values, selects a built-in icon, updates color, and explains linked names', async () => {
  const onUpdated = await mount()
  expect(document.querySelector<HTMLInputElement>('[aria-label="Notebook name"]')?.value).toBe(
    'Work',
  )
  expect(document.querySelector<HTMLInputElement>('[aria-label="Notebook color"]')?.value).toBe(
    '#899ab4',
  )
  expect(document.body.textContent).toContain('does not rename the folder')
  expect(
    document
      .querySelector<HTMLButtonElement>('[aria-label="Briefcase"]')
      ?.getAttribute('aria-pressed'),
  ).toBe('true')

  expect(document.querySelectorAll('.notebook-icon-option')).toHaveLength(24)
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Shopping bag"]')!.click())
  await setInput('Notebook name', ' Projects ')
  await setInput('Notebook color', '#c56a5d', 'change')
  await act(async () => document.querySelector<HTMLButtonElement>('button[type="submit"]')!.click())

  expect(onUpdated).toHaveBeenCalledWith('work', {
    name: 'Projects',
    icon: 'shoppingBag',
    color: '#c56a5d',
  })
  expect(document.querySelector('[role="alert"]')).toBeNull()
})
