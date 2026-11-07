import { expect, test, type Page } from '@playwright/test'

test.use({ timezoneId: 'Asia/Jakarta' })

async function openHabits(page: Page) {
  // Saturday, November 7.
  await page.clock.install({ time: new Date('2026-11-07T10:00:00+07:00') })
  await page.goto('/')
  await page
    .getByRole('button', { name: /^Projects/ })
    .first()
    .click()
  await page.getByRole('button', { name: /^Habits/ }).click()
}

test('checks a day off with a note and lists it in the habit notes', async ({ page }) => {
  await openHabits(page)
  await expect(page.getByRole('heading', { name: 'Habits' })).toBeVisible()
  // Morning walk isn't due on Saturdays, and weekly habits have no single due day.
  await expect(page.getByText('0 of 1 done today')).toBeVisible()
  await expect(page.getByRole('button', { name: /^Habits/ }).locator('.count')).toHaveText('1')
  const today = page.getByRole('button', { name: 'Read a book, Sat, Nov 7' })
  await expect(today).toHaveAttribute('aria-pressed', 'false')

  // One click checks it off and opens the note.
  await today.click()
  const popover = page.getByRole('dialog', { name: 'Read a book on Sat, Nov 7' })
  const note = popover.getByRole('textbox', { name: 'Check-in note' })
  await expect(note).toBeFocused()
  await note.fill('Read book ABC, chapter 6')
  await page.keyboard.press('Escape')
  await expect(popover).toHaveCount(0)
  const grid = page.locator('.habit-grid')
  const checked = grid.getByRole('button', { name: 'Read a book, Sat, Nov 7, done, has a note' })
  await expect(checked).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('1 of 1 done today')).toBeVisible()
  await expect(page.getByRole('button', { name: /^Habits/ }).locator('.count')).toHaveCount(0)

  // The habit's notes list it first, newest first.
  await page.locator('.habit-name', { hasText: 'Read a book' }).click()
  const detail = page.getByRole('complementary', { name: 'Habit details' })
  const notes = detail.locator('.habit-notes li')
  await expect(notes.first()).toContainText('Sat, Nov 7')
  await expect(notes.first()).toContainText('Read book ABC, chapter 6')
  await expect(detail.getByText('5 days', { exact: true }).first()).toBeVisible()

  // Clicking a done day edits its note or marks it not done; the note stays.
  await checked.click()
  await popover.getByRole('button', { name: 'Mark not done' }).click()
  await expect(grid.getByRole('button', { name: 'Read a book, Sat, Nov 7, has a note' })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  await expect(notes.first()).toContainText('not done')
})

test('creates, edits, archives and deletes a habit with undo', async ({ page }) => {
  await openHabits(page)
  await page.getByRole('button', { name: 'New habit' }).click()
  const dialog = page.getByRole('dialog', { name: 'New habit' })
  await dialog.getByRole('button', { name: 'Create habit' }).click()
  await expect(dialog.getByRole('alert')).toHaveText('Enter a habit name.')
  await dialog.getByLabel('Name').fill('Stretch')
  await dialog.getByRole('button', { name: 'Some days' }).click()
  // Weekdays start selected; Saturday is added.
  await dialog.getByRole('group', { name: 'Days' }).getByRole('button', { name: 'Sat' }).click()
  await dialog.getByRole('button', { name: 'Create habit' }).click()

  const detail = page.getByRole('complementary', { name: 'Habit details' })
  await expect(detail.getByRole('textbox', { name: 'Habit name' })).toHaveValue('Stretch')
  const row = page.locator('.habit-name', { hasText: 'Stretch' })
  await expect(row).toContainText('Mon, Tue, Wed, Thu, Fri, Sat')
  await expect(page.getByText('0 of 2 done today')).toBeVisible()

  // Weekly habits count check-ins this week instead.
  await detail.getByRole('button', { name: 'Weekly' }).click()
  await detail.getByRole('combobox', { name: 'Times a week' }).selectOption('2')
  await expect(row).toContainText('0/2 this week')

  await detail.getByRole('button', { name: 'Archive habit' }).click()
  await page.getByRole('button', { name: /Archived/ }).click()
  await expect(page.locator('.habit-grid.is-archived').getByRole('button', { name: 'Stretch, Sat, Nov 7' })).toBeDisabled()
  await detail.getByRole('button', { name: 'Restore habit' }).click()

  await detail.getByRole('button', { name: 'Delete habit' }).click()
  await expect(row).toHaveCount(0)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(row).toBeVisible()
})

test('Android checks off habits with notes and shows the habit page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.clock.install({ time: new Date('2026-11-07T10:00:00+07:00') })
  await page.goto('/?mobile=1')
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.getByRole('navigation', { name: 'Projects', exact: true }).getByRole('button', { name: 'Habits' }).click()
  await page.getByRole('button', { name: 'Morning walk, Fri, Nov 6, done' }).click()
  const note = page.getByRole('textbox', { name: 'Check-in note' })
  await note.fill('Around the lake')
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Morning walk, Fri, Nov 6, done, has a note' })).toBeVisible()

  await page.locator('.mobile-habit-name', { hasText: 'Morning walk' }).click()
  await expect(page.locator('.habit-notes')).toContainText('Around the lake')
  await page.getByRole('button', { name: 'Delete habit' }).click()
  await expect(page.locator('.mobile-habit-name', { hasText: 'Morning walk' })).toHaveCount(0)
})
