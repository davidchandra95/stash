import { expect, test, type Page } from '@playwright/test'

test.use({ timezoneId: 'Asia/Jakarta' })

async function openNewTask(page: Page, text: string) {
  await page.clock.install({ time: new Date('2026-11-03T10:00:00+07:00') })
  await page.goto('/')
  await page
    .getByRole('button', { name: /^Projects/ })
    .first()
    .click()
  await page.getByRole('button', { name: /^Inbox/ }).click()
  await page.getByRole('textbox', { name: 'New task', exact: true }).fill(text)
  await page.keyboard.press('Enter')
}

test('a dated task reminds by default, and offsets can be added and removed', async ({ page }) => {
  await openNewTask(page, 'Call the bank tomorrow at 2pm')
  const row = page.locator('.task-row', { hasText: 'Call the bank' })
  await expect(row.getByRole('img', { name: 'Reminder set' })).toBeVisible()
  await row.getByText('Call the bank').click()

  const list = page.locator('.task-reminder-list')
  await expect(list.getByRole('listitem')).toHaveCount(1)
  await expect(list).toContainText('When it starts')
  await expect(list).toContainText('Nov 4, 14:00')

  await page.getByRole('combobox', { name: 'Add reminder' }).selectOption({ label: '15 minutes before' })
  await expect(list).toContainText('Nov 4, 13:45')
  await page.getByRole('button', { name: 'Remove reminder 15 minutes before' }).click()
  await page.getByRole('button', { name: 'Remove reminder When it starts' }).click()
  await expect(page.getByText('No reminders for this task.')).toBeVisible()
  await expect(row.getByRole('img', { name: 'Reminder set' })).toHaveCount(0)
})

test('explains that the preview cannot notify, in the task and in Settings', async ({ page }) => {
  await openNewTask(page, 'Pay rent tomorrow')
  await page.locator('.task-row', { hasText: 'Pay rent' }).getByText('Pay rent').click()
  await expect(page.locator('.task-reminder-list')).toContainText('On the day')
  await expect(page.locator('.reminder-permission')).toContainText('can’t send notifications')

  await page.getByRole('button', { name: /^Settings/ }).click()
  await page.getByRole('button', { name: 'Notifications' }).click()
  await expect(page.locator('.reminder-status')).toContainText('Not available')
})

test('an undated task explains how to get reminders', async ({ page }) => {
  await openNewTask(page, 'Someday idea')
  await page.locator('.task-row', { hasText: 'Someday idea' }).getByText('Someday idea').click()
  await expect(page.getByText('Set a due date or work time to get reminders.')).toBeVisible()
})

test('recent reminders marks new ones and opens the task', async ({ page }) => {
  await openNewTask(page, 'Call the bank tomorrow at 2pm')
  const bell = page.getByRole('button', { name: /^Recent reminders/ })
  await bell.click()
  await expect(page.locator('.recent-reminders')).not.toContainText('Call the bank')
  await page.keyboard.press('Escape')

  await page.clock.setFixedTime(new Date('2026-11-04T14:01:00+07:00'))
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByRole('button', { name: /^Recent reminders, \d+ new$/ })).toBeVisible()
  await bell.click()
  await page.locator('.recent-reminders').getByRole('button', { name: /Call the bank/ }).click()
  await expect(page.getByRole('textbox', { name: 'Task title' })).toHaveValue('Call the bank')
  await expect(page.getByRole('button', { name: 'Recent reminders', exact: true })).toBeVisible()
})
