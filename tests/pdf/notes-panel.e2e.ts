import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 900, height: 650 },
]) {
  for (const appStyle of ['default', 'cards']) {
    for (const dark of [false, true]) {
      const name = `${viewport.width}-${appStyle}-${dark ? 'dark' : 'light'}`
      test(`independent Notes layout, accessibility and retained state: ${name}`, async ({
        page,
      }) => {
        await page.setViewportSize(viewport)
        await page.goto('/')
        await expect(page.getByRole('textbox', { name: 'Note title', exact: true })).toBeVisible()
        await page.evaluate(
          async ({ appStyle, dark }) => {
            // Use the real preview store so React applies the selected theme and app style.
            const moduleUrl = performance
              .getEntriesByType('resource')
              .find((entry) => new URL(entry.name).pathname === '/src/storage/useLibrary.ts')!.name
            const { library } = await import(/* @vite-ignore */ moduleUrl)
            library.setAppearance({ ...library.getSnapshot().appearance, appStyle, dark })
            const notes = Array.from({ length: 40 }, (_, index) => ({
              id: `panel-note-${index}`,
              title: `Panel note ${index}`,
              text: 'Panel test body',
              content: {
                type: 'doc',
                content: [
                  { type: 'paragraph', content: [{ type: 'text', text: 'Panel test body' }] },
                ],
              },
              tags: [],
              notebookIds: [],
              quickAccess: false,
              pinned: false,
              trashed: false,
              updated: index,
            }))
            library.setNotes(notes)
          },
          { appStyle, dark },
        )
        await page.locator('.note-row-title').getByText('Panel note 0', { exact: true }).click()
        await expect(page.locator('html')).toHaveAttribute('data-app-style', appStyle)
        await expect(page.locator('.app')).toHaveAttribute('data-theme', dark ? 'dark' : 'light')
        await expect(page.getByRole('textbox', { name: 'Note title', exact: true })).toHaveValue(
          'Panel note 0',
        )
        const list = page.locator('#note-list')
        const rows = page.locator('.note-rows')
        const search = page.getByRole('textbox', { name: 'Search notes', exact: true })
        await search.fill('Panel')
        await rows.evaluate((element) => {
          element.scrollTop = 130
        })
        const originalScroll = await rows.evaluate((element) => element.scrollTop)
        expect(originalScroll).toBe(130)
        const handle = await list.elementHandle()
        const tracks = () =>
          page
            .locator('.app')
            .evaluate((element) =>
              getComputedStyle(element).gridTemplateColumns.split(' ').map(Number.parseFloat),
            )
        await page.screenshot({ path: `.artifact-work/notes-panel/${name}-expanded.png` })
        await page.getByRole('button', { name: 'Hide notes list', exact: true }).press('Enter')
        await expect(list).toBeHidden()
        await expect(list).toHaveAttribute('inert', '')
        await expect(list).toHaveAttribute('aria-hidden', 'true')
        await expect(page.getByRole('textbox', { name: 'Search notes', exact: true })).toHaveCount(
          0,
        )
        await expect(page.locator('.pane-resizer--noteList')).toHaveCount(0)
        await expect.poll(async () => (await tracks())[1]).toBe(0)
        const previousSidebarWidth = (await tracks())[0]
        await page.locator('.pane-resizer--sidebar').press('ArrowRight')
        await expect.poll(async () => (await tracks())[0]).toBe(previousSidebarWidth + 8)
        const restoredListWidth = await page.evaluate(async () => {
          const moduleUrl = performance
            .getEntriesByType('resource')
            .find((entry) => new URL(entry.name).pathname === '/src/storage/useLibrary.ts')!.name
          const { library } = await import(/* @vite-ignore */ moduleUrl)
          return library.getSnapshot().workspace?.paneWidths?.noteList
        })
        expect(restoredListWidth).toBe(viewport.width === 1280 ? 272 : 240)
        await page.screenshot({ path: `.artifact-work/notes-panel/${name}-collapsed.png` })
        // The title bar remains centered even with native traffic-light clearance.
        await page
          .locator('.title-bar')
          .evaluate((element) => element.classList.add('native-title-bar'))
        const left = await page.locator('.title-bar-left').boundingBox()
        const toggle = await page
          .getByRole('button', { name: 'Show notes list', exact: true })
          .boundingBox()
        const controls = await page.locator('.title-bar-controls').boundingBox()
        expect(toggle!.x + toggle!.width).toBeLessThanOrEqual(left!.x + left!.width)
        expect(Math.abs(controls!.x + controls!.width / 2 - viewport.width / 2)).toBeLessThan(1)
        await page.getByRole('button', { name: 'Hide sidebar', exact: true }).click()
        await expect.poll(async () => (await tracks()).slice(0, 2)).toEqual([0, 0])
        await page.getByRole('button', { name: 'Show notes list', exact: true }).click()
        await expect(list).toBeVisible()
        await expect.poll(async () => (await tracks())[0]).toBe(0)
        expect(
          await handle!.evaluate((element) => element === document.querySelector('#note-list')),
        ).toBe(true)
        await expect(search).toHaveValue('Panel')
        expect(await rows.evaluate((element) => element.scrollTop)).toBe(originalScroll)
        await page.getByRole('button', { name: 'Show sidebar', exact: true }).click()
        await page.getByRole('button', { name: 'Table of contents', exact: true }).click()
        await page.getByRole('button', { name: 'Hide notes list', exact: true }).click()
        await expect.poll(async () => (await tracks())[1]).toBe(0)
        await page.locator('.sidebar .nav-item').filter({ hasText: 'All notes' }).click()
        await expect(list).toBeVisible()
        await expect(search).toHaveValue('')
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
          .toBe(true)
      })
    }
  }
}

test('PDF tabs override the chosen Notes visibility and returning restores it', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('textbox', { name: 'Note title', exact: true }).fill('Toggle test note')
  await page.getByRole('button', { name: 'Hide notes list', exact: true }).click()
  await page.locator('input[type=file][accept="application/pdf,.pdf"]').setInputFiles({
    name: 'toggle.pdf',
    mimeType: 'application/pdf',
    buffer: await readFile(new URL('./fixtures/text.pdf', import.meta.url)),
  })
  await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Show notes list', exact: true })).toBeDisabled()
  await page.getByRole('tab', { name: 'Toggle test note', exact: true }).click()
  await expect(page.locator('#note-list')).toBeHidden()
  await page.getByRole('button', { name: 'Show notes list', exact: true }).click()
  await page.getByRole('tab', { name: 'toggle.pdf', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Show notes list', exact: true })).toBeDisabled()
  await page.getByRole('tab', { name: 'Toggle test note', exact: true }).click()
  await expect(page.locator('#note-list')).toBeVisible()
})

test('reduced motion and mobile keep their intended navigation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await page.getByRole('button', { name: 'Hide notes list', exact: true }).click()
  await expect(page.locator('#note-list')).toBeHidden()
  expect(
    await page.locator('.app').evaluate((element) => getComputedStyle(element).transitionDuration),
  ).toBe('0s')
  await page.getByRole('button', { name: 'Show notes list', exact: true }).click()
  await expect(page.locator('#note-list')).toBeVisible()
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport)
    await page.goto('/?mobile=1')
    await expect(page.locator('.mobile-app')).toBeVisible()
    await expect(page.getByRole('button', { name: /notes list/ })).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `.artifact-work/notes-panel/mobile-${viewport.width}.png` })
  }
})
