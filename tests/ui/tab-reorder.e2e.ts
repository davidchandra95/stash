import { expect, test } from '@playwright/test'

for (const variant of [
  { width: 1280, height: 800, colorMode: 'light', motion: 'no-preference' },
  { width: 900, height: 650, colorMode: 'dark', motion: 'reduce' },
] as const) {
  test(`reorders tabs with pointer and keyboard ${variant.colorMode}`, async ({ page }) => {
    await page.setViewportSize(variant)
    await page.emulateMedia({ reducedMotion: variant.motion })
    await page.goto('/')
    await page.locator('.note-row').first().waitFor()
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page
      .getByRole('radiogroup', { name: 'Appearance', exact: true })
      .getByRole('radio', { name: variant.colorMode === 'dark' ? 'Dark' : 'Light', exact: true })
      .click()
    await page.getByLabel('Close settings').click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', variant.colorMode)
    const rows = page.locator('.note-row')
    for (let i = 0; i < Math.min(6, await rows.count()); i++)
      await rows.nth(i).click({ modifiers: ['Meta'] })
    const strip = page.getByRole('tablist', { name: 'Open documents', exact: true })
    const items = strip.locator('[data-tab-id]')
    const ids = () => items.evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.tabId))
    const original = await ids()
    expect(original.length).toBeGreaterThan(2)
    const active = await strip.locator('.is-active').getAttribute('data-tab-id')
    await strip.evaluate((el) => {
      el.scrollLeft = 0
    })
    const first = await items.first().locator('[role="tab"]').boundingBox()
    const bounds = await strip.boundingBox()
    await page.mouse.move(first!.x + 30, first!.y + 16)
    await page.mouse.down()
    await page.mouse.move(bounds!.x + bounds!.width - 5, first!.y + 16, { steps: 15 })
    await expect(strip).toHaveClass(/is-reordering/)
    await expect.poll(() => strip.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
    await page.waitForTimeout(900)
    await page.mouse.up()
    await expect.poll(ids).not.toEqual(original)
    expect(await strip.locator('.is-active').getAttribute('data-tab-id')).toBe(active)
    await expect(strip).not.toHaveClass(/is-reordering/)
    const moved = await ids()
    // Escape and release outside must leave committed order intact.
    await strip.evaluate((el) => {
      el.scrollLeft = 0
    })
    const box = await items.first().locator('[role="tab"]').boundingBox()
    await page.mouse.move(box!.x + 30, box!.y + 16)
    await page.mouse.down()
    await page.mouse.move(box!.x + 170, box!.y + 16)
    await page.keyboard.press('Escape')
    await page.mouse.up()
    expect(await ids()).toEqual(moved)
    await page.mouse.move(box!.x + 30, box!.y + 16)
    await page.mouse.down()
    await page.mouse.move(box!.x + 170, box!.y + 100)
    await page.mouse.up()
    expect(await ids()).toEqual(moved)
    const button = items.first().locator('[role="tab"]')
    await button.focus()
    await button.press('Control+Shift+ArrowRight')
    expect((await ids())[1]).toBe(moved[0])
    await expect(button).not.toBeFocused() // first slot now contains a different tab
    await expect(strip.locator(`[data-tab-id="${moved[0]}"] [role="tab"]`)).toBeFocused()
    await page.screenshot({
      path: test.info().outputPath(`tab-reorder-${variant.colorMode}.png`),
    })
  })
}

test('mobile keeps its existing navigation without a desktop tab strip', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?mobile=1')
  await expect(page.locator('.mobile-app')).toBeVisible()
  await expect(page.getByRole('tablist', { name: 'Open documents' })).toHaveCount(0)
  await expect(page.locator('.tabs')).toHaveCount(0)
})
