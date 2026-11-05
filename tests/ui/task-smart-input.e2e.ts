import { expect, test, type Page } from '@playwright/test'

test.use({ timezoneId: 'Asia/Jakarta' })

const storeModules = new WeakMap<Page, string>()
async function openInbox(page: Page) {
  await page.clock.install({ time: new Date('2026-11-03T10:00:00+07:00') })
  const storeModule = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/src/projects/store.ts',
  )
  await page.goto('/')
  storeModules.set(page, (await storeModule).url())
  await page
    .getByRole('button', { name: /^Projects/ })
    .first()
    .click()
  await page.getByRole('button', { name: /^Inbox/ }).click()
}
const input = (page: Page) => page.getByRole('textbox', { name: 'New task', exact: true })
async function saved(
  page: Page,
  title: string,
  dueDate: string | null,
  dueTime: string | null = null,
) {
  await expect
    .poll(() =>
      page.evaluate(
        async ({ title, dueDate, dueTime, url }) => {
          const { projectStore } = await import(/* @vite-ignore */ url)
          return projectStore
            .getSnapshot()
            .tasks.some(
              (task: {
                title: string
                dueDate: string | null
                dueTime: string | null
                dueLinked?: boolean
                schedule?: { kind: string; start: number; end?: number }
              }) =>
                task.title === title &&
                (dueTime
                  ? task.dueLinked &&
                    task.dueDate === null &&
                    task.dueTime === null &&
                    task.schedule?.kind === 'point' &&
                    task.schedule.end === undefined &&
                    task.schedule.start === Date.parse(`${dueDate}T${dueTime}:00+07:00`)
                  : task.dueDate === dueDate && task.dueTime === null && !task.schedule),
            )
        },
        { title, dueDate, dueTime, url: storeModules.get(page)! },
      ),
    )
    .toBe(true)
}

test('recognizes, edits, cancels and saves dates with keyboard and paste', async ({ page }) => {
  await openInbox(page)
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.evaluate(() => navigator.clipboard.writeText('Meet tomorrow at 9am'))
  await input(page).focus()
  await input(page).press('ControlOrMeta+V')
  await expect(page.locator('.smart-task-match')).toHaveText(['tomorrow', 'at 9am'])
  await expect(
    page.getByRole('button', { name: 'Schedule: Tomorrow, 09:00. Change date' }),
  ).toBeVisible()
  await input(page).press('Enter')
  await saved(page, 'Meet', '2026-11-04', '09:00')
  await expect(input(page)).toBeFocused()
  await expect(input(page)).toHaveValue('')

  await input(page).fill('Write tomorrow')
  await page.locator('.smart-task-match').click()
  await expect(input(page)).toHaveValue('Write tomorrow')
  await expect(page.locator('.smart-task-match')).toHaveCount(0)
  await input(page).evaluate((element: HTMLInputElement) => element.setSelectionRange(0, 0))
  await input(page).pressSequentially('Please ')
  await expect(page.locator('.smart-task-match')).toHaveCount(0)
  await input(page).press('Enter')
  await saved(page, 'Please Write tomorrow', null)

  await input(page).fill('Call tomorrow')
  await input(page).press('End')
  await input(page).press('Backspace')
  await expect(input(page)).toHaveValue('Call tomorrow')
  await expect(page.locator('.smart-task-match')).toHaveCount(0)
  await input(page).press('Backspace')
  await expect(input(page)).toHaveValue('Call tomorro')
  await input(page).press('Escape')
  await input(page).fill('Ship next Monday')
  await input(page).press('Enter')
  await saved(page, 'Ship', '2026-11-09')
})

