import { expect, test, type Locator, type Page } from '@playwright/test'

test.use({ timezoneId: 'Asia/Jakarta' })
const date = '2026-11-03'
const taskOpen = (page: Page, title: string) =>
  page.getByRole('button', { name: new RegExp(`^Open ${title},`) })
const slot = (page: Page, day: string, time: string) =>
  page.getByRole('button', { name: `Add task on ${day} at ${time}`, exact: true })
const allDay = (page: Page, day: string) =>
  page.getByRole('button', { name: `Add all-day task on ${day}`, exact: true })

async function openCalendar(page: Page) {
  await page.clock.install({ time: new Date(`${date}T10:00:00+07:00`) })
  await page.goto('/')
  await page
    .getByRole('button', { name: /^Projects/ })
    .first()
    .click()
  await page.getByRole('button', { name: 'Calendar', exact: true }).click()
}
async function submitDraft(page: Page, title: string) {
  const draft = page.getByRole('dialog', { name: 'New calendar task' })
  await draft.getByRole('textbox', { name: 'Calendar task title' }).fill(title)
  await draft.getByRole('button', { name: 'Add task', exact: true }).click()
  await expect(draft).toBeHidden()
}
async function dragPointer(page: Page, from: Locator, to: Locator) {
  await from.scrollIntoViewIfNeeded()
  await to.scrollIntoViewIfNeeded()
  const a = (await from.boundingBox())!,
    b = (await to.boundingBox())!
  await page.mouse.move(a.x + a.width / 2, a.y + Math.min(4, a.height / 2))
  await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2, b.y + Math.min(4, b.height / 2), { steps: 8 })
  await page.mouse.up()
}

test('navigates weeks, restores the viewed date and opens the same task as its project', async ({
  page,
}) => {
  await openCalendar(page)
  await expect(page.locator('.calendar-range')).toHaveText('Nov 2 - Nov 8')
  await page.getByRole('button', { name: 'Next period' }).click()
  await expect(page.locator('.calendar-range')).toHaveText('Nov 9 - Nov 15')
  await page.getByRole('button', { name: /^Inbox/ }).click()
  await page.getByRole('button', { name: 'Calendar', exact: true }).click()
  await expect(page.locator('.calendar-range')).toHaveText('Nov 9 - Nov 15')
  await page.getByRole('button', { name: 'Today', exact: true }).click()
  await taskOpen(page, 'Book the dentist').click()
  await expect(page.getByRole('textbox', { name: 'Task title' })).toHaveValue('Book the dentist')
  await expect(page.locator('#task-dueDate')).toHaveAttribute('aria-label', /Nov 4/)
})

test('click creates a time point, Escape cancels a draft, and completion updates the same record', async ({
  page,
}) => {
  await openCalendar(page)
  await slot(page, date, '10:00').click({ position: { x: 15, y: 4 } })
  const draft = page.getByRole('dialog', { name: 'New calendar task' })
  await expect(draft.getByRole('combobox', { name: 'Schedule', exact: true })).toHaveValue('point')
  await expect(draft.getByLabel('Start time')).toHaveValue('10:00')
  await expect(draft.getByLabel('End time')).toHaveCount(0)
  await draft.getByRole('textbox', { name: 'Calendar task title' }).fill('Cancelled draft')
  await page.keyboard.press('Escape')
  await expect(draft).toBeHidden()
  await expect(taskOpen(page, 'Cancelled draft')).toHaveCount(0)
  await slot(page, date, '10:00').click({ position: { x: 15, y: 4 } })
  await submitDraft(page, 'Morning call')
  await expect(taskOpen(page, 'Morning call')).toBeVisible()
  await page.getByRole('checkbox', { name: 'Complete Morning call', exact: true }).click()
  await expect(
    page.getByRole('checkbox', { name: 'Reopen Morning call', exact: true }),
  ).toBeChecked()
  await page.getByRole('button', { name: 'View options' }).click()
  await page.getByRole('checkbox', { name: 'Show completed' }).uncheck()
  await expect(taskOpen(page, 'Morning call')).toHaveCount(0)
  await page.getByRole('button', { name: /^Due today/ }).click()
  await expect(page.getByRole('option', { name: /Morning call/ })).toBeVisible()
})

test('drags a time range, moves and resizes it, and undoes a confirmed change', async ({
  page,
}) => {
  await openCalendar(page)
  await dragPointer(page, slot(page, date, '10:00'), slot(page, date, '11:00'))
  const draft = page.getByRole('dialog', { name: 'New calendar task' })
  await expect(draft.getByRole('combobox', { name: 'Schedule', exact: true })).toHaveValue('range')
  await expect(draft.getByLabel('Start time')).toHaveValue('10:00')
  await expect(draft.getByLabel('End time')).toHaveValue('11:15')
  await submitDraft(page, 'Deep work')
  const item = page.locator('.calendar-item').filter({ has: taskOpen(page, 'Deep work') })
  await item.dragTo(slot(page, '2026-11-04', '09:00'), { targetPosition: { x: 15, y: 4 } })
  await expect(
    page
      .locator('.calendar-day-column[data-calendar-day="2026-11-04"]')
      .getByRole('button', { name: /^Open Deep work, 09:00 to 10:15/ }),
  ).toBeVisible()
  await dragPointer(
    page,
    item.locator('.calendar-resize.is-end'),
    slot(page, '2026-11-04', '11:00'),
  )
  await expect(taskOpen(page, 'Deep work')).toHaveAttribute('aria-label', /09:00 to 11:00/)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(taskOpen(page, 'Deep work')).toHaveAttribute('aria-label', /09:00 to 10:15/)
})

