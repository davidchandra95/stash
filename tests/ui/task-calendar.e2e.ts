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
  await expect(page.locator('.calendar-range')).toHaveText('Nov 2 – Nov 8')
  await page.getByRole('button', { name: 'Next period' }).click()
  await expect(page.locator('.calendar-range')).toHaveText('Nov 9 – Nov 15')
  await page.getByRole('button', { name: /^Inbox/ }).click()
  await page.getByRole('button', { name: 'Calendar', exact: true }).click()
  await expect(page.locator('.calendar-range')).toHaveText('Nov 9 – Nov 15')
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
  await draft.getByRole('button', { name: /Edit time/ }).click()
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
  await page.getByRole('dialog', { name: 'View options' }).getByRole('checkbox', { name: 'Show completed' }).uncheck()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'View options' })).toBeHidden()
  await expect(page.getByRole('button', { name: 'View options' })).toBeFocused()
  await expect(taskOpen(page, 'Morning call')).toHaveCount(0)
  await page.getByRole('navigation', { name: 'Task views' }).getByRole('button', { name: /^Today/ }).click()
  await expect(page.getByRole('option', { name: /Morning call/ })).toBeVisible()
})

test('drags a time range, moves and resizes it, and undoes a confirmed change', async ({
  page,
}) => {
  await openCalendar(page)
  await dragPointer(page, slot(page, date, '10:00'), slot(page, date, '11:00'))
  const draft = page.getByRole('dialog', { name: 'New calendar task' })
  await expect(draft).toContainText('10:00–11:15')
  await draft.getByRole('button', { name: /Edit time/ }).click()
  await expect(draft.getByRole('combobox', { name: 'Schedule', exact: true })).toHaveValue('range')
  await expect(draft.getByLabel('Start time')).toHaveValue('10:00')
  await expect(draft.getByLabel('End time')).toHaveValue('11:15')
  await submitDraft(page, 'Deep work')
  const item = page.locator('.calendar-item').filter({ has: taskOpen(page, 'Deep work') })
  await item.dragTo(slot(page, '2026-11-04', '09:00'), {
    sourcePosition: { x: 30, y: 10 },
    targetPosition: { x: 15, y: 10 },
  })
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
  await expect(draft).toContainText('Nov 3 – Nov 5')
  await submitDraft(page, 'Offsite')
  // One continuous bar across the three days.
  await expect(taskOpen(page, 'Offsite')).toHaveCount(1)
  await expect(page.locator('.calendar-item[data-calendar-first="2026-11-03"][data-calendar-last="2026-11-05"]')).toBeVisible()
  await taskOpen(page, 'Offsite').first().click()
  await page.locator('#task-dueDate').click()
  await page.getByRole('button', { name: /November 8, 2026/ }).click()
  await expect(page.getByLabel('Due day follows schedule')).not.toBeChecked()
  await page.getByRole('button', { name: 'Close task details' }).click()
  const item = page
    .locator('.calendar-all-day .calendar-item[data-marker="false"]')
    .filter({ has: page.getByRole('button', { name: /^Open Offsite/ }) })
  // Grabbed on its first day and dropped on the next, it moves by one day.
  const box = (await item.boundingBox())!
  const target = (await allDay(page, '2026-11-04').boundingBox())!
  await page.mouse.move(box.x + 40, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(target.x + target.width / 2, box.y + box.height / 2, { steps: 8 })
  await page.mouse.up()
  await expect(
    page
      .locator(
        '.calendar-all-day .calendar-item[data-marker="true"][data-calendar-first="2026-11-08"]',
      )
      .filter({ hasText: 'Offsite' }),
  ).toBeVisible()
  await expect(
    page.locator('.calendar-item[data-calendar-first="2026-11-04"][data-calendar-last="2026-11-06"]'),
  ).toBeVisible()
})

test('a click takes the start of the half-hour cell', async ({ page }) => {
  await openCalendar(page)
  await slot(page, date, '14:00').click({ position: { x: 15, y: 20 } })
  const draft = page.getByRole('dialog', { name: 'New calendar task' })
  await expect(draft).toContainText('14:00')
})

test('moving a block keeps the point it was grabbed by', async ({ page }) => {
  await openCalendar(page)
  await dragPointer(page, slot(page, date, '10:00'), slot(page, date, '11:30'))
  await submitDraft(page, 'Deep work')
  const item = page.locator('.calendar-item').filter({ has: taskOpen(page, 'Deep work') })
  const box = (await item.boundingBox())!
  const column = (day: string) => page.locator(`.calendar-day-column[data-calendar-day="${day}"]`)
  // Grabbed 70px down and moved to the next day at the same height: only the day changes.
  await item.dragTo(column('2026-11-04'), {
    sourcePosition: { x: 40, y: 70 },
    targetPosition: {
      x: 40,
      y: box.y + 70 - (await column('2026-11-04').boundingBox())!.y,
    },
  })
  const moved = column('2026-11-04').getByRole('button', { name: /^Open Deep work, / })
  await expect(moved).toHaveAttribute('aria-label', /10:00 to 11:45/)
  // Moved down one hour from the same grab point, it lands one hour later.
  const nextBox = (await item.boundingBox())!
  await item.dragTo(column('2026-11-04'), {
    sourcePosition: { x: 40, y: 70 },
    targetPosition: {
      x: 40,
      y: nextBox.y + 70 + 56 - (await column('2026-11-04').boundingBox())!.y,
    },
  })
  await expect(moved).toHaveAttribute('aria-label', /11:00 to 12:45/)
})

test('a deadline chip dropped on the grid time-blocks the task and keeps the deadline', async ({
  page,
}) => {
  await openCalendar(page)
  const chip = page
    .locator('.calendar-all-day .calendar-item[data-calendar-first="2026-11-04"]')
    .filter({ has: taskOpen(page, 'Book the dentist') })
  await chip.dragTo(slot(page, '2026-11-05', '16:00'), { targetPosition: { x: 15, y: 4 } })
  await expect(
    page
      .locator('.calendar-day-column[data-calendar-day="2026-11-05"]')
      .getByRole('button', { name: /^Open Book the dentist, 16:00/ }),
  ).toBeVisible()
  await expect(chip).toBeVisible()
  await expect(chip.getByRole('button', { name: /^Open Book the dentist, Due 2026-11-04/ })).toBeVisible()
  // With a work time set, the same chip moves only the deadline, on the grid or the all-day row.
  await chip.dragTo(slot(page, '2026-11-06', '09:00'), { targetPosition: { x: 15, y: 4 } })
  await expect(
    page
      .locator('.calendar-all-day .calendar-item[data-calendar-first="2026-11-06"]')
      .getByRole('button', { name: /^Open Book the dentist, Due 2026-11-06/ }),
  ).toBeVisible()
  await expect(
    page
      .locator('.calendar-day-column[data-calendar-day="2026-11-05"]')
      .getByRole('button', { name: /^Open Book the dentist, 16:00/ }),
  ).toBeVisible()
})

test('Arrange lists dated tasks with no work time and schedules them by drag', async ({ page }) => {
  await openCalendar(page)
  await page.getByRole('button', { name: 'Arrange tasks' }).click()
  const row = page.locator('.calendar-arrange-task').filter({ hasText: 'Book the dentist' })
  await expect(row).toContainText('Due Nov 4')
  await row.dragTo(slot(page, '2026-11-05', '11:00'), { targetPosition: { x: 15, y: 4 } })
  await expect(row).toHaveCount(0)
  await taskOpen(page, 'Book the dentist').first().click()
  await expect(page.locator('#task-dueDate')).toHaveAttribute('aria-label', /Nov 4/)
})

test('shows where a drag will land, resizes with a minimum and keeps multi-day work all-day', async ({
  page,
}) => {
  await openCalendar(page)
  const ghost = page.locator('.calendar-ghost')
  // Drag-create draws a band with its time; Escape removes it and saves nothing.
  const from = (await slot(page, date, '10:00').boundingBox())!
  await page.mouse.move(from.x + 20, from.y + 4)
  await page.mouse.down()
  await page.mouse.move(from.x + 20, from.y + 60, { steps: 6 })
  await expect(ghost).toHaveText('10:00–11:15')
  await page.keyboard.press('Escape')
  await expect(ghost).toHaveCount(0)
  await page.mouse.up()
  await expect(page.getByRole('dialog', { name: 'New calendar task' })).toHaveCount(0)
  await dragPointer(page, slot(page, date, '10:00'), slot(page, date, '11:00'))
  await submitDraft(page, 'Deep work')
  // Resizing past the start stops at the minimum length instead of failing.
  const item = page.locator('.calendar-item').filter({ has: taskOpen(page, 'Deep work') })
  const handle = (await item.locator('.calendar-resize.is-end').boundingBox())!
  await page.mouse.move(handle.x + 20, handle.y + 2)
  await page.mouse.down()
  await page.mouse.move(handle.x + 20, handle.y - 200, { steps: 6 })
  await expect(ghost).toHaveText('10:00–10:15')
  await expect(item).toHaveClass(/is-dragging/)
  await page.mouse.up()
  await expect(taskOpen(page, 'Deep work')).toHaveAttribute('aria-label', /10:00 to 10:15/)
  await expect(page.getByRole('alert')).toHaveCount(0)
  // A several-day task dropped on the grid moves by days and stays all-day.
  await dragPointer(page, allDay(page, '2026-11-05'), allDay(page, '2026-11-06'))
  await submitDraft(page, 'Offsite')
  const bar = page.locator('.calendar-all-day .calendar-item').filter({ hasText: 'Offsite' })
  const barBox = (await bar.boundingBox())!
  const target = (await slot(page, '2026-11-07', '09:00').boundingBox())!
  await page.mouse.move(barBox.x + 40, barBox.y + barBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(target.x + 20, target.y + 4, { steps: 8 })
  await page.mouse.up()
  await expect(
    page.locator('.calendar-item[data-calendar-first="2026-11-07"][data-calendar-last="2026-11-08"]'),
  ).toBeVisible()
})

test('a time point stays inside its half-hour cell and shows only title and start time', async ({
  page,
}) => {
  await openCalendar(page)
  const cell = slot(page, '2026-11-04', '09:30')
  await cell.click({ position: { x: 20, y: 6 } })
  await submitDraft(page, 'Short block')
  const block = page.locator('.calendar-item').filter({ has: taskOpen(page, 'Short block') })
  const [cellBox, blockBox] = await Promise.all([cell.boundingBox(), block.boundingBox()])
  expect(blockBox!.y + blockBox!.height).toBeLessThanOrEqual(cellBox!.y + cellBox!.height)
  await expect(block.locator('small')).toHaveText('09:30')
  await block.hover()
  const fills = await block.evaluate((el) =>
    ['.calendar-item-open', '.calendar-complete'].map(
      (part) => getComputedStyle(el.querySelector(part)!).backgroundColor,
    ),
  )
  expect(fills).toEqual(['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)'])
})

test('the draft window is centred, keeps a typed title and creates on Enter', async ({
  page,
}) => {
  await openCalendar(page)
  await slot(page, '2026-11-05', '14:00').click({ position: { x: 15, y: 4 } })
  const draft = page.getByRole('dialog', { name: 'New calendar task' })
  await expect(page.locator('.calendar-ghost')).toHaveText('14:00')
  const box = (await draft.boundingBox())!
  const viewport = page.viewportSize()!
  expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThan(2)
  expect(Math.abs(box.y + box.height / 2 - viewport.height / 2)).toBeLessThan(2)
  const title = draft.getByRole('textbox', { name: 'Calendar task title' })
  await expect(title).toBeFocused()
  await title.fill('Keep me')
  await slot(page, '2026-11-06', '09:00').click({ position: { x: 15, y: 4 } })
  await expect(draft).toBeVisible()
  await expect(title).toHaveValue('Keep me')
  await expect(draft).toContainText('14:00')
  await title.press('Enter')
  await expect(draft).toBeHidden()
  await expect(taskOpen(page, 'Keep me')).toHaveAttribute('aria-label', /14:00/)
  await expect(page.locator('.calendar-ghost')).toHaveCount(0)
  // Clicking elsewhere with nothing typed moves the draft.
  await slot(page, '2026-11-05', '09:00').click({ position: { x: 15, y: 4 } })
  await slot(page, '2026-11-06', '09:00').click({ position: { x: 15, y: 4 } })
  await expect(page.locator('.calendar-ghost')).toHaveCount(1)
  await expect(page.locator('[data-calendar-day="2026-11-06"] .calendar-ghost')).toHaveCount(1)
})

test('schedule edits save themselves and invalid ones wait', async ({ page }) => {
  await openCalendar(page)
  await slot(page, date, '14:00').click({ position: { x: 15, y: 4 } })
  await submitDraft(page, 'Autosaved')
  await taskOpen(page, 'Autosaved').click()
  const detail = page.locator('[data-pane="task"]')
  await expect(detail.getByRole('button', { name: 'Apply schedule' })).toHaveCount(0)
  await detail.getByLabel('Start time').fill('15:30')
  await expect(taskOpen(page, 'Autosaved')).toHaveAttribute('aria-label', /15:30/)
  await detail.getByRole('combobox', { name: 'Schedule', exact: true }).selectOption('range')
  await expect(detail.getByLabel('End time')).toHaveValue('16:30')
  await expect(taskOpen(page, 'Autosaved')).toHaveAttribute('aria-label', /15:30 to 16:30/)
  await detail.getByLabel('End time').fill('12:00')
  await expect(detail.getByRole('alert')).toBeVisible()
  await expect(taskOpen(page, 'Autosaved')).toHaveAttribute('aria-label', /15:30 to 16:30/)
  await detail.getByLabel('End time').fill('17:00')
  await expect(detail.getByRole('alert')).toHaveCount(0)
  await expect(taskOpen(page, 'Autosaved')).toHaveAttribute('aria-label', /15:30 to 17:00/)
})

test('the task detail panel resizes by drag and keyboard and keeps its width', async ({ page }) => {
  await openCalendar(page)
  await slot(page, date, '14:00').click({ position: { x: 15, y: 4 } })
  await submitDraft(page, 'Wide')
  await taskOpen(page, 'Wide').click()
  const detail = page.locator('[data-pane="task"]')
  const divider = page.getByRole('separator', { name: 'Resize task details' })
  const main = page.locator('.project-main')
  const widthOf = async (target: Locator) => Math.round((await target.boundingBox())!.width)
  await expect(divider).toHaveAttribute('aria-valuenow', '320')
  expect(await widthOf(detail)).toBe(320)

  const box = (await divider.boundingBox())!
  const y = box.y + box.height / 2
  const before = await widthOf(main)
  await page.mouse.move(box.x + box.width / 2, y)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 - 100, y, { steps: 4 })
  await page.mouse.up()
  expect(await widthOf(detail)).toBe(420)
  expect(await widthOf(main)).toBe(before - 100)
  await expect(detail.locator('.task-detail-body')).toBeVisible()

  await page.mouse.move(box.x + box.width / 2 - 100, y)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 20, y, { steps: 2 })
  await page.keyboard.press('Escape')
  await page.mouse.up()
  expect(await widthOf(detail)).toBe(420)

  await divider.focus()
  await page.keyboard.press('ArrowLeft')
  await expect(divider).toHaveAttribute('aria-valuenow', '428')
  await page.keyboard.press('Shift+ArrowRight')
  await expect(divider).toHaveAttribute('aria-valuenow', '396')

  // Closing and reopening the panel restores the saved width.
  await detail.getByRole('button', { name: /close/i }).click()
  await expect(detail).toHaveCount(0)
  await taskOpen(page, 'Wide').click()
  expect(await widthOf(detail)).toBe(396)
})

