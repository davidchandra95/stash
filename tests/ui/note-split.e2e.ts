import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'

const groups = (page: Page) => page.locator('.editor-group')
const group = (page: Page, name: 'main' | 'split') => page.locator(`[data-group="${name}"]`)

async function openNotes(page: Page, count: number) {
  await page.goto('/')
  await page.locator('.note-row').first().waitFor()
  for (let i = 0; i < count; i++)
    await page
      .locator('.note-row')
      .nth(i)
      .click({ modifiers: ['Meta'] })
}
/** The demo library starts with a tab open, so close down to one. */
async function openOneNote(page: Page) {
  await openNotes(page, 1)
  const tabs = page.locator('[data-tab-id]')
  while ((await tabs.count()) > 1)
    await tabs.first().getByRole('button', { name: /^Close / }).click({ force: true })
}
async function dragTab(page: Page, tab: ReturnType<Page['locator']>, x: number, y: number) {
  const box = await tab.boundingBox()
  await page.mouse.move(box!.x + 20, box!.y + 12)
  await page.mouse.down()
  await page.mouse.move(box!.x + 40, box!.y + 40, { steps: 3 })
  await page.mouse.move(x, y, { steps: 8 })
}

test('the bar button splits right, and both views edit the same note', async ({ page }) => {
  await openOneNote(page)
  await page.getByRole('button', { name: 'Split Right', exact: true }).click()
  await expect(groups(page)).toHaveCount(2)
  const main = group(page, 'main')
  const split = group(page, 'split')
  await expect(split.locator('.tab-title')).toHaveText(await main.locator('.tab-title').innerText())
  const mainBox = await main.boundingBox()
  const splitBox = await split.boundingBox()
  expect(splitBox!.x).toBeGreaterThan(mainBox!.x)

  await split.locator('.tiptap').click()
  await page.keyboard.press('Meta+ArrowUp')
  await page.keyboard.type('typed on the right ')
  await expect(main.locator('.tiptap')).toContainText('typed on the right')
  await main.locator('.tiptap').click()
  await page.keyboard.press('Meta+ArrowUp')
  await page.keyboard.type('typed on the left ')
  await expect(split.locator('.tiptap')).toContainText('typed on the left')
  await expect(main).toHaveClass(/is-focused/)

  // Each group's tools act on that group, and moving focus doesn't shift its tabs.
  await split.getByRole('button', { name: 'Find in note', exact: true }).click()
  await expect(split).toHaveClass(/is-focused/)
  await expect(split.getByRole('textbox', { name: /find/i })).toBeVisible()
  await expect(main.getByRole('textbox', { name: /find/i })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await main.locator('.tiptap').click()

  await page.screenshot({ path: '.artifact-work/note-split-button.png' })
  await split.getByRole('button', { name: /^Close / }).click()
  await expect(groups(page)).toHaveCount(1)
  await expect(page.locator('.tiptap')).toContainText('typed on the right')
})

test('the tab menu splits left and right', async ({ page }) => {
  await openNotes(page, 2)
  const tab = group(page, 'main').locator('[data-tab-id]').first()
  await tab.click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Split Right' })).toBeVisible()
  await page.getByRole('menuitem', { name: 'Split Left' }).click()
  await expect(groups(page)).toHaveCount(2)
  expect((await group(page, 'split').boundingBox())!.x).toBeLessThan(
    (await group(page, 'main').boundingBox())!.x,
  )
  // With a group on the left, the main group's tabs can only go that way.
  await group(page, 'main').locator('[data-tab-id]').first().click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Split Left' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Split Right' })).toHaveCount(0)
})

test('dragging a tab to the right edge moves it into a split, and back merges', async ({ page }) => {
  await openNotes(page, 2)
  const main = group(page, 'main')
  const box = (await main.boundingBox())!
  const moved = await main.locator('.tab.is-active .tab-title').innerText()
  await dragTab(page, main.locator('.tab.is-active'), box.x + box.width - 40, box.y + 300)
  await expect(page.locator('.editor-drop-zone')).toHaveAttribute('data-side', 'right')
  await expect(page.locator('.tab-drag-ghost')).toBeVisible()
  await page.screenshot({ path: '.artifact-work/note-split-drag.png' })
  await page.mouse.up()
  await expect(groups(page)).toHaveCount(2)
  await expect(page.locator('.editor-drop-zone')).toHaveCount(0)
  await expect(group(page, 'split').locator('.tab-title')).toHaveText(moved)
  await expect(main.locator('[data-tab-id]')).toHaveCount(1)

  const target = (await main.boundingBox())!
  await dragTab(
    page,
    group(page, 'split').locator('.tab'),
    target.x + target.width / 2,
    target.y + 300,
  )
  await expect(page.locator('.editor-drop-zone')).toHaveAttribute('data-side', 'all')
  await page.mouse.up()
  await expect(groups(page)).toHaveCount(1)
  await expect(page.locator('[data-tab-id]')).toHaveCount(2)
})

