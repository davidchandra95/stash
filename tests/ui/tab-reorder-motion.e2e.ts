import { expect, test, type Page } from '@playwright/test'

async function appearance(page: Page, options: Record<string, unknown>) {
  await page.evaluate(async (options) => {
    const url = performance
      .getEntriesByType('resource')
      .find((entry) => new URL(entry.name).pathname === '/src/storage/useLibrary.ts')!.name
    const { library } = await import(/* @vite-ignore */ url)
    library.setAppearance({ ...library.getSnapshot().appearance, ...options })
  }, options)
}

async function openTabs(page: Page) {
  await page.goto('/')
  await page.locator('.note-row').first().waitFor()
  for (let i = 0; i < 4; i++)
    await page
      .locator('.note-row')
      .nth(i)
      .click({ modifiers: ['Meta'] })
  return page.getByRole('tablist', { name: 'Open documents', exact: true })
}

for (const theme of ['native', 'workspace']) {
  for (const variant of [
    { width: 1280, height: 800, colorMode: 'light', accent: 'purple' },
    { width: 900, height: 650, colorMode: 'dark', accent: 'green' },
    { width: 1280, height: 800, colorMode: 'dark', accent: 'purple' },
    { width: 900, height: 650, colorMode: 'light', accent: 'green' },
  ]) {
    test(`short keyboard reorder ${theme} ${variant.colorMode} ${variant.width}`, async ({
      page,
    }) => {
      await page.setViewportSize(variant)
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      const strip = await openTabs(page)
      await appearance(page, { ...variant, interfaceTheme: theme, animationsEnabled: true })
      await expect(page.locator('html')).toHaveAttribute('data-motion', 'on')
      const original = await strip
        .locator('[data-tab-id]')
        .evaluateAll((items) => items.map((item) => item.getAttribute('data-tab-id')))
      // Inspect the first rendered frame so timing assertions do not depend on test latency.
      const result = await strip
        .getByRole('tab')
        .last()
        .evaluate(async (button) => {
          const strip = button.closest('.tabs')!
          ;(button as HTMLElement).focus()
          button.dispatchEvent(
            new KeyboardEvent('keydown', {
              key: 'ArrowLeft',
              ctrlKey: true,
              shiftKey: true,
              bubbles: true,
              cancelable: true,
            }),
          )
          await new Promise(requestAnimationFrame)
          return {
            focused: document.activeElement === button,
            animations: strip
              .getAnimations({ subtree: true })
              .filter((animation) =>
                (animation.effect as KeyframeEffect).target?.classList.contains('tab'),
              )
              .map((animation) => ({
                duration: animation.effect!.getTiming().duration,
                frames: (animation.effect as KeyframeEffect)
                  .getKeyframes()
                  .map((frame) => frame.transform),
              })),
          }
        })
      expect(result.focused).toBe(true)
      expect(result.animations).toHaveLength(2)
      result.animations.forEach((animation) => {
        expect(animation.duration).toBe(120)
        expect(animation.frames[0]).not.toBe('translate(0px, 0px)')
        expect(animation.frames[1]).toBe('translate(0px, 0px)')
      })
      const order = [...original]
      ;[order[order.length - 2], order[order.length - 1]] = [
        order[order.length - 1],
        order[order.length - 2],
      ]
      expect(
        await strip
          .locator('[data-tab-id]')
          .evaluateAll((items) => items.map((item) => item.getAttribute('data-tab-id'))),
      ).toEqual(order)
      await strip.evaluate(async (el) => {
        await Promise.allSettled(
          el.getAnimations({ subtree: true }).map((animation) => animation.finished),
        )
      })
      const focusedIsVisible = await strip.evaluate((el) => {
        const focused = document.activeElement?.closest('[data-tab-id]')
        if (!focused) return false
        const bounds = el.getBoundingClientRect()
        const tab = focused.getBoundingClientRect()
        const visibleWidth = Math.min(tab.right, bounds.right) - Math.max(tab.left, bounds.left)
        return visibleWidth >= Math.min(tab.width, bounds.width) - 2
      })
      expect(focusedIsVisible).toBe(true)
      await page.screenshot({ path: test.info().outputPath('tab-reorder.png') })
    })
  }
}

test('neighbors make an exact slot and a cancelled drag slides back without saving', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const strip = await openTabs(page)
  const tabs = strip.locator('[data-tab-id]')
  await strip.evaluate((el) => {
    el.scrollLeft = 0
  })
  const original = await tabs.evaluateAll((items) =>
    items.map((item) => ({
      id: item.getAttribute('data-tab-id'),
      left: (item as HTMLElement).offsetLeft,
    })),
  )
  const first = await tabs.first().getByRole('tab').boundingBox()
  const second = await tabs.nth(1).boundingBox()
  const stripBounds = await strip.boundingBox()
  await page.mouse.move(first!.x + 20, first!.y + 14)
  await page.mouse.down()
  await page.mouse.move(
    Math.min(second!.x + second!.width - 10, stripBounds!.x + stripBounds!.width - 45),
    first!.y + 14,
    { steps: 8 },
  )
  await expect(strip).toHaveClass(/is-reordering/)
  const moving = await tabs.evaluateAll((items) =>
    items.map((item) => getComputedStyle(item).transform),
  )
  expect(moving.some((transform, i) => i > 0 && transform !== 'matrix(1, 0, 0, 1, 0, 0)')).toBe(
    true,
  )
  const durations = await strip.evaluate(async (el) => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    )
    await new Promise(requestAnimationFrame)
    return el
      .getAnimations({ subtree: true })
      .map((animation) => animation.effect!.getTiming().duration)
  })
  expect(durations.length).toBeGreaterThan(0)
  expect(durations.every((duration) => duration === 120)).toBe(true)
  await page.mouse.up()
  await expect(strip).not.toHaveClass(/is-reordering/)
  expect(
    await tabs.evaluateAll((items) =>
      items.map((item) => ({
        id: item.getAttribute('data-tab-id'),
        left: (item as HTMLElement).offsetLeft,
      })),
    ),
  ).toEqual(original)
})

for (const preference of ['reduced-motion', 'animations-off']) {
  test(`reorders immediately with ${preference}`, async ({ page }) => {
    await page.emulateMedia({
      reducedMotion: preference === 'reduced-motion' ? 'reduce' : 'no-preference',
    })
    const strip = await openTabs(page)
    if (preference === 'animations-off') await appearance(page, { animationsEnabled: false })
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'off')
    const before = await strip.locator('[data-tab-id]').last().getAttribute('data-tab-id')
    await strip.getByRole('tab').last().press('Control+Shift+ArrowLeft')
    await expect(strip.locator('[data-tab-id]').nth(2)).toHaveAttribute('data-tab-id', before!)
    expect(await strip.evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0)
  })
}
