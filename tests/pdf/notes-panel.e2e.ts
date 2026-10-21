import { test, expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

/** The notes list is hidden from the "Sort and view options" menu in its own bar. */
async function hideNotesList(page: Page) {
  await page.getByRole('button', { name: 'Sort and view options', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Hide notes list', exact: true }).click()
  await expect(page.locator('.window')).toHaveClass(/\bno-note-list\b/)
}

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 900, height: 650 },
]) {
  for (const colorMode of ['light', 'dark'] as const) {
    const name = `${viewport.width}-${colorMode}`
    test(`independent Notes layout, accessibility and retained state: ${name}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport)
      await page.goto('/')
      await expect(page.getByRole('textbox', { name: 'Note title', exact: true })).toBeVisible()
      await page.evaluate(async (colorMode) => {
        // Use the real preview store so React applies the selected color mode.
        const moduleUrl = performance
          .getEntriesByType('resource')
          .find((entry) => new URL(entry.name).pathname === '/src/storage/useLibrary.ts')!.name
        const { library } = await import(/* @vite-ignore */ moduleUrl)
        library.setAppearance({ ...library.getSnapshot().appearance, colorMode })
        const notes = Array.from({ length: 40 }, (_, index) => ({
          id: `panel-note-${index}`,
          title: `Panel note ${index}`,
          text: 'Panel test body',
          content: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Panel test body' }] }],
          },
          tags: [],
          notebookIds: [],
          quickAccess: false,
          pinned: false,
          trashed: false,
          updated: index,
        }))
        library.setNotes(notes)
      }, colorMode)
      await page.getByRole('button', { name: 'Panel note 39', exact: true }).click()
      await expect(page.locator('html')).toHaveAttribute('data-theme', colorMode)
      await expect(page.getByRole('textbox', { name: 'Note title', exact: true })).toHaveValue(
        'Panel note 39',
      )
      const list = page.locator('#note-list')
      const rows = page.locator('.note-rows')
      const search = page.getByRole('textbox', { name: 'Filter this view', exact: true })
      await search.fill('Panel')
      await rows.evaluate((element) => {
        element.scrollTop = 130
      })
      const originalScroll = await rows.evaluate((element) => element.scrollTop)
      expect(originalScroll).toBe(130)
      const handle = await list.elementHandle()
      const tracks = () =>
        page
          .locator('.window')
          .evaluate((element) =>
            getComputedStyle(element).gridTemplateColumns.split(' ').map(Number.parseFloat),
          )
      await page.screenshot({ path: test.info().outputPath(`${name}-expanded.png`) })
      const visibleListWidth = (await tracks())[1]
      await hideNotesList(page)
      // The collapsed list keeps its DOM (and scroll) in a zero-width column.
      await expect(list).toHaveAttribute('inert', '')
      await expect(list).toHaveAttribute('aria-hidden', 'true')
      await expect(
        page.getByRole('textbox', { name: 'Filter this view', exact: true }),
      ).toHaveCount(0)
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
      // Hiding the list keeps its width for when it returns.
      expect(restoredListWidth).toBe(visibleListWidth)
      await page.screenshot({ path: test.info().outputPath(`${name}-collapsed.png`) })
      // With the sidebar shown, the editor bar leads with the notes-list toggle.
      const editorBar = page.locator('.editor-bar')
      const showList = editorBar.getByRole('button', { name: 'Show notes list', exact: true })
      await expect(showList).toHaveAttribute('aria-expanded', 'false')
      const back = await editorBar
        .getByRole('button', { name: 'Back to previous note', exact: true })
        .boundingBox()
      expect((await showList.boundingBox())!.x).toBeLessThan(back!.x)
      await expect(editorBar.locator('.window-controls-space')).toHaveCount(0)
      await page.getByRole('button', { name: 'Hide sidebar', exact: true }).click()
      await expect.poll(async () => (await tracks()).slice(0, 2)).toEqual([0, 0])
      // The editor is now leftmost: it reserves the traffic-light space before both toggles.
      await page.locator('.window').evaluate((element) => element.classList.add('native-chrome'))
      const controls = await editorBar.locator('.window-controls-space').boundingBox()
      const showSidebar = await editorBar
        .getByRole('button', { name: 'Show sidebar', exact: true })
        .boundingBox()
      expect(controls!.width).toBe(70)
      expect(showSidebar!.x).toBeGreaterThanOrEqual(controls!.x + controls!.width)
      expect((await showList.boundingBox())!.x).toBeGreaterThan(showSidebar!.x)
      await showList.click()
      await expect(page.locator('.window')).not.toHaveClass(/\bno-note-list\b/)
      await expect(list).not.toHaveAttribute('inert')
      await expect.poll(async () => (await tracks())[0]).toBe(0)
      expect(
        await handle!.evaluate((element) => element === document.querySelector('#note-list')),
      ).toBe(true)
      await expect(search).toHaveValue('Panel')
      expect(await rows.evaluate((element) => element.scrollTop)).toBe(originalScroll)
      await page.getByRole('button', { name: 'Show sidebar', exact: true }).click()
      await page.getByRole('button', { name: 'Table of contents', exact: true }).click()
      await hideNotesList(page)
      await expect.poll(async () => (await tracks())[1]).toBe(0)
      await page
        .getByRole('navigation', { name: 'Notes navigation', exact: true })
        .getByRole('button', { name: /^All notes/ })
        .click()
      await expect(page.locator('.window')).not.toHaveClass(/\bno-note-list\b/)
      await expect(search).toHaveValue('')
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true)
    })
  }
}

test('PDF tabs override the chosen Notes visibility and returning restores it', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('textbox', { name: 'Note title', exact: true }).fill('Toggle test note')
  await hideNotesList(page)
  await page.locator('input[type=file][accept="application/pdf,.pdf"]').setInputFiles({
    name: 'toggle.pdf',
    mimeType: 'application/pdf',
    buffer: await readFile(new URL('./fixtures/text.pdf', import.meta.url)),
  })
  await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toBeEnabled()
  // A PDF tab hides the notes list and offers no toggle for it.
  const window = page.locator('.window')
  await expect(window).toHaveClass(/\bpdf-active\b/)
  await expect(page.getByRole('button', { name: 'Show notes list', exact: true })).toHaveCount(0)
  await page.getByRole('tab', { name: 'Toggle test note', exact: true }).click()
  await expect(window).toHaveClass(/\bno-note-list\b/)
  await page.getByRole('button', { name: 'Show notes list', exact: true }).click()
  await expect(window).not.toHaveClass(/\bno-note-list\b/)
  await page.getByRole('tab', { name: 'toggle.pdf', exact: true }).click()
  await expect(page.locator('#note-list')).toBeHidden()
  await expect(page.getByRole('button', { name: 'Show notes list', exact: true })).toHaveCount(0)
  await page.getByRole('tab', { name: 'Toggle test note', exact: true }).click()
  await expect(page.locator('#note-list')).toBeVisible()
  await expect(window).not.toHaveClass(/\bno-note-list\b/)
})

test('reduced motion and mobile keep their intended navigation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await hideNotesList(page)
  expect(
    await page
      .locator('.window')
      .evaluate((element) => getComputedStyle(element).transitionDuration),
  ).toBe('0s')
  await page.getByRole('button', { name: 'Show notes list', exact: true }).click()
  await expect(page.locator('.window')).not.toHaveClass(/\bno-note-list\b/)
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport)
    await page.goto('/?mobile=1')
    await expect(page.locator('.mobile-app')).toBeVisible()
    await expect(page.getByRole('button', { name: /notes list/ })).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: test.info().outputPath(`mobile-${viewport.width}.png`) })
  }
})