test('navigates by keys, header, date popover and remembers the view', async ({ page }) => {
  await openCalendar(page)
  const range = page.getByRole('button', { name: 'Jump to a date' })
  const columns = page.locator('.calendar-day-column')
  await expect(range).toHaveText('Nov 2 – Nov 8')
  // Letters work from the sidebar too; arrows wait until focus leaves it.
  await page.keyboard.press('ArrowRight')
  await expect(range).toHaveText('Nov 2 – Nov 8')
  await page.locator('.calendar-toolbar h1').click()
  await page.keyboard.press('ArrowRight')
  await expect(range).toHaveText('Nov 9 – Nov 15')
  await page.keyboard.press('t')
  await expect(range).toHaveText('Nov 2 – Nov 8')
  await page.keyboard.press('1')
  await expect(columns).toHaveCount(1)
  await page.keyboard.press('2')
  await expect(columns).toHaveCount(7)
  await page.keyboard.press('y')
  await expect(range).toHaveText('2026')
  await page.keyboard.press('w')
  await expect(columns).toHaveCount(7)
  await page.getByRole('button', { name: 'Show 2026-11-05', exact: true }).click()
  await expect(columns).toHaveCount(1)
  await expect(range).toHaveText('Nov 5')
  await page.reload()
  await page
    .getByRole('button', { name: /^Projects/ })
    .first()
    .click()
  await page.getByRole('button', { name: 'Calendar', exact: true }).click()
  await expect(columns).toHaveCount(1)
  await page.keyboard.press('w')
  await range.click()
  await page.locator('.date-picker').getByRole('button', { name: /November 20/ }).click()
  await expect(range).toHaveText('Nov 16 – Nov 22')
  await page.keyboard.press('n')
  await expect(page.getByRole('dialog', { name: 'New calendar task' })).toBeVisible()
  // Typing in the draft isn't a shortcut.
  await page.keyboard.type('w3')
  await expect(page.getByRole('textbox', { name: 'Calendar task title' })).toHaveValue('w3')
  await expect(columns).toHaveCount(7)
})

