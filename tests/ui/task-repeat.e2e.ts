import { expect, test, type Page } from '@playwright/test'

test.use({ timezoneId: 'Asia/Jakarta' })

async function addTask(page: Page, title: string) {
  await page.getByRole('textbox', { name: 'New task', exact: true }).fill(title)
  await page.keyboard.press('Enter')
  await page.getByText(title.replace(/ tomorrow$/, ''), { exact: true }).first().click()
}
async function openInbox(page: Page, url = '/') {
  await page.clock.install({ time: new Date('2026-11-04T10:00:00+07:00') })
  await page.goto(url)
  await page.getByRole('button', { name: /^Projects/ }).first().click()
  await page.getByRole('button', { name: /^Inbox/ }).click()
}
const details = (page: Page) => page.getByRole('complementary', { name: 'Task details' })

test('a weekly task moves forward on completion, leaves history and can be undone', async ({ page }) => {
  await openInbox(page)
  await addTask(page, 'Weekly review')
  await details(page).getByLabel('Repeat', { exact: true }).selectOption('week')
  // A dateless task starts today, a Wednesday.
  await expect(details(page).getByLabel('Repeat', { exact: true }).locator('option:checked')).toHaveText('Weekly on Wednesday')
  await expect(details(page).getByText('it returns on Nov 11')).toBeVisible()

  await details(page).getByRole('checkbox').first().click()
  await expect(page.getByText('Next: Nov 11')).toBeVisible()
  await expect(page.locator('.task-due', { hasText: 'Nov 11' })).toBeVisible()
  // The finished occurrence sits in the collapsed Done group.
  const rows = page.getByRole('option', { name: /Weekly review/ })
  await expect(rows).toHaveCount(1)
  await page.getByRole('button', { name: /^Done/ }).click()
  await expect(rows).toHaveCount(2)
  await expect(page.getByRole('img', { name: 'Repeats: Every week on Wed' })).toHaveCount(1)

  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(rows).toHaveCount(1)
  await expect(page.locator('.task-due', { hasText: 'Nov 4' })).toBeVisible()
})

test('custom repeats choose an interval and weekdays, and can count from completion', async ({ page }) => {
  await openInbox(page)
  await addTask(page, 'Water plants')
  const panel = details(page)
  await panel.getByLabel('Repeat', { exact: true }).selectOption('custom')
  await panel.getByLabel('Every', { exact: true }).fill('2')
  await panel.getByRole('button', { name: 'Friday' }).click()
  await expect(panel.getByRole('button', { name: 'Friday' })).toHaveAttribute('aria-pressed', 'true')
  // Nov 4 is a Wednesday, so Friday falls in the same week.
  await expect(panel.getByText('it returns on Nov 6')).toBeVisible()
  // The only remaining day can't be turned off.
  await panel.getByRole('button', { name: 'Wednesday' }).click()
  await expect(panel.getByRole('button', { name: 'Friday' })).toBeDisabled()

  await panel.getByLabel('From', { exact: true }).selectOption('completion')
  await expect(panel.getByRole('group', { name: 'Repeat on' })).toBeHidden()
  await expect(panel.getByText('it returns 2 weeks after completion')).toBeVisible()

  await panel.getByLabel('Repeat', { exact: true }).selectOption('none')
  await expect(panel.getByLabel('From', { exact: true })).toBeHidden()
  await expect(page.getByRole('img', { name: /^Repeats:/ })).toHaveCount(0)
})

test('the Android task page offers repeats at touch size', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.clock.install({ time: new Date('2026-11-04T10:00:00+07:00') })
  await page.goto('/?mobile=1')
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.getByRole('button', { name: /^Inbox/ }).click()
  await page.getByRole('textbox', { name: 'New task', exact: true }).fill('Pay rent')
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Pay rent', exact: false }).first().click()
  await page.getByLabel('Repeat', { exact: true }).selectOption('custom')
  const day = page.getByRole('button', { name: 'Friday' })
  expect((await day.boundingBox())!.height).toBeGreaterThanOrEqual(48)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
