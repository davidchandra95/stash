// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import Appearance from './Appearance'
import { defaultAppearance } from '../storage/library'

it('offers labeled style radios and updates immediately without closing or resetting other preferences', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  let current = { ...defaultAppearance, theme: 'zen' as const }
  function Harness() {
    const [value, setValue] = useState<typeof defaultAppearance>(current)
    current = value as typeof current
    return <Appearance open onOpenChange={() => {}} value={value} onChange={setValue} />
  }
  try {
    await act(() => root.render(<Harness />))
    const radios = [...document.querySelectorAll<HTMLInputElement>('input[name="app-style"]')]
    expect(radios).toHaveLength(2)
    expect(radios[0].checked).toBe(true)
    expect(radios[1].labels?.[0].textContent).toContain('Modern cards')
    await act(() => radios[1].click())
    expect(radios[1].checked).toBe(true)
    expect(current).toEqual({ ...defaultAppearance, theme: 'zen', appStyle: 'cards' })
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    await act(() => radios[0].click())
    expect(current.appStyle).toBe('default')
  } finally {
    await act(() => root.unmount())
    host.remove()
  }
})

it('updates list item spacing without changing other writing preferences', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  let current = { ...defaultAppearance, lineSpacing: 1.8, paragraphSpacing: 12 }
  function Harness() {
    const [value, setValue] = useState<typeof defaultAppearance>(current)
    current = value as typeof current
    return <Appearance open onOpenChange={() => {}} value={value} onChange={setValue} />
  }
  try {
    await act(() => root.render(<Harness />))
    const editorCategory = [
      ...document.querySelectorAll<HTMLButtonElement>('nav[aria-label="Settings categories"] button'),
    ].find((button) => button.textContent === 'Editor')!
    await act(() => editorCategory.click())
    const spacing = document.querySelector<HTMLInputElement>('[aria-label="List item spacing"]')!
    expect(spacing.value).toBe('0')
    expect(spacing.min).toBe('-8')
    await act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(spacing, '-4')
      spacing.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(current).toEqual({ ...defaultAppearance, lineSpacing: 1.8, paragraphSpacing: 12, listItemSpacing: -4 })
    expect(spacing.getAttribute('aria-valuetext')).toBe('-4 px')
  } finally {
    await act(() => root.unmount())
    host.remove()
  }
})
