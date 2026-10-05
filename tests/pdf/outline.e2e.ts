import { test, expect } from '@playwright/test'
import { fileURLToPath } from 'node:url'

// A small real PDF with explicit and named destinations, nested bookmarks, and a heading only.
function outlinePdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R /Outlines 9 0 R /Names << /Dests << /Names [(last) [7 0 R /Fit]] >> >> >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R] /Count 3 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>',
    '<< /Length 0 >>\nstream\n\nendstream',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 6 0 R >>',
    '<< /Length 0 >>\nstream\n\nendstream',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 8 0 R >>',
    '<< /Length 0 >>\nstream\n\nendstream',
    '<< /Type /Outlines /First 10 0 R /Last 12 0 R /Count 3 >>',
    '<< /Title (Chapter one) /Parent 9 0 R /Dest [5 0 R /Fit] /First 11 0 R /Last 11 0 R /Count 1 /Next 12 0 R >>',
    '<< /Title (Nested section) /Parent 10 0 R /Dest (last) >>',
    '<< /Title (Heading only) /Parent 9 0 R /Prev 10 0 R >>',
  ]
  let pdf = '%PDF-1.7\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf))
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(pdf)
}

test('PDF contents navigate nested bookmarks and reset for a PDF without bookmarks', async ({
  page,
}) => {
  await page.goto('/')
  const input = page.locator('input[type=file][accept="application/pdf,.pdf"]')
  await input.setInputFiles({
    name: 'outline.pdf',
    mimeType: 'application/pdf',
    buffer: outlinePdf(),
  })
  const toggle = page.getByRole('button', { name: 'PDF table of contents', exact: true })
  await expect(toggle).toBeEnabled()
  await toggle.click()
  const sidebar = page.getByRole('complementary', { name: 'PDF table of contents' })
  await expect(sidebar.getByRole('button', { name: 'Heading only', exact: true })).toBeDisabled()
  await sidebar.getByRole('button', { name: 'Chapter one', exact: true }).click()
  await expect(page.getByLabel('PDF page', { exact: true })).toHaveValue('2')
  await sidebar.getByRole('button', { name: 'Collapse Chapter one' }).click()
  await expect(sidebar.getByRole('button', { name: 'Nested section', exact: true })).toHaveCount(0)
  await sidebar.getByRole('button', { name: 'Expand Chapter one' }).click()
  await sidebar.getByRole('button', { name: 'Nested section', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('PDF page', { exact: true })).toHaveValue('3')
  await page.screenshot({ path: test.info().outputPath('outline-1280.png') })
  await page.setViewportSize({ width: 900, height: 650 })
  await page.screenshot({ path: test.info().outputPath('outline-900.png') })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await sidebar.getByRole('button', { name: 'Close PDF table of contents' }).focus()
  await page.keyboard.press('Escape')
  await expect(sidebar).toHaveCount(0)
  await expect(toggle).toBeFocused()
  await toggle.click()
  await sidebar.getByRole('button', { name: 'Collapse Chapter one' }).click()
  await input.setInputFiles(fileURLToPath(new URL('./fixtures/text.pdf', import.meta.url)))
  // Each document may have its own mounted reader.
  await expect(toggle).toBeEnabled()
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click()
  await expect(sidebar).toContainText('This PDF has no embedded table of contents.')
  await expect(sidebar.getByRole('button', { name: 'Chapter one', exact: true })).toHaveCount(0)
  await page.getByRole('tab', { name: 'outline.pdf', exact: true }).click()
  await expect(sidebar).toBeVisible()
  await expect(sidebar.getByRole('button', { name: 'Expand Chapter one' })).toBeVisible()
  await expect(sidebar.getByRole('button', { name: 'Nested section', exact: true })).toHaveCount(0)
})

for (const appStyle of ['default', 'cards']) {
  for (const dark of [false, true]) {
    test(`PDF contents resize and retain width: ${appStyle}-${dark ? 'dark' : 'light'}`, async ({
      page,
    }) => {
      await page.goto('/')
      await expect(page.getByRole('textbox', { name: 'Note title', exact: true })).toBeVisible()
      await page.evaluate(
        async ({ appStyle, dark }) => {
          const moduleUrl = performance
            .getEntriesByType('resource')
            .find((entry) => new URL(entry.name).pathname === '/src/storage/useLibrary.ts')!.name
          const { library } = await import(/* @vite-ignore */ moduleUrl)
          library.setAppearance({ ...library.getSnapshot().appearance, appStyle, dark })
        },
        { appStyle, dark },
      )
      const input = page.locator('input[type=file][accept="application/pdf,.pdf"]')
      await input.setInputFiles({
        name: 'resizable.pdf',
        mimeType: 'application/pdf',
        buffer: outlinePdf(),
      })
      const toggle = page.getByRole('button', { name: 'PDF table of contents', exact: true })
      await expect(toggle).toBeEnabled()
      await toggle.click()
      const sidebar = page.getByRole('complementary', { name: 'PDF table of contents' })
      const divider = page.getByRole('separator', { name: 'Resize table of contents', exact: true })
      const width = () => sidebar.evaluate((element) => element.getBoundingClientRect().width)
      await expect.poll(width).toBe(240)
      await page.screenshot({ path: test.info().outputPath('contents-before-1280.png') })
      const edge = (await divider.boundingBox())!
      await page.mouse.move(edge.x + edge.width / 2, edge.y + 60)
      await page.mouse.down()
      await page.mouse.move(edge.x + edge.width / 2 + 80, edge.y + 60, { steps: 8 })
      await page.mouse.up()
      await expect.poll(width).toBe(320)
      await expect(divider).toBeFocused()
      await divider.press('Shift+ArrowRight')
      await expect.poll(width).toBe(352)
      await divider.press('ArrowLeft')
      await expect.poll(width).toBe(344)
      await page.screenshot({ path: test.info().outputPath('contents-after-1280.png') })
      const cancelEdge = (await divider.boundingBox())!
      await page.mouse.move(cancelEdge.x + 5, cancelEdge.y + 60)
      await page.mouse.down()
      await page.mouse.move(cancelEdge.x + 65, cancelEdge.y + 60)
      await expect.poll(width).toBe(404)
      await page.keyboard.press('Escape')
      await page.mouse.up()
      await expect(sidebar).toBeVisible()
      await expect.poll(width).toBe(344)
      await divider.press('Escape')
      await expect(sidebar).toHaveCount(0)
      await expect(toggle).toBeFocused()
      await toggle.click()
      await expect.poll(width).toBe(344)

      // A second reader shares the persisted workspace preference.
      await input.setInputFiles(fileURLToPath(new URL('./fixtures/text.pdf', import.meta.url)))
      await expect(toggle).toBeEnabled()
      await toggle.click()
      await expect.poll(width).toBe(344)
      await page.getByRole('tab', { name: 'resizable.pdf', exact: true }).click()
      await expect.poll(width).toBe(344)

      await page.setViewportSize({ width: 900, height: 650 })
      await page.screenshot({ path: test.info().outputPath('contents-after-900.png') })
      await divider.focus()
      await page.keyboard.press('Shift+ArrowRight')
      await expect.poll(width).toBe(376)
      await page.setViewportSize({ width: 700, height: 650 })
      await expect.poll(width).toBeLessThan(376)
      // In a narrow pane the outline overlays the pages and keeps the resize target reachable.
      await expect(divider).toBeVisible()
      await expect
        .poll(() => sidebar.evaluate((element) => getComputedStyle(element).position))
        .toBe('absolute')
      await page.screenshot({ path: test.info().outputPath('contents-overlay-700.png') })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
      await page.setViewportSize({ width: 1280, height: 800 })
      await expect.poll(width).toBe(376)
      await divider.press('Shift+ArrowRight')
      await divider.press('Shift+ArrowRight')
      await divider.press('Shift+ArrowRight')
      await divider.press('Shift+ArrowRight')
      await expect.poll(width).toBe(480)
      await page.getByRole('button', { name: 'Find in PDF', exact: true }).click()
      await expect(page.getByRole('complementary', { name: 'PDF search results' })).toBeVisible()
      await expect
        .poll(() =>
          page.locator('.pdf-scroll-shell:visible').evaluate((element) => element.clientWidth),
        )
        .toBeGreaterThanOrEqual(280)
      await page.getByRole('button', { name: 'Close PDF search', exact: true }).click()
      await expect.poll(width).toBe(480)
      for (let step = 0; step < 10; step++) await divider.press('Shift+ArrowLeft')
      await expect.poll(width).toBe(160)
      await expect(
        sidebar.getByRole('button', { name: 'Close PDF table of contents' }),
      ).toBeVisible()
    })
  }
}