test('creates multi-day all-day work and keeps an independent due date on moves', async ({
  page,
}) => {
  await openCalendar(page)
  await dragPointer(page, allDay(page, date), allDay(page, '2026-11-05'))
  const draft = page.getByRole('dialog', { name: 'New calendar task' })
  await expect(draft.getByLabel('Last day (included)')).toHaveValue('2026-11-05')
  await submitDraft(page, 'Offsite')
  await expect(taskOpen(page, 'Offsite')).toHaveCount(3)
  await taskOpen(page, 'Offsite').first().click()
  await page.locator('#task-dueDate').click()
  await page.getByRole('button', { name: /November 8, 2026/ }).click()
  await expect(page.getByLabel('Due day follows schedule')).not.toBeChecked()
  await page.getByRole('button', { name: 'Close task details' }).click()
  const item = page
    .locator('.calendar-all-day-cell[data-calendar-day="2026-11-03"] .calendar-item')
    .filter({ has: taskOpen(page, 'Offsite') })
  await item.dragTo(allDay(page, '2026-11-04'))
  await expect(
    page
      .locator('.calendar-all-day-cell[data-calendar-day="2026-11-08"]')
      .getByRole('button', { name: /^Open Offsite, Due 2026-11-08/ }),
  ).toBeVisible()
  await expect(
    page
      .locator('.calendar-all-day-cell[data-calendar-day="2026-11-06"]')
      .getByRole('button', { name: /^Open Offsite/ }),
  ).toBeVisible()
})

test('schedules an Inbox task by keyboard from Arrange tasks', async ({ page }) => {
  await openCalendar(page)
  await page.getByRole('button', { name: 'Arrange tasks' }).click()
  await page.getByRole('button', { name: 'Schedule Renew passport' }).press('Enter')
  await page.getByRole('combobox', { name: 'Schedule', exact: true }).selectOption('point')
  await page.getByLabel('Scheduled day').fill(date)
  await page.getByLabel('Start time').fill('14:07')
  await page.getByRole('button', { name: 'Apply schedule' }).press('Enter')
  await expect(page.getByLabel('Due day follows schedule')).toBeChecked()
  await expect(taskOpen(page, 'Renew passport')).toHaveAttribute('aria-label', /14:07/)
  await expect(page.getByRole('button', { name: 'Schedule Renew passport' })).toHaveCount(0)
})

test('smart input produces a real point and a range that crosses midnight', async ({ page }) => {
  await openCalendar(page)
  await page.getByRole('button', { name: /^Inbox/ }).click()
  const input = page.getByRole('textbox', { name: 'New task', exact: true })
  await input.fill('throw trash can @2pm')
  await expect(page.locator('.smart-task-match')).toHaveText('@2pm')
  await input.press('Enter')
  await expect(input).toHaveValue('')
  await input.fill('Late support 11pm to 1am')
  await expect(page.locator('.smart-task-match')).toHaveText('11pm to 1am')
  await input.press('Enter')
  await expect(input).toHaveValue('')
  await page.getByRole('button', { name: 'Calendar', exact: true }).click()
  await expect(taskOpen(page, 'throw trash can')).toHaveAttribute('aria-label', /14:00/)
  await expect(taskOpen(page, 'Late support')).toHaveCount(2)
  await taskOpen(page, 'Late support').first().click()
  await expect(page.locator('#task-dueDate')).toHaveAttribute('aria-label', /Nov 4/)
})

test('mobile opens Projects, switches day views and edits schedule with touch controls', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.clock.install({ time: new Date(`${date}T10:00:00+07:00`) })
  await page.goto('/?mobile=1')
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.getByRole('navigation', { name: 'Projects', exact: true }).getByRole('button', { name: 'Calendar', exact: true }).click()
  await expect(page.getByLabel('Calendar view')).toHaveValue('day')
  await page.getByLabel('Calendar view').selectOption('three')
  await expect(page.locator('.calendar-day-column')).toHaveCount(3)
  await allDay(page, date).click()
  await submitDraft(page, 'Mobile plan')
  await taskOpen(page, 'Mobile plan').click()
  const detail = page.locator('.mobile-task-page')
  await expect(detail.getByRole('button', { name: /Due.*Nov 3/ })).toBeVisible()
  await detail.getByRole('combobox', { name: 'Schedule', exact: true }).selectOption('point')
  await detail.getByLabel('Start time').fill('09:27')
  await detail.getByRole('button', { name: 'Apply schedule' }).click()
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(taskOpen(page, 'Mobile plan')).toHaveAttribute('aria-label', /09:27/)
})
