import { test, expect, type Page } from '@playwright/test'

async function settings(page: Page) {
  await page.locator('.account-trigger').click()
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click()
}

async function checkWidth(page: Page, percent: number, context: string) {
  const geometry = await page.locator('.note-article').evaluate((article) => {
    const scroll = article.closest('.note-scroll')!
    const style = getComputedStyle(scroll)
    const available =
      scroll.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
    const box = article.getBoundingClientRect()
    const title = article.querySelector('.note-title')!.getBoundingClientRect()
    const body = article.querySelector('.tiptap')!.getBoundingClientRect()
    const left = scroll.getBoundingClientRect().left + parseFloat(style.paddingLeft)
    return {
      available,
      width: box.width,
      center: box.left + box.width / 2,
      expectedCenter: left + available / 2,
      titleLeft: title.left,
      bodyLeft: body.left,
    }
  })
  expect
    .soft(
      Math.abs(geometry.width - (geometry.available * percent) / 100),
      `${context}: writing width`,
    )
    .toBeLessThan(1)
  expect
    .soft(Math.abs(geometry.center - geometry.expectedCenter), `${context}: centered article`)
    .toBeLessThan(1)
  expect
    .soft(Math.abs(geometry.titleLeft - geometry.bodyLeft), `${context}: title and body alignment`)
    .toBeLessThan(1)
}

for (const appStyle of ['default', 'cards']) {
  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 900, height: 650 },
  ]) {
    test(`${appStyle} ${viewport.width}: writing width slider, outline, focus and retained setting`, async ({
      page,
    }) => {
      test.setTimeout(90000)
      await page.setViewportSize(viewport)
      await page.goto('/')
      await page.locator('.note-row[data-note-id="writing-lab"]').click()
      await settings(page)
      await page.locator(`input[name="app-style"][value="${appStyle}"]`).check()
      await page
        .getByRole('navigation', { name: 'Settings categories' })
        .getByRole('button', { name: 'Editor', exact: true })
        .click()
      const slider = page.getByRole('slider', { name: 'Writing width', exact: true })
      // Use keyboard input on the real settings slider so React and persistence run normally.
      for (const percent of [40, 100, 65]) {
        await slider.focus()
        await slider.press('Home')
        for (let value = 40; value < percent; value++) await slider.press('ArrowRight')
        await expect(slider).toHaveValue(String(percent))
        await expect(slider).toHaveAttribute('aria-valuetext', `${percent}%`)
        await page.getByLabel('Close settings').click()
        await checkWidth(page, percent, `${percent}% closed`)
        await page.getByRole('button', { name: 'Table of contents', exact: true }).click()
        await expect(page.locator('.note-outline')).toBeVisible()
        await checkWidth(page, percent, `${percent}% outline`)
        if (percent === 65)
          await page.screenshot({
            path: test.info().outputPath(`writing-width-${viewport.width}-outline.png`),
          })
        await page.getByRole('button', { name: 'Close table of contents', exact: true }).click()
        await expect(page.locator('.note-outline')).toHaveCount(0)
        await page.getByRole('button', { name: 'Focus mode', exact: true }).click()
        await checkWidth(page, percent, `${percent}% focus closed`)
        await page.getByRole('button', { name: 'Table of contents', exact: true }).click()
        await expect(page.locator('.note-outline')).toBeVisible()
        await checkWidth(page, percent, `${percent}% focus outline`)
        await page.getByRole('button', { name: 'Close table of contents', exact: true }).click()
        await expect(page.locator('.note-outline')).toHaveCount(0)
        await page.getByRole('button', { name: 'Exit focus mode', exact: true }).click()
        if (percent === 65)
          await page.screenshot({
            path: test.info().outputPath(`writing-width-${viewport.width}-closed.png`),
          })
        await settings(page)
        await page
          .getByRole('navigation', { name: 'Settings categories' })
          .getByRole('button', { name: 'Editor', exact: true })
          .click()
      }
      await page.getByLabel('Close settings').click()
      await checkWidth(page, 65, 'settings reopened')
      await settings(page)
      await page
        .getByRole('navigation', { name: 'Settings categories' })
        .getByRole('button', { name: 'Editor', exact: true })
        .click()
      await expect(slider).toHaveValue('65')
    })
  }
}

test('writing width stays independent of palette, color mode and app style', async ({ page }) => {
  test.setTimeout(90000)
  await page.goto('/')
  await page.locator('.note-row[data-note-id="writing-lab"]').click()
  for (const appStyle of ['default', 'cards'])
    for (const theme of [
      'classic',
      'zen',
      'financial',
      'tiktok',
      'catppuccin',
      'lastchat',
      'qrafthive',
      'aster',
    ])
      for (const dark of [false, true]) {
        await page.evaluate(
          async ({ appStyle, theme, dark }) => {
            const url = performance
              .getEntriesByType('resource')
              .find((entry) => new URL(entry.name).pathname === '/src/storage/useLibrary.ts')!.name
            const { library } = await import(/* @vite-ignore */ url)
            library.setAppearance({
              ...library.getSnapshot().appearance,
              appStyle,
              theme,
              dark,
              width: 40,
              animationsEnabled: false,
            })
          },
          { appStyle, theme, dark },
        )
        for (const viewport of [
          { width: 1280, height: 800 },
          { width: 900, height: 650 },
        ]) {
          await page.setViewportSize(viewport)
          await expect(page.locator('.app')).toHaveAttribute('data-palette', theme)
          await checkWidth(page, 40, `${appStyle} ${theme} ${dark} ${viewport.width} closed`)
          await page.getByRole('button', { name: 'Table of contents', exact: true }).click()
          await expect(page.locator('.note-outline')).toBeVisible()
          await checkWidth(page, 40, `${appStyle} ${theme} ${dark} ${viewport.width} outline`)
          await page.getByRole('button', { name: 'Close table of contents', exact: true }).click()
        }
      }
})

test('mobile note stays full width in portrait and landscape', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?mobile=1')
  await page.locator('.mobile-note-label').first().click()
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport)
    await checkWidth(page, 100, `mobile ${viewport.width}`)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
})