test('offers every time range from the view menu, and arrows move by the range', async ({ page }) => {
  await openCalendar(page)
  const range = page.getByRole('button', { name: 'Jump to a date' })
  const trigger = page.getByRole('button', { name: /^Calendar view:/ })
  const choose = async (name: string) => {
    await trigger.click()
    await page.getByRole('menuitemradio', { name: new RegExp(`^${name}`) }).click()
  }
  await trigger.click()
  for (const [name, keys] of [
    ['Day', 'D/1'],
    ['Week', 'W/2'],
    ['Month', 'M/3'],
    ['Year', 'Y/4'],
    ['Agenda', 'A/5'],
  ])
    await expect(page.getByRole('menuitemradio', { name: new RegExp(`^${name}`) })).toContainText(keys)
  await expect(page.getByRole('menuitemradio', { name: /Multi-Day/ })).toContainText('5 Days')
  const weeks = page.getByRole('menuitemradio', { name: /Multi-Week/ })
  await expect(weeks).toContainText('2 Weeks')
  await weeks.hover()
  await expect(page.getByRole('button', { name: 'Fewer weeks' })).toBeDisabled()
  await page.getByRole('button', { name: 'More weeks' }).click()
  // The menu stays open while the count changes.
  await expect(weeks).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(trigger).toHaveText('3 Weeks')
  await expect(page.locator('.calendar-board-week')).toHaveCount(3)
  await expect(range).toHaveText('Nov 2 – Nov 22')
  await page.getByRole('button', { name: 'Next period' }).click()
  await expect(range).toHaveText('Nov 23 – Dec 13')
  await page.getByRole('button', { name: 'Today', exact: true }).click()

  await choose('Month')
  await expect(range).toHaveText('November 2026')
  await expect(page.locator('.calendar-board-week')).toHaveCount(6)
  await page.getByRole('button', { name: 'Next period' }).click()
  await expect(range).toHaveText('December 2026')
  await page.getByRole('button', { name: 'Previous period' }).click()
  await page.getByRole('button', { name: 'Show 2026-11-05', exact: true }).click()
  await expect(trigger).toHaveText('Day')
  await expect(range).toHaveText('Nov 5')

  await choose('Year')
  await expect(range).toHaveText('2026')
  await expect(page.locator('.calendar-year-month')).toHaveCount(12)
  // Four across and three down, with no scrolling.
  const tops = await page.locator('.calendar-year-month').evaluateAll((months) =>
    months.map((month) => Math.round(month.getBoundingClientRect().top)),
  )
  expect(new Set(tops).size).toBe(3)
  expect(tops.filter((top) => top === tops[0])).toHaveLength(4)
  const fits = await page
    .locator('.calendar-scroll')
    .evaluate((scroll) => scroll.scrollHeight <= scroll.clientHeight)
  expect(fits).toBe(true)
  await page.getByRole('button', { name: 'Next period' }).click()
  await expect(range).toHaveText('2027')
  await page.getByRole('button', { name: 'Today', exact: true }).click()
  await page.getByRole('button', { name: 'March', exact: true }).click()
  await expect(range).toHaveText('March 2026')

  await page.keyboard.press('t')
  await choose('Agenda')
  await expect(range).toHaveText('Nov 3 – Dec 2')
  await trigger.click()
  await page.getByRole('menuitemradio', { name: /Multi-Day/ }).hover()
  await page.getByRole('button', { name: 'Fewer days' }).click()
  await page.keyboard.press('Escape')
  await expect(trigger).toHaveText('4 Days')
  await expect(page.locator('.calendar-day-column')).toHaveCount(4)
  await page.reload()
  await page
    .getByRole('button', { name: /^Projects/ })
    .first()
    .click()
  await page.getByRole('button', { name: 'Calendar', exact: true }).click()
  await expect(trigger).toHaveText('4 Days')
})

