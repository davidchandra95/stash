// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import DateField from './DateField'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: ReturnType<typeof createRoot> | undefined
const changes: (string | null)[] = []

function Harness({ initial }: { initial: string | null }) {
  const [value, setValue] = useState(initial)
  return (
    <DateField
      label="Due"
      value={value}
      onChange={(next) => {
        changes.push(next)
        setValue(next)
      }}
    />
  )
}
async function mount(initial: string | null) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 3, 12))
  const host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  await act(async () => root!.render(<Harness initial={initial} />))
  await act(async () => document.querySelector<HTMLButtonElement>('.date-field')!.click())
}
const button = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('.date-picker button')].find(
    (node) => node.getAttribute('aria-label') === name || node.textContent === name,
  )
const panel = () => document.querySelector('.date-picker')
const trigger = () => document.querySelector('.date-field')!
afterEach(async () => {
  if (root) await act(async () => root!.unmount())
  root = undefined
  document.body.innerHTML = ''
  changes.length = 0
  vi.useRealTimers()
})

it('opens on the value and focuses it, then saves a local date and closes', async () => {
  await mount('2026-02-28')
  expect(trigger().getAttribute('aria-label')).toBe('Due: Feb 28, 2026')
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Saturday, February 28, 2026')
  expect(document.querySelector('[aria-selected="true"] button')).toBe(document.activeElement)
  await act(async () => button('Sunday, March 1, 2026')!.click())
  expect(changes).toEqual(['2026-03-01'])
  expect(panel()).toBeNull()
  expect(trigger().getAttribute('aria-label')).toBe('Due: Mar 1, 2026')
})

it('opens on today when empty and has no Clear', async () => {
  await mount(null)
  expect(trigger().textContent).toBe('No date')
  expect(document.activeElement?.getAttribute('aria-current')).toBe('date')
  expect(document.querySelector('[aria-selected="true"]')).toBeNull()
  expect(button('Clear')).toBeUndefined()
  await act(async () => button('Today')!.click())
  expect(changes).toEqual(['2026-11-03'])
})

it('clears the value', async () => {
  await mount('2026-11-20')
  await act(async () => button('Clear')!.click())
  expect(changes).toEqual([null])
  expect(trigger().textContent).toBe('No date')
})

it('keeps six weeks across months and moves by keyboard', async () => {
  await mount('2026-11-30')
  const days = () => document.querySelectorAll('[data-calendar-day]').length
  expect(days()).toBe(42)
  const press = async (key: string, shiftKey = false) =>
    act(async () => {
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }),
      )
    })
  await press('ArrowRight')
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Tuesday, December 1, 2026')
  expect(days()).toBe(42)
  await press('PageUp', true)
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Monday, December 1, 2025')
  expect(changes).toEqual([])
})
