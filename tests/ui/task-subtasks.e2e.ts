import { expect, test, type Locator, type Page } from '@playwright/test'

test.use({ timezoneId: 'Asia/Jakarta' })

/** The subtask titles in order. */
const values = (inputs: Locator) => () =>
  inputs.evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value))
const subtaskTitles = (scope: Locator | Page) => scope.getByRole('textbox', { name: 'Subtask', exact: true })

async function openTask(page: Page, title: RegExp) {
  await page.clock.install({ time: new Date('2026-11-03T10:00:00+07:00') })
  await page.goto('/')
  await page
    .getByRole('button', { name: /^Projects/ })
    .first()
    .click()
  await page.getByRole('button', { name: /^Website relaunch/ }).click()
  await page.getByRole('option', { name: title }).click()
}

test('adds, completes, renames, reorders and removes subtasks', async ({ page }) => {
  await openTask(page, /Write homepage copy/)
  const detail = page.getByRole('complementary', { name: 'Task details' })
  const titles = subtaskTitles(detail)
  const row = page.getByRole('option', { name: /Write homepage copy/ })
  await expect.poll(values(titles)).toEqual(['Hero headline', 'Three feature blocks', 'Pricing teaser'])
  await expect(row.getByRole('img', { name: '1 of 3 subtasks done' })).toBeVisible()

  // Return keeps the add field open for the next one.
  const add = detail.getByRole('textbox', { name: 'Add subtask' })
  await add.fill('Proofread')
  await add.press('Enter')
  await expect(add).toBeFocused()
  await expect(add).toHaveValue('')
  await add.fill('Ship it')
  await add.press('Enter')
  await expect
    .poll(values(titles))
    .toEqual(['Hero headline', 'Three feature blocks', 'Pricing teaser', 'Proofread', 'Ship it'])

  await detail.getByRole('checkbox', { name: 'Complete subtask “Pricing teaser”' }).click()
  await expect(detail.getByRole('checkbox', { name: 'Reopen subtask “Pricing teaser”' })).toBeChecked()
  await expect(row.getByRole('img', { name: '2 of 5 subtasks done' })).toBeVisible()
  // Subtasks never complete the task.
  await expect(row.getByRole('checkbox')).not.toBeChecked()

  // Rename, then move up with Option+Up.
  await titles.nth(4).fill('Ship the copy')
  await titles.nth(4).press('Alt+ArrowUp')
  await expect
    .poll(values(titles))
    .toEqual(['Hero headline', 'Three feature blocks', 'Pricing teaser', 'Ship the copy', 'Proofread'])
  await expect(titles.nth(3)).toBeFocused()

  // Backspace in an emptied subtask removes it and moves to its neighbour.
  await titles.nth(4).fill('')
  await titles.nth(4).press('Backspace')
  await expect(titles).toHaveCount(4)
  await expect(titles.nth(3)).toBeFocused()
  await detail.getByRole('button', { name: 'Remove subtask “Hero headline”' }).click()
  await expect.poll(values(titles)).toEqual(['Three feature blocks', 'Pricing teaser', 'Ship the copy'])
  await expect(row.getByRole('img', { name: '1 of 3 subtasks done' })).toBeVisible()
})

test('pasting several lines adds one subtask per line', async ({ page }) => {
  await openTask(page, /Set up redirects/)
  const detail = page.getByRole('complementary', { name: 'Task details' })
  await detail.getByRole('textbox', { name: 'Add subtask' }).focus()
  await page.evaluate(() => {
    const data = new DataTransfer()
    data.setData('text/plain', 'List old URLs\n\nMap new paths\r\nTest them')
    document.activeElement!.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    )
  })
  await expect.poll(values(subtaskTitles(detail))).toEqual(['List old URLs', 'Map new paths', 'Test them'])
  await expect(
    page.getByRole('option', { name: /Set up redirects/ }).getByRole('img', { name: '0 of 3 subtasks done' }),
  ).toBeVisible()
})

test('Android edits subtasks on the task page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.clock.install({ time: new Date('2026-11-03T10:00:00+07:00') })
  await page.goto('/?mobile=1')
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await page
    .getByRole('navigation', { name: 'Projects', exact: true })
    .getByRole('button', { name: /^Inbox/ })
    .click()
  await page.locator('.mobile-task-label', { hasText: 'Book the dentist' }).click()
  const add = page.getByRole('textbox', { name: 'Add subtask' })
  await add.fill('Find insurance card')
  await add.press('Enter')
  await page.getByRole('checkbox', { name: 'Complete subtask “Find insurance card”' }).click()
  await expect(page.getByRole('checkbox', { name: 'Reopen subtask “Find insurance card”' })).toBeChecked()
  await expect(page.getByRole('button', { name: 'Remove subtask “Find insurance card”' })).toBeVisible()
})
