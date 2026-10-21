import { test, expect, type Locator, type Page } from '@playwright/test'

test.describe.configure({ mode: 'parallel' })

async function leaveRow(page: Page) {
  await page.locator('.note-title').focus()
  const viewport = page.viewportSize()!
  await page.mouse.move(viewport.width - 10, viewport.height - 10)
}

async function fits(label: Locator) {
  return label.evaluate((el) => el.scrollWidth <= el.clientWidth)
}

/** Revealed actions replace the count, follow the label and stay inside the row. */
async function actionsFit(row: Locator, height: number, menuOpen = false) {
  const bounds = (await row.boundingBox())!
  expect(bounds.height).toBe(height)
  await expect(row.locator('.side-row-main .count')).toBeHidden()
  const main = (await row.locator('.side-row-main').boundingBox())!
  const buttons = await row.locator('.side-actions button').all()
  expect(buttons).toHaveLength(2)
  let previousRight = main.x + main.width
  for (const button of buttons) {
    await expect(button).toBeVisible()
    // An open modal menu disables pointer events outside it.
    if (!menuOpen) await expect(button).toHaveCSS('pointer-events', 'auto')
    const target = (await button.boundingBox())!
    // Compact 20px icon buttons (`.icon-btn-sm`) inside a 24px row.
    expect(target.width).toBeGreaterThanOrEqual(20)
    expect(target.height).toBeGreaterThanOrEqual(20)
    expect(target.y).toBeGreaterThanOrEqual(bounds.y - 0.5)
    expect(target.y + target.height).toBeLessThanOrEqual(bounds.y + bounds.height + 0.5)
    expect(target.x).toBeGreaterThanOrEqual(previousRight - 0.5)
    expect(target.x + target.width).toBeLessThanOrEqual(bounds.x + bounds.width + 0.5)
    previousRight = target.x + target.width
  }
}

for (const colorMode of ['light', 'dark'] as const) {
  test(`${colorMode}: notebook labels reclaim concealed action space`, async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page
      .getByRole('radiogroup', { name: 'Appearance', exact: true })
      .getByRole('radio', { name: colorMode === 'dark' ? 'Dark' : 'Light', exact: true })
      .click()
    await page.getByLabel('Close settings').click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', colorMode)

    for (const size of [
      { width: 1280, height: 800 },
      { width: 900, height: 650 },
    ]) {
      await page.setViewportSize(size)
      await leaveRow(page)
      for (const id of ['personal', 'learning']) {
        const row = page.locator(`[data-notebook-drop-id="${id}"]`)
        const nav = row.locator('.side-row-main')
        const label = nav.locator('.side-label')
        const name = (await label.textContent())!
        const actions = row.locator('.side-actions')
        const create = row.getByRole('button', { name: `New note in ${name}`, exact: true })
        const menu = row.getByRole('button', { name: `Actions for ${name}`, exact: true })
        const height = (await row.boundingBox())!.height
        await expect(actions).toBeHidden()
        expect(await fits(label)).toBe(true)
        await page.screenshot({ path: test.info().outputPath(`${id}-${size.width}-idle.png`) })

        await row.hover()
        await actionsFit(row, height)
        await page.screenshot({ path: test.info().outputPath(`${id}-${size.width}-hover.png`) })
        await leaveRow(page)

        // Enter from the preceding tab stop, then reach both concealed actions. Hidden actions
        // are not tab stops, so backing up can land on the previous row, whose actions then
        // appear and come before this row in the tab order.
        await nav.focus()
        await page.keyboard.press('Shift+Tab')
        for (let i = 0; i < 3 && !(await nav.evaluate((el) => el === document.activeElement)); i++)
          await page.keyboard.press('Tab')
        await expect(nav).toBeFocused()
        await actionsFit(row, height)
        await page.keyboard.press('Tab')
        await expect(create).toBeFocused()
        await expect(create).toHaveCSS('outline-style', 'solid')
        await actionsFit(row, height)
        await page.screenshot({ path: test.info().outputPath(`${id}-${size.width}-focus.png`) })
        await page.keyboard.press('Tab')
        await expect(menu).toBeFocused()
        await menu.press('Enter')
        await expect(page.getByRole('menu')).toBeVisible()
        await actionsFit(row, height, true)
        await page.screenshot({ path: test.info().outputPath(`${id}-${size.width}-menu.png`) })
        await page.keyboard.press('Escape')
        // Focus return after Escape is covered (and currently failing) in its own test below.
        await expect(page.getByRole('menu')).toHaveCount(0)
        await leaveRow(page)
        await expect(actions).toBeHidden()
        expect(await fits(label)).toBe(true)

        // Selection alone keeps the reclaimed label space.
        await nav.click()
        await leaveRow(page)
        await expect(row).toHaveClass(/\bis-selected\b/)
        await expect(nav).toHaveAttribute('aria-current', 'page')
        await expect(actions).toBeHidden()
        expect(await fits(label)).toBe(true)
      }
      expect(
        await page.locator('.sidebar-scroll').evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true)
    }
  })
}

test('long nested names still truncate and retain keyboard actions in a resized pane', async ({
  page,
}) => {
  await page.goto('/')
  await page.setViewportSize({ width: 900, height: 650 })
  const parent = page.locator('[data-notebook-drop-id="personal"]')
  await parent.hover()
  await parent.locator('.notebook-options').click()
  await page.getByRole('menuitem', { name: 'New sub-notebook', exact: true }).click()
  const name = 'Research notes with a deliberately long notebook name'
  await page.getByRole('textbox', { name: 'Notebook name', exact: true }).fill(name)
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  const row = page
    .locator('.side-row.has-actions')
    .filter({ has: page.locator('.side-label', { hasText: name }) })
  const separator = page.getByRole('separator', { name: 'Resize notebooks sidebar' })
  await separator.focus()
  await separator.press('Shift+ArrowLeft')
  await separator.press('Shift+ArrowLeft')
  await leaveRow(page)
  const label = row.locator('.side-label')
  expect(await fits(label)).toBe(false)
  await expect(label).toHaveCSS('text-overflow', 'ellipsis')
  await expect(row.locator('.side-actions')).toBeHidden()
  const create = row.getByRole('button', { name: `New note in ${name}`, exact: true })
  const menu = row.getByRole('button', { name: `Actions for ${name}`, exact: true })
  await row.locator('.side-row-main').focus()
  await page.keyboard.press('Tab')
  await expect(create).toBeFocused()
  await expect(create).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(menu).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('menu')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
  await leaveRow(page)
  expect(
    await page.locator('.sidebar-scroll').evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true)
})

test('Escape from a keyboard-opened notebook menu returns focus to its trigger', async ({
  page,
}) => {
  // Suspected v2 bug: `.side-actions` is `display: none` once the menu closes and the row has
  // lost focus-within, so Radix cannot restore focus and it falls to <body>. Opening the menu
  // with the mouse works because hover keeps the actions shown. Remove `test.fail` once fixed.
  test.fail()
  await page.goto('/')
  const row = page.locator('[data-notebook-drop-id="personal"]')
  const menu = row.getByRole('button', { name: 'Actions for Personal', exact: true })
  await row.locator('.side-row-main').focus()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await expect(menu).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('menu')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect(menu).toBeFocused({ timeout: 2000 })
})