test('manual dates, recognition controls, long drafts and composition are safe', async ({
  page,
}) => {
  await openInbox(page)
  await input(page).fill('Review tomorrow')
  await page.getByRole('button', { name: 'Due: Tomorrow. Change date' }).click()
  await page.getByRole('button', { name: 'Next month' }).click()
  await page.getByRole('button', { name: /December 10, 2026/ }).click()
  await page.keyboard.press('Escape')
  await expect(page.locator('.smart-task-match')).toHaveCount(0)
  await input(page).press('Enter')
  await saved(page, 'Review tomorrow', '2026-12-10')

  await input(page).fill('Keep tomorrow')
  await page.getByRole('button', { name: 'Due: Tomorrow. Change date' }).click()
  await page.getByLabel('Keep recognized words in title').check()
  await page.keyboard.press('Escape')
  await input(page).press('Enter')
  await saved(page, 'Keep tomorrow', '2026-11-04')

  await page.getByRole('button', { name: 'Due: No due date. Change date' }).click()
  await page.getByLabel('Recognize dates and times', { exact: true }).uncheck()
  await page.keyboard.press('Escape')
  await input(page).fill('Literal tomorrow')
  await expect(page.locator('.smart-task-match')).toHaveCount(0)
  await input(page).press('Enter')
  await saved(page, 'Literal tomorrow', null)

  await input(page).fill('IME task')
  await input(page).dispatchEvent('compositionstart')
  await input(page).press('Enter')
  await expect(input(page)).toHaveValue('IME task')
  await input(page).dispatchEvent('compositionend')
  await input(page).press('Enter')
  await saved(page, 'IME task', null)

  await page.getByRole('button', { name: /^Website relaunch/ }).click()
  await input(page).fill('Still literal tomorrow')
  await expect(page.locator('.smart-task-match')).toHaveCount(0)
  await page.getByRole('button', { name: 'Due: No due date. Change date' }).click()
  await expect(page.getByLabel('Keep recognized words in title')).toBeChecked()
  await page.getByLabel('Recognize dates and times', { exact: true }).check()
  await page.getByLabel('Keep recognized words in title').uncheck()
  await page.keyboard.press('Escape')
  await input(page).fill(`${'A long task title '.repeat(18)}tomorrow`)
  await input(page).press('ControlOrMeta+ArrowRight')
  await expect
    .poll(() => input(page).evaluate((element: HTMLInputElement) => element.scrollLeft))
    .toBeGreaterThan(0)
  const field = await page.locator('.smart-task-field').boundingBox()
  const mark = await page.locator('.smart-task-match').boundingBox()
  expect(mark!.x).toBeGreaterThanOrEqual(field!.x)
  expect(mark!.x + mark!.width).toBeLessThanOrEqual(field!.x + field!.width + 1)
  await page.locator('.smart-task-match').click()
  await expect(page.locator('.smart-task-match')).toHaveCount(0)
  await expect(input(page)).toHaveValue(`${'A long task title '.repeat(18)}tomorrow`)
})

test('unsupported repeats and date ranges keep the full title without scheduling', async ({
  page,
}) => {
  await openInbox(page)
  for (const title of [
    'Water plants every Monday and Friday',
    'Vacation Monday through Friday',
    'Remind me tomorrow at 9am',
    'Not tomorrow @2pm',
  ]) {
    await input(page).fill(title)
    await expect(page.locator('.smart-task-match')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Due: No due date. Change date' })).toBeVisible()
    await input(page).press('Enter')
    await saved(page, title, null)
  }
})

test('times preview, save, display and remain editable on tasks', async ({ page }) => {
  await openInbox(page)
  await input(page).fill('Throw trash @2pm')
  await expect(page.locator('.smart-task-match')).toHaveText('@2pm')
  await expect(
    page.getByRole('button', { name: 'Schedule: Today, 14:00. Change date' }),
  ).toBeVisible()
  await input(page).press('Enter')
  await saved(page, 'Throw trash', '2026-11-03', '14:00')
  const row = page.getByRole('option', { name: /Throw trash/ })
  await expect(row).toContainText('14:00')
  await row.click()
  await expect(page.getByLabel('Start time')).toHaveValue('14:00')
  await page.getByLabel('Start time').fill('17:45')
  await saved(page, 'Throw trash', '2026-11-03', '17:45')
  await expect(row).toContainText('17:45')
  await page.getByRole('combobox', { name: 'Schedule', exact: true }).selectOption('none')
  await saved(page, 'Throw trash', '2026-11-03')
  await expect(page.getByLabel('Start time')).toHaveCount(0)

  await input(page).fill('Early call @9am')
  await expect(
    page.getByRole('button', { name: 'Schedule: Today, 09:00. Change date' }),
  ).toBeVisible()
  await input(page).press('Enter')
  await saved(page, 'Early call', '2026-11-03', '09:00')
})

test('date and time recognition cancel separately and manual time overrides are saved', async ({
  page,
}) => {
  await openInbox(page)
  await input(page).fill('Call tomorrow @2pm')
  await page.locator('.smart-task-match').filter({ hasText: '@2pm' }).click()
  await expect(page.locator('.smart-task-match')).toHaveText('tomorrow')
  await input(page).press('Enter')
  await saved(page, 'Call @2pm', '2026-11-04')
  await input(page).fill('Call tomorrow @2pm')
  await page.locator('.smart-task-match').filter({ hasText: 'tomorrow' }).click()
  await expect(
    page.getByRole('button', { name: 'Schedule: Today, 14:00. Change date' }),
  ).toBeVisible()
  await input(page).press('Enter')
  await saved(page, 'Call tomorrow', '2026-11-03', '14:00')

  await input(page).fill('Manual call tomorrow @2pm')
  await page.getByRole('button', { name: 'Schedule: Tomorrow, 14:00. Change date' }).click()
  await page.getByLabel('Scheduled time', { exact: true }).fill('18:30')
  await page.keyboard.press('Escape')
  await expect(page.locator('.smart-task-match')).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Schedule: Tomorrow, 18:30. Change date' }),
  ).toBeVisible()
  await input(page).press('Enter')
  await saved(page, 'Manual call tomorrow @2pm', '2026-11-04', '18:30')
})

