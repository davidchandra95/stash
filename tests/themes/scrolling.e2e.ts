import { expect, test } from '@playwright/test'

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`note scrolling stays native with motion ${reducedMotion}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion })
    await page.goto('/')
    await page.locator('.note-row[data-note-id="writing-lab"]').click()
    const pane = page.locator('.note-scroll')
    await expect(pane.locator('.tiptap')).toBeVisible()
    expect(await pane.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)

    // Exercise the mounted app's wheel handlers. Synthetic input must remain
    // uncancelled so the browser can apply scrolling and trackpad momentum.
    const intercepted = await pane.locator('.tiptap').evaluate((el) =>
      [
        { deltaY: 100 },
        { deltaY: 10, deltaX: 0.1 },
        { deltaY: -100 },
        { deltaY: 3, deltaMode: WheelEvent.DOM_DELTA_LINE },
        { deltaY: 1, deltaMode: WheelEvent.DOM_DELTA_PAGE },
      ].map((delta) => {
        const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...delta })
        el.dispatchEvent(event)
        return event.defaultPrevented
      }),
    )
    expect(intercepted).toEqual([false, false, false, false, false])

    await pane.evaluate((el) => {
      el.scrollTop = 0
    })
    await pane.hover()
    await page.mouse.wheel(0, 300)
    await expect.poll(() => pane.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
    const afterDown = await pane.evaluate((el) => el.scrollTop)
    await page.mouse.wheel(0, -300)
    await expect.poll(() => pane.evaluate((el) => el.scrollTop)).toBeLessThan(afterDown)
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
  })
}
