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

async function actionsFit(row: Locator, height: number) {
  const bounds = (await row.boundingBox())!
  expect(bounds.height).toBe(height)
  const count = (await row.locator('.notebook-count').boundingBox())!
  const buttons = await row.locator('.notebook-row-action').all()
  let previousRight = count.x + count.width
  for (const button of buttons) {
    await expect(button).toHaveCSS('opacity', '1')
    await expect(button).toHaveCSS('pointer-events', 'auto')
    const target = (await button.boundingBox())!
    expect(target.width).toBeGreaterThanOrEqual(28)
    expect(target.height).toBeGreaterThanOrEqual(28)
    expect(target.x).toBeGreaterThanOrEqual(previousRight)
    expect(target.x + target.width).toBeLessThanOrEqual(bounds.x + bounds.width + 0.5)
    previousRight = target.x + target.width
  }
}

for (const dark of [false, true])
  for (const cards of [false, true]) {
    test(`${dark ? 'dark' : 'light'}-${cards ? 'cards' : 'default'}: notebook labels reclaim concealed action space`, async ({
      page,
    }) => {
      await page.goto('/')
      await page.locator('.account-trigger').click()
      await page.getByRole('menuitem', { name: 'Settings', exact: true }).click()
      await page.getByLabel('Theme', { exact: true }).selectOption('aster')
      await page.getByRole('button', { name: dark ? 'Dark' : 'Light', exact: true }).click()
      await page.locator(`input[name="app-style"][value="${cards ? 'cards' : 'default'}"]`).check()
      await page.getByLabel('Close settings').click()

      for (const size of [
        { width: 1280, height: 800 },
        { width: 900, height: 650 },
      ]) {
        await page.setViewportSize(size)
        await leaveRow(page)
        for (const id of ['personal', 'learning']) {
          const row = page.locator(`[data-notebook-drop-id="${id}"]`)
          const nav = row.locator('.nav-item')
          const label = nav.locator('span')
          const actions = row.locator('.notebook-row-actions')
          const create = row.locator('.notebook-new-note')
          const menu = row.locator('.notebook-options')
          const height = (await row.boundingBox())!.height
          await expect(actions).toHaveCSS('width', '0px')
          expect(await fits(label)).toBe(true)
          await page.screenshot({ path: test.info().outputPath(`${id}-${size.width}-idle.png`) })

          await row.hover()
          await actionsFit(row, height)
          await page.screenshot({ path: test.info().outputPath(`${id}-${size.width}-hover.png`) })
          await leaveRow(page)

          // Enter from the preceding tab stop, then reach both concealed actions.
          await nav.focus()
          await page.keyboard.press('Shift+Tab')
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
          await actionsFit(row, height)
          await page.screenshot({ path: test.info().outputPath(`${id}-${size.width}-menu.png`) })
          await page.keyboard.press('Escape')
          await expect(menu).toBeFocused()
          await leaveRow(page)
          await expect(actions).toHaveCSS('width', '0px')
          expect(await fits(label)).toBe(true)

          // Selection alone keeps the reclaimed label space.
          await nav.click()
          await leaveRow(page)
          await expect(row).toHaveClass(/selected/)
          await expect(actions).toHaveCSS('width', '0px')
          expect(await fits(label)).toBe(true)
        }
        expect(
          await page.locator('.sidebar-content').evaluate((el) => el.scrollWidth <= el.clientWidth),
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
  await page.getByRole('button', { name: 'Create notebook', exact: true }).click()
  const row = page
    .locator('.notebook-tree-row')
    .filter({ has: page.locator('.nav-item > span', { hasText: name }) })
  const separator = page.getByRole('separator', { name: 'Resize navigation' })
  await separator.focus()
  await separator.press('Shift+ArrowLeft')
  await separator.press('Shift+ArrowLeft')
  await leaveRow(page)
  const label = row.locator('.nav-item > span')
  expect(await fits(label)).toBe(false)
  await expect(label).toHaveCSS('text-overflow', 'ellipsis')
  await expect(row.locator('.notebook-row-actions')).toHaveCSS('width', '0px')
  await row.locator('.nav-item').focus()
  await page.keyboard.press('Tab')
  await expect(row.locator('.notebook-new-note')).toBeFocused()
  await expect(row.locator('.notebook-new-note')).toHaveCSS('opacity', '1')
  await page.keyboard.press('Tab')
  await expect(row.locator('.notebook-options')).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('menu')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(row.locator('.notebook-options')).toBeFocused()
  await leaveRow(page)
  expect(
    await page.locator('.sidebar-content').evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true)
})
