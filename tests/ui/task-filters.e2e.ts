import { expect, test, type Page } from '@playwright/test'

test.use({ timezoneId: 'Asia/Jakarta' })

const filters = (page: Page) => page.locator('.side-section', { hasText: 'Filters' })

async function openProjects(page: Page) {
  await page.clock.install({ time: new Date('2026-11-03T10:00:00+07:00') })
  await page.goto('/')
  await page
    .getByRole('button', { name: /^Projects/ })
    .first()
    .click()
}

test('creates, edits, duplicates and deletes a saved filter', async ({ page }) => {
  await openProjects(page)
  await expect(filters(page).getByText(/Save tasks that match/)).toBeVisible()

  await page.getByRole('button', { name: 'New filter' }).click()
  const dialog = page.getByRole('dialog', { name: 'New filter' })
  // An empty name is refused.
  await dialog.getByRole('button', { name: 'Create filter' }).click()
  await expect(dialog.getByRole('alert')).toHaveText('Enter a filter name.')

  await dialog.getByLabel('Name').fill('Launch work')
  await dialog.getByRole('group', { name: 'Tags' }).getByRole('button', { name: '#launch' }).click()
  await expect(dialog.getByText('3 tasks match now.')).toBeVisible()
  await dialog.getByRole('group', { name: 'Priority' }).getByRole('button', { name: 'Medium' }).click()
  await expect(dialog.getByText('2 tasks match now.')).toBeVisible()
  await dialog.getByRole('button', { name: 'Create filter' }).click()

  // The new filter opens, grouped like a tag page.
  await expect(page.getByRole('heading', { name: 'Launch work' })).toBeVisible()
  await expect(page.getByText('Open tasks · #launch · Medium priority')).toBeVisible()
  const list = page.getByRole('listbox', { name: 'Tasks' })
  await expect(list.getByRole('group', { name: 'Overdue' })).toContainText('Migrate blog posts')
  await expect(list.getByRole('group', { name: 'To do' })).toContainText('Launch announcement email')
  await expect(list.getByRole('option', { name: /Write homepage copy/ })).toHaveCount(0)
  const row = filters(page).getByRole('button', { name: /^Launch work/ })
  await expect(row).toHaveAttribute('aria-current', 'page')
  await expect(row.locator('.count')).toHaveText('2')

  // Editing widens it.
  await page.getByRole('button', { name: 'Edit filter' }).click()
  const edit = page.getByRole('dialog', { name: 'Edit filter' })
  await edit.getByRole('group', { name: 'Priority' }).getByRole('button', { name: 'High' }).click()
  await edit.getByRole('button', { name: 'Save' }).click()
  await expect(list.getByRole('option', { name: /Write homepage copy/ })).toBeVisible()
  await expect(row.locator('.count')).toHaveText('3')

  // Duplicate, then delete the copy and undo.
  await row.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Duplicate Filter' }).click()
  await expect(page.getByRole('heading', { name: 'Launch work copy' })).toBeVisible()
  await page.getByRole('button', { name: 'Delete filter' }).click()
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible()
  await expect(filters(page).getByRole('button', { name: /^Launch work copy/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(filters(page).getByRole('button', { name: /^Launch work copy/ })).toBeVisible()
})

test('matches due dates and keeps new tasks on the page', async ({ page }) => {
  await openProjects(page)
  await page.getByRole('button', { name: 'New filter' }).click()
  const dialog = page.getByRole('dialog', { name: 'New filter' })
  await dialog.getByLabel('Name').fill('Inbox soon')
  await dialog.getByRole('group', { name: 'Projects' }).getByRole('button', { name: 'Inbox' }).click()
  await dialog.getByRole('group', { name: 'Due' }).getByRole('button', { name: 'Next 7 days' }).click()
  await dialog.getByRole('button', { name: 'Create filter' }).click()

  const list = page.getByRole('listbox', { name: 'Tasks' })
  await expect(list.getByRole('option', { name: /Book the dentist/ })).toBeVisible()
  await expect(list.getByRole('option', { name: /Renew passport/ })).toHaveCount(0)

  // Next 7 days starts new tasks due today, so they match.
  const input = page.getByRole('textbox', { name: 'New task due today', exact: true })
  await input.fill('Call the plumber')
  await input.press('Enter')
  await expect(list.getByRole('option', { name: /Call the plumber/ })).toBeVisible()
})