test('a month keeps tasks in reach: create, move without changing the time, and agenda', async ({
  page,
}) => {
  await openCalendar(page)
  await slot(page, date, '09:00').click()
  await submitDraft(page, 'Timed plan')
  await expect(taskOpen(page, 'Timed plan')).toHaveAttribute('aria-label', /09:00/)
  await page.keyboard.press('m')
  const chip = page.locator('.calendar-board-week .calendar-item', { hasText: 'Timed plan' })
  await expect(chip).toContainText('09:00')
  // Checkbox, time and title read from the left, with no gap pushing them apart.
  const [check, open, time] = await Promise.all(
    ['.calendar-complete', '.calendar-item-open', 'small'].map((part) =>
      chip.locator(part).boundingBox(),
    ),
  )
  expect(open!.x).toBeLessThanOrEqual(check!.x + check!.width + 1)
  expect(time!.x - open!.x).toBeLessThan(10)
  await expect(chip).toHaveAttribute('data-calendar-first', date)
  await chip.dragTo(page.locator('[data-calendar-day="2026-11-12"]'), {
    targetPosition: { x: 60, y: 70 },
  })
  await expect(chip).toHaveAttribute('data-calendar-first', '2026-11-12')
  await expect(taskOpen(page, 'Timed plan')).toHaveAttribute('aria-label', /09:00/)
  await page.getByRole('button', { name: 'Add all-day task on 2026-11-18' }).click()
  await submitDraft(page, 'Month plan')
  await expect(page.locator('.calendar-board-week .calendar-item', { hasText: 'Month plan' })).toHaveAttribute(
    'data-calendar-first',
    '2026-11-18',
  )
  await page.keyboard.press('a')
  await expect(page.locator('.calendar-agenda-row', { hasText: 'Timed plan' })).toContainText('09:00')
  await expect(page.locator('.calendar-agenda-row', { hasText: 'Month plan' })).toContainText('All day')
  await page.keyboard.press('y')
  await expect(page.getByRole('button', { name: 'Show 2026-11-18, 1 task' })).toBeVisible()
})