test('dragging a lone tab to the edge splits a copy, and Escape cancels', async ({ page }) => {
  await openOneNote(page)
  const main = group(page, 'main')
  const box = (await main.boundingBox())!
  await dragTab(page, main.locator('.tab'), box.x + box.width - 40, box.y + 300)
  await page.keyboard.press('Escape')
  await expect(page.locator('.editor-drop-zone')).toHaveCount(0)
  await page.mouse.up()
  await expect(groups(page)).toHaveCount(1)

  await dragTab(page, main.locator('.tab'), box.x + 40, box.y + 300)
  await expect(page.locator('.editor-drop-zone')).toHaveAttribute('data-side', 'left')
  await page.mouse.up()
  await expect(groups(page)).toHaveCount(2)
  await expect(main.locator('[data-tab-id]')).toHaveCount(1)
})

test('note list clicks open in the focused group', async ({ page }) => {
  await openOneNote(page)
  await page.keyboard.press('Control+\\')
  await expect(groups(page)).toHaveCount(2)
  const main = group(page, 'main')
  const split = group(page, 'split')
  const before = await main.locator('.tab-title').innerText()
  await page.locator('.note-row').nth(2).click()
  await expect(split.locator('[data-tab-id]')).toHaveCount(2)
  await expect(main.locator('.tab-title')).toHaveText(before)
  const title = await split.locator('.tab.is-active .tab-title').innerText()
  await expect(split.getByLabel('Note title')).toHaveValue(title)
  await expect(main.getByLabel('Note title')).toHaveValue(before)
})

test('a PDF stays in the main group, hiding the split until a note shows', async ({ page }) => {
  await openNotes(page, 2)
  const split = group(page, 'split')
  await group(page, 'main').getByRole('button', { name: 'Split Right', exact: true }).click()
  await expect(split).toBeVisible()
  await page
    .locator('input[type=file][accept="application/pdf,.pdf"]')
    .setInputFiles(fileURLToPath(new URL('../pdf/fixtures/text.pdf', import.meta.url)))
  await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toBeEnabled()
  await expect(split).toHaveCount(0)
  const pdfTab = group(page, 'main').locator('.tab.is-active')
  await pdfTab.click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Close', exact: true })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: /^Split/ })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await group(page, 'main').locator('[data-tab-id]').first().getByRole('tab').click()
  await expect(split).toBeVisible()
  await pdfTab.isVisible()
  await expect(group(page, 'main').locator('.tiptap')).toBeVisible()
})

for (const colorMode of ['light', 'dark'] as const)
  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 900, height: 650 },
  ])
    test(`split notes fit ${colorMode} ${viewport.width}`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await openNotes(page, 2)
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      await page
        .getByRole('radiogroup', { name: 'Appearance', exact: true })
        .getByRole('radio', { name: colorMode === 'dark' ? 'Dark' : 'Light', exact: true })
        .click()
      await page.getByLabel('Close settings').click()
      const main = group(page, 'main')
      const box = (await main.boundingBox())!
      await dragTab(page, main.locator('.tab.is-active'), box.x + box.width - 30, box.y + 200)
      const zone = (await page.locator('.editor-drop-zone').boundingBox())!
      expect(zone.y + zone.height).toBe(viewport.height)
      await page.mouse.up()
      await expect(groups(page)).toHaveCount(2)
      expect(await page.evaluate(() => document.scrollingElement!.scrollWidth)).toBe(viewport.width)
      const area = await page.locator('.editor-groups').boundingBox()
      expect(area!.x + area!.width).toBe(viewport.width)
      await page.screenshot({
        path: `.artifact-work/note-split-${colorMode}-${viewport.width}.png`,
      })
    })