test('relative previews refresh at local midnight and manual dates stay fixed', async ({
  page,
}) => {
  await openInbox(page)
  await input(page).fill('Midnight review tomorrow')
  await page.clock.setSystemTime(new Date('2026-11-04T10:00:00+07:00'))
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.locator('.new-task [role="status"]')).toContainText('2026-11-05')
  await input(page).press('Enter')
  await saved(page, 'Midnight review', '2026-11-05')
  await input(page).fill('Fixed review tomorrow')
  await page.getByRole('button', { name: 'Due: Tomorrow. Change date' }).click()
  await page.getByRole('button', { name: 'Next month' }).click()
  await page.getByRole('button', { name: /December 20, 2026/ }).click()
  await page.getByRole('button', { name: 'Use date and time from text' }).click()
  await expect(page.getByRole('gridcell', { selected: true })).toContainText('5')
  await page.getByRole('button', { name: 'Next month' }).click()
  await page.getByRole('button', { name: /December 20, 2026/ }).click()
  await page.keyboard.press('Escape')
  await page.clock.setSystemTime(new Date('2026-11-05T10:00:00+07:00'))
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await input(page).press('Enter')
  await saved(page, 'Fixed review tomorrow', '2026-12-20')
})

test('all task creation surfaces use recognition and Due today can be overridden or cleared', async ({
  page,
}) => {
  await openInbox(page)
  await page.getByRole('button', { name: /^Website relaunch/ }).click()
  await page.getByRole('button', { name: 'Board', exact: true }).click()
  await input(page).fill('Board task in 2 days')
  await input(page).press('Enter')
  await saved(page, 'Board task', '2026-11-05')
  await page.getByRole('button', { name: 'List', exact: true }).click()
  await input(page).fill('List task Friday')
  await input(page).press('Enter')
  await saved(page, 'List task', '2026-11-06')

  await page.getByRole('navigation', { name: 'Task views' }).getByRole('button', { name: /^Today/ }).click()
  const dueToday = page.getByRole('textbox', { name: 'New task due today' })
  await dueToday.fill('Handle invoice')
  await dueToday.press('Enter')
  await saved(page, 'Handle invoice', '2026-11-03')
  await dueToday.fill('Tomorrow task tomorrow')
  await dueToday.press('Enter')
  await saved(page, 'Tomorrow task', '2026-11-04')
  await page.getByRole('button', { name: 'Clear due date', exact: true }).click()
  await dueToday.fill('Unscheduled task')
  await dueToday.press('Enter')
  await saved(page, 'Unscheduled task', null)
})