test('overlapping blocks cascade, stay reachable and leave room to click the cell', async ({
  page,
}) => {
  await openCalendar(page)
  for (const title of ['First', 'Second', 'Third']) {
    const cell = slot(page, '2026-11-05', '14:00')
    const { width } = (await cell.boundingBox())!
    await cell.click({ position: { x: width - 3, y: 4 } })
    await submitDraft(page, title)
  }
  await expect(page.getByText('Overlapping tasks')).toHaveCount(0)
  const column = (await page.locator('[data-calendar-day="2026-11-05"].calendar-day-column').boundingBox())!
  for (const title of ['First', 'Second', 'Third']) {
    const open = taskOpen(page, title)
    await open.hover({ position: { x: 4, y: 4 } })
    const block = page.locator('.calendar-item').filter({ has: open })
    await expect(block).toHaveCSS('z-index', '3')
    // Three short blocks in a week column give all their room to the title.
    await expect(block.locator('.calendar-complete')).toBeHidden()
    await expect(block.locator('small')).toBeHidden()
    const box = (await block.boundingBox())!
    expect(box.x + box.width).toBeLessThanOrEqual(column.x + column.width - 5)
  }
})

test('colors blocks by project, fades past plans and marks late deadlines', async ({ page }) => {
  await openCalendar(page)
  await dragPointer(page, slot(page, '2026-11-02', '10:00'), slot(page, '2026-11-02', '11:00'))
  await submitDraft(page, 'Yesterday plan')
  const past = page.locator('.calendar-item').filter({ has: taskOpen(page, 'Yesterday plan') })
  await expect(past).toHaveClass(/is-past/)
  await expect(past).not.toHaveClass(/is-late/)
  await expect(past.locator('small')).toHaveText('10:00')
  await expect(past).not.toContainText('Inbox')
  const homepage = page.locator('.calendar-item').filter({ hasText: 'Write homepage copy' })
  expect(await homepage.evaluate((el) => el.style.getPropertyValue('--item-color'))).not.toBe('')
  await page.getByRole('button', { name: 'Previous period' }).click()
  const late = page.locator('.calendar-item.is-late').filter({ hasText: 'Migrate blog posts' })
  await expect(late).toContainText('Overdue')
})

test('schedules an Inbox task by keyboard from Arrange tasks', async ({ page }) => {
  await openCalendar(page)
  await page.getByRole('button', { name: 'Arrange tasks' }).click()
  await page.getByRole('button', { name: 'Schedule Renew passport' }).press('Enter')
  await page.getByRole('combobox', { name: 'Schedule', exact: true }).selectOption('point')
  await page.getByLabel('Start time').fill('14:07')
  await page.getByLabel('Start time').press('Enter')
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
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(taskOpen(page, 'Mobile plan')).toHaveAttribute('aria-label', /09:27/)
})
