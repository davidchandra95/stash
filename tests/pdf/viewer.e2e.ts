import { test, expect, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}.pdf`, import.meta.url))
async function open(page: Page, name: string) {
  await page.locator('input[type=file][accept="application/pdf,.pdf"]').setInputFiles(fixture(name))
  await expect(page.getByRole('tab', { name: `${name}.pdf`, exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  )
}
async function rendered(page: Page) {
  await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toBeEnabled()
  await expect(page.locator('.pdf-session:not([hidden]) .pdfViewer canvas').first()).toBeVisible()
}
async function anchor(page: Page) {
  return page.evaluate(() => {
    const container = document.querySelector<HTMLElement>('.pdf-session:not([hidden]) .pdf-scroll')!
    const number = Number(
      document.querySelector<HTMLInputElement>(
        '.pdf-session:not([hidden]) [aria-label="PDF page"]',
      )!.value,
    )
    const div = document.querySelector<HTMLElement>(
      `.pdf-session:not([hidden]) .pdfViewer .page[data-page-number="${number}"]`,
    )!
    return {
      page: number,
      y: (container.scrollTop - div.offsetTop) / div.clientHeight,
      zoom: document.querySelector<HTMLSelectElement>(
        '.pdf-session:not([hidden]) [aria-label="PDF zoom"]',
      )!.value,
    }
  })
}
test('restores PDF reading position and note edits across tabs, close, zoom and resize', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto('/')
  const title = page.getByRole('textbox', { name: 'Note title', exact: true })
  await title.fill('PDF tab retained this note edit')
  await open(page, 'text')
  await rendered(page)
  await expect(page.locator('#note-list')).toBeHidden()
  await page.getByRole('textbox', { name: 'PDF page', exact: true }).fill('4')
  await page.getByRole('textbox', { name: 'PDF page', exact: true }).press('Enter')
  await expect.poll(async () => (await anchor(page)).page).toBe(4)
  await page.locator('.pdf-session:not([hidden]) .pdf-scroll').evaluate((el) => {
    el.scrollTop += 250
  })
  await expect.poll(async () => (await anchor(page)).y).toBeGreaterThan(0.1)
  const before = await anchor(page)
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await expect.poll(async () => (await anchor(page)).zoom).not.toBe(before.zoom)
  await page.setViewportSize({ width: 900, height: 650 })
  await expect.poll(async () => Math.abs((await anchor(page)).y - before.y)).toBeLessThan(0.02)
  const resized = await anchor(page)
  await page.getByRole('button', { name: 'Close text.pdf', exact: true }).click()
  await expect(page.locator('#note-list')).toBeVisible()
  await expect(title).toHaveValue('PDF tab retained this note edit')
  await page.locator('.pdf-sidebar-row').filter({ hasText: 'text.pdf' }).click()
  await rendered(page)
  await expect.poll(async () => (await anchor(page)).page).toBe(4)
  await expect.poll(async () => Math.abs((await anchor(page)).y - before.y)).toBeLessThan(0.02)
  expect((await anchor(page)).zoom).toBe(resized.zoom)
  await open(page, 'text')
  await expect(page.getByRole('tab', { name: 'text.pdf', exact: true })).toHaveCount(1)
  await page.screenshot({ path: test.info().outputPath('reading-900.png') })
  expect(errors).toEqual([])
})
test('search reaches unrendered distant pages and canvases stay bounded', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto('/')
  await open(page, 'large')
  await rendered(page)
  await page.keyboard.press('Control+f')
  await page
    .getByRole('textbox', { name: 'Find in PDF', exact: true })
    .fill('Needle on the distant page')
  await expect(page.locator('.pdf-find')).toContainText('1 of 1')
  await expect(page.getByRole('textbox', { name: 'PDF page', exact: true })).toHaveValue('290')
  await expect(
    page.locator('.pdf-session:not([hidden]) .textLayer .highlight.selected'),
  ).toContainText('Needle on the distant page')
  expect(await page.locator('.pdf-session:not([hidden]) .pdfViewer canvas').count()).toBeLessThan(
    15,
  )
  await open(page, 'text')
  await rendered(page)
  for (let i = 0; i < 5; i++) {
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
    await page.locator('.pdf-sidebar-row').filter({ hasText: 'large.pdf' }).click()
    await page.locator('.pdf-sidebar-row').filter({ hasText: 'text.pdf' }).click()
    await rendered(page)
  }
  await page.getByRole('button', { name: 'Close text.pdf', exact: true }).click()
  expect(errors).toEqual([])
})
test('rotated text selection, scans, encryption and corrupt-file errors', async ({ page }) => {
  await page.goto('/')
  await open(page, 'rotated')
  await rendered(page)
  await page.getByRole('textbox', { name: 'PDF page', exact: true }).fill('2')
  await page.getByRole('textbox', { name: 'PDF page', exact: true }).press('Enter')
  const text = page
    .locator('.pdf-session:not([hidden]) .page[data-page-number="2"] .textLayer span')
    .first()
  await expect(text).toContainText('Stash PDF')
  await page.locator('.pdf-session:not([hidden]) .pdf-scroll').focus()
  const selection = await text.evaluate((el) => {
    const range = document.createRange()
    range.selectNodeContents(el)
    getSelection()!.removeAllRanges()
    getSelection()!.addRange(range)
    const rect = range.getBoundingClientRect()
    return {
      text: getSelection()!.toString(),
      height: rect.height,
      width: rect.width,
      rotation: el
        .closest('.pdf-session:not([hidden]) .textLayer')!
        .getAttribute('data-main-rotation'),
    }
  })
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.keyboard.press('ControlOrMeta+c')
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain('Stash PDF')
  expect(selection.text).toContain('Stash PDF')
  expect(selection.rotation).toBe('90')
  expect(selection.height).toBeGreaterThan(selection.width)
  await page.getByRole('button', { name: 'Fit page', exact: true }).click()
  await expect
    .poll(() =>
      page.evaluate(() => {
        const container = document.querySelector<HTMLElement>(
          '.pdf-session:not([hidden]) .pdf-scroll',
        )!
        const sheet = document.querySelector<HTMLElement>(
          '.pdf-session:not([hidden]) .pdfViewer .page[data-page-number="2"]',
        )!
        return (
          sheet.clientWidth <= container.clientWidth && sheet.clientHeight <= container.clientHeight
        )
      }),
    )
    .toBe(true)
  await open(page, 'scanned')
  await expect(page.getByText('No searchable text.', { exact: false })).toBeVisible()
  await rendered(page)
  await open(page, 'encrypted')
  await expect(
    page.getByText('Password-protected PDFs are not supported yet.', { exact: true }),
  ).toBeVisible()
  await open(page, 'corrupt')
  await expect(page.getByText('Could not open this PDF.', { exact: false })).toBeVisible()
  const controls = page.getByRole('group', { name: 'PDF page and zoom controls' })
  for (const button of await controls.getByRole('button').all()) await expect(button).toBeDisabled()
  await expect(controls.getByLabel('PDF page', { exact: true })).toBeDisabled()
  await expect(controls.getByLabel('PDF zoom', { exact: true })).toBeDisabled()
})
test('PDF styles stay contained across palettes, layouts and narrow desktop windows', async ({
  page,
}) => {
  await page.goto('/')
  await open(page, 'text')
  await rendered(page)
  for (const palette of [
    'classic',
    'zen',
    'financial',
    'tiktok',
    'catppuccin',
    'lastchat',
    'qrafthive',
  ]) {
    for (const mode of ['light', 'dark'])
      for (const style of ['default', 'cards']) {
        await page.evaluate(
          ({ palette, mode, style }) => {
            document.querySelector<HTMLElement>('.app')!.dataset.palette = palette
            document.querySelector<HTMLElement>('.app')!.dataset.theme = mode
            document.documentElement.dataset.appStyle = style
          },
          { palette, mode, style },
        )
        expect(
          await page.locator('.sidebar').evaluate((el) => getComputedStyle(el).width),
        ).not.toBe('239px')
        expect(
          await page
            .locator('.pdf-session:not([hidden]) .pdfViewer .page')
            .first()
            .evaluate((el) => getComputedStyle(el).backgroundColor),
        ).toBe('rgb(255, 255, 255)')
        await expect(page.getByRole('button', { name: 'Fit width' })).toBeVisible()
      }
  }
  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 900, height: 650 },
    { width: 680, height: 650 },
  ]) {
    await page.setViewportSize(viewport)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect(page.getByRole('button', { name: 'Open PDF', exact: true })).toBeVisible()
    await page.screenshot({ path: test.info().outputPath(`pdf-${viewport.width}.png`) })
  }
})
test('mobile note screens retain their layout without PDF controls', async ({ page }) => {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport)
    await page.goto('/?mobile=1')
    await expect(page.locator('.mobile-app')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Open PDF', exact: true })).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: test.info().outputPath(`mobile-${viewport.width}.png`) })
  }
})

test('bottom toolbar navigates pages and preserves fit modes through resizing and reopening', async ({
  page,
}) => {
  await page.goto('/')
  await open(page, 'text')
  await rendered(page)
  const toolbar = page.getByRole('group', { name: 'PDF page and zoom controls' })
  const button = (name: string) => toolbar.getByRole('button', { name, exact: true })
  const input = toolbar.getByLabel('PDF page', { exact: true })
  const zoom = toolbar.getByLabel('PDF zoom', { exact: true })
  await expect(button('First page')).toBeDisabled()
  await expect(button('Previous page')).toBeDisabled()
  await button('Next page').click()
  await expect(input).toHaveValue('2')
  await button('Previous page').click()
  await expect(input).toHaveValue('1')
  await button('Last page').click()
  await expect(button('Next page')).toBeDisabled()
  await expect(button('Last page')).toBeDisabled()
  for (const invalid of ['0', '-1', '99999', '1.5', 'abc', '']) {
    const current = await input.inputValue()
    await input.fill(invalid)
    await input.press('Enter')
    await expect(input).toHaveValue(current)
  }
  await button('First page').click()
  await button('Actual size').click()
  await expect(zoom).toHaveValue('1')
  await expect(button('Actual size')).toHaveAttribute('aria-pressed', 'true')
  for (const percent of [25, 50, 75, 100, 125, 150, 200, 300, 400, 500]) {
    await zoom.selectOption(String(percent / 100))
    await expect(zoom).toHaveValue(String(percent / 100))
  }
  await expect(button('Zoom in')).toBeDisabled()
  await zoom.selectOption('0.25')
  await expect(button('Zoom out')).toBeDisabled()
  for (const fit of ['Fit page', 'Fit height', 'Fit width']) {
    await button(fit).click()
    await expect(button(fit)).toHaveAttribute('aria-pressed', 'true')
    await expect
      .poll(async () =>
        page.evaluate((mode) => {
          const container = document.querySelector<HTMLElement>(
            '.pdf-session:not([hidden]) .pdf-scroll',
          )!
          const number = (
            document.querySelector(
              '.pdf-session:not([hidden]) [aria-label="PDF page"]',
            ) as HTMLInputElement
          ).value
          const sheet = document.querySelector<HTMLElement>(
            `.pdf-session:not([hidden]) .pdfViewer .page[data-page-number="${number}"]`,
          )!
          return (
            (mode === 'Fit height' || sheet.clientWidth <= container.clientWidth) &&
            (mode === 'Fit width' || sheet.clientHeight <= container.clientHeight)
          )
        }, fit),
      )
      .toBe(true)
  }
  await button('Fit width').click()
  const beforeFind = await zoom.inputValue()
  await page.getByRole('button', { name: 'Find in PDF', exact: true }).click()
  await expect(zoom).not.toHaveValue(beforeFind)
  await page.getByRole('button', { name: 'Close PDF search' }).click()
  await expect
    .poll(async () => Math.abs(Number(await zoom.inputValue()) - Number(beforeFind)))
    .toBeLessThan(0.0001)
  await button('Fit height').click()
  const beforeHeight = await zoom.inputValue()
  await page.setViewportSize({ width: 1280, height: 650 })
  await expect(zoom).not.toHaveValue(beforeHeight)
  await expect(button('Fit height')).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('tab', { name: 'text.pdf', exact: true }).click()
  await page.getByRole('button', { name: 'Close text.pdf', exact: true }).click()
  await page.locator('.pdf-sidebar-row').filter({ hasText: 'text.pdf' }).click()
  await rendered(page)
  await expect(button('Fit height')).toHaveAttribute('aria-pressed', 'true')
  await button('Fit width').click()
  const beforeWidth = await zoom.inputValue()
  await page.setViewportSize({ width: 900, height: 650 })
  await expect(zoom).not.toHaveValue(beforeWidth)
  await button('Actual size').focus()
  await page.keyboard.press('Enter')
  await expect(button('Actual size')).toHaveAttribute('aria-pressed', 'true')
  await page.setViewportSize({ width: 900, height: 800 })
  await expect(zoom).toHaveValue('1')
  const footer = await toolbar.boundingBox()
  const pages = await page.getByLabel('PDF pages', { exact: true }).boundingBox()
  expect(footer!.y).toBeGreaterThanOrEqual(pages!.y + pages!.height - 1)
  await page.screenshot({ path: test.info().outputPath('bottom-toolbar.png') })
})
