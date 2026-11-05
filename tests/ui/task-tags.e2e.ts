import { expect, test, type Page } from '@playwright/test'

test.use({ timezoneId: 'Asia/Jakarta' })

const tagChip = (page: Page, name: string) =>
  page.locator('.side-tags').getByRole('button', { name: `#${name}`, exact: true })

async function openProjects(page: Page) {
  await page.clock.install({ time: new Date('2026-11-03T10:00:00+07:00') })
  await page.goto('/')
  await page
    .getByRole('button', { name: /^Projects/ })
    .first()
    .click()
}

test('adds tags by typing, suggests existing ones, and opens a page per tag', async ({ page }) => {
  await openProjects(page)
  await page.getByRole('button', { name: /^Inbox/ }).click()
  await page.getByRole('option', { name: /Book the dentist/ }).click()

  const input = page.getByRole('textbox', { name: 'Tags' })
  await input.click()
  const offered = page.getByRole('group', { name: 'Existing tags' })
  await expect(offered.getByRole('button', { name: '#launch' })).toBeVisible()
  await input.pressSequentially('wri')
  await expect(offered.getByRole('button', { name: '#launch' })).toHaveCount(0)
  await offered.getByRole('button', { name: '#writing' }).click()
  await expect(input).toBeFocused()
  await input.fill('Deep Focus')
  await input.press('Enter')
  const detail = page.getByRole('complementary', { name: 'Task details' })
  await expect(detail.getByText('#deep-focus')).toBeVisible()
  await expect(tagChip(page, 'deep-focus')).toBeVisible()

  await tagChip(page, 'deep-focus').click()
  await expect(page.getByRole('heading', { name: 'deep-focus' })).toBeVisible()
  await expect(page.getByRole('option', { name: /Book the dentist/ })).toBeVisible()

  // A task added here stays on the page.
  await page.getByRole('textbox', { name: 'New task', exact: true }).fill('Plan the week #home')
  await page.getByRole('textbox', { name: 'New task', exact: true }).press('Enter')
  const added = page.getByRole('option', { name: /Plan the week/ })
  await expect(added).toContainText('#deep-focus')
  await expect(added).toContainText('#home')
  await expect(added.locator('.task-title')).toHaveText('Plan the week')

  // Back returns here after leaving, and removing the last use retires the tag.
  await page.getByRole('button', { name: /^Today/ }).click()
  await page.getByRole('button', { name: 'Go back', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'deep-focus' })).toBeVisible()
  await page.getByRole('option', { name: /Book the dentist/ }).click()
  await page.getByRole('button', { name: 'Remove tag deep-focus' }).click()
  await added.click()
  await page.getByRole('button', { name: 'Remove tag deep-focus' }).click()
  await expect(tagChip(page, 'deep-focus')).toHaveCount(0)
  await expect(page.getByText('No tasks with this tag.')).toBeVisible()
})

test('smart input leaves numbers alone and treats #today as a tag', async ({ page }) => {
  await openProjects(page)
  await page.getByRole('button', { name: /^Inbox/ }).click()
  const input = page.getByRole('textbox', { name: 'New task', exact: true })
  await input.fill('Fix bug #123 #today')
  await expect(page.locator('.smart-task-match')).toHaveText(['#today'])
  await input.press('Enter')
  const row = page.getByRole('option', { name: /Fix bug #123/ })
  await expect(row.locator('.task-title')).toHaveText('Fix bug #123')
  await expect(row.locator('.task-due')).toHaveCount(0)
  await expect(row).toContainText('#today')
})

test('Android edits tags on the task page and lists them in the drawer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.clock.install({ time: new Date('2026-11-03T10:00:00+07:00') })
  await page.goto('/?mobile=1')
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.getByRole('navigation', { name: 'Projects', exact: true }).getByRole('button', { name: /^Inbox/ }).click()
  await page.locator('.mobile-task-label', { hasText: 'Book the dentist' }).click()
  const input = page.getByPlaceholder('Add tag')
  await input.fill('errands')
  await input.press('Enter')
  await expect(page.locator('.mobile-task-page').getByText('#errands')).toBeVisible()

  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await page.getByRole('button', { name: 'Open navigation' }).click()
  const tags = page.getByRole('navigation', { name: 'Task tags' })
  await tags.getByRole('button', { name: /errands/ }).click()
  await expect(page.locator('.mobile-heading-title')).toHaveText('#errands')
  await expect(page.locator('.mobile-task-label', { hasText: 'Book the dentist' })).toContainText('#errands')
})
