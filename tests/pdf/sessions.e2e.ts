import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'

const fixture = (name: string) => new URL(`./fixtures/${name}.pdf`, import.meta.url)

test('retains live PDF sessions across notes and PDFs, and releases them on close', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(String(error)))
  await page.addInitScript(() => {
    const slice = File.prototype.slice
    Object.assign(window, { pdfReads: 0 })
    File.prototype.slice = function (...args) {
      ;(window as unknown as { pdfReads: number }).pdfReads++
      return slice.apply(this, args)
    }
  })
  await page.goto('/')
  await page.getByRole('textbox', { name: 'Note title', exact: true }).fill('Session note')
  const input = page.locator('input[type=file][accept="application/pdf,.pdf"]')
  await input.setInputFiles({
    name: 'first.pdf',
    mimeType: 'application/pdf',
    buffer: await readFile(fixture('text')),
  })
  await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toBeEnabled()
  await page.keyboard.press('Control+f')
  await page.getByRole('textbox', { name: 'Find in PDF', exact: true }).fill('quiet library')
  await expect(page.getByRole('complementary', { name: 'PDF search results' })).toContainText(
    '1 of 168',
  )
  await page.getByRole('button', { name: 'PDF table of contents', exact: true }).click()
  const host = await page.locator('.pdfViewer').elementHandle()
  const reads = () => page.evaluate(() => (window as unknown as { pdfReads: number }).pdfReads)
  const firstReads = await reads()
  await page.getByRole('tab', { name: 'Session note', exact: true }).click()
  await expect(page.getByRole('region', { name: 'PDF reader' })).toHaveCount(0)
  await page.keyboard.press('Control+f')
  await expect(page.getByRole('textbox', { name: 'Find in PDF', exact: true })).toHaveCount(0)
  await page.setViewportSize({ width: 900, height: 650 })
  await page.getByRole('tab', { name: 'first.pdf', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Find in PDF', exact: true })).toHaveValue(
    'quiet library',
  )
  await expect(page.getByRole('complementary', { name: 'PDF table of contents' })).toBeVisible()
  expect(await host!.evaluate((el) => el === document.querySelector('.pdfViewer'))).toBe(true)
  expect(await reads()).toBe(firstReads)
  await input.setInputFiles({
    name: 'second.pdf',
    mimeType: 'application/pdf',
    buffer: await readFile(fixture('large')),
  })
  await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toBeEnabled()
  await page.keyboard.press('Control+f')
  await expect(page.getByRole('textbox', { name: 'Find in PDF', exact: true })).toBeFocused()
  await page
    .getByRole('textbox', { name: 'Find in PDF', exact: true })
    .fill('Needle on the distant page')
  await expect(page.getByRole('textbox', { name: 'PDF page', exact: true })).toHaveValue('290')
  for (let i = 0; i < 3; i++) {
    await page.getByRole('tab', { name: 'first.pdf', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Find in PDF', exact: true })).toHaveValue(
      'quiet library',
    )
    await page.getByRole('tab', { name: 'second.pdf', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'PDF page', exact: true })).toHaveValue('290')
  }
  await expect.poll(() => page.workers().length).toBe(2)
  await page.getByRole('button', { name: 'Close first.pdf', exact: true }).press('Enter')
  await expect.poll(() => page.workers().length).toBe(1)
  expect(await host!.evaluate((el) => el.isConnected)).toBe(false)
  await page.locator('.pdf-sidebar-row').filter({ hasText: 'first.pdf' }).click()
  await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toBeEnabled()
  await expect(page.getByRole('textbox', { name: 'Find in PDF', exact: true })).toHaveCount(0)
  expect(await reads()).toBeGreaterThan(firstReads)
  expect(errors).toEqual([])
})

test('five PDF sessions keep a stable worker count and release canvas storage on close', async ({
  page,
}) => {
  test.setTimeout(90000)
  await page.goto('/')
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Performance.enable')
  const sample = async () => {
    await cdp.send('HeapProfiler.collectGarbage')
    const metrics = await cdp.send('Performance.getMetrics')
    return {
      mainThreadHeapMiB: metrics.metrics.find((m) => m.name === 'JSHeapUsedSize')!.value / 1048576,
      workers: page.workers().length,
      ...(await page.locator('.pdfViewer canvas').evaluateAll((canvases) => ({
        canvases: canvases.length,
        canvasPixelsMiB:
          canvases.reduce(
            (sum, el) =>
              sum + (el as HTMLCanvasElement).width * (el as HTMLCanvasElement).height * 4,
            0,
          ) / 1048576,
      }))),
    }
  }
  const baseline = await sample()
  for (let i = 0; i < 5; i++) {
    const bytes = await readFile(fixture(i % 2 ? 'large' : 'text'))
    await page.locator('input[type=file][accept="application/pdf,.pdf"]').setInputFiles({
      name: `memory-${i}.pdf`,
      mimeType: 'application/pdf',
      buffer: Buffer.concat([bytes, Buffer.from(`\n% session ${i}\n`)]),
    })
    await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toBeEnabled()
    await page.keyboard.press('Control+f')
    await page
      .getByRole('textbox', { name: 'Find in PDF', exact: true })
      .fill(i % 2 ? 'Needle on the distant page' : 'quiet library')
    await expect(page.getByRole('complementary', { name: 'PDF search results' })).toContainText(
      i % 2 ? '1 of 1' : '1 of 168',
    )
    await page.getByRole('textbox', { name: 'Find in PDF', exact: true }).press('Escape')
    await page.getByRole('textbox', { name: 'PDF page', exact: true }).fill(i % 2 ? '290' : '4')
    await page.getByRole('textbox', { name: 'PDF page', exact: true }).press('Enter')
    await expect(page.locator('.pdf-session:not([hidden]) canvas').first()).toBeVisible()
  }
  const opened = await sample()
  for (let round = 0; round < 3; round++) {
    for (let i = 0; i < 5; i++) {
      await page.getByRole('tab', { name: `memory-${i}.pdf`, exact: true }).click()
      await expect(page.getByRole('textbox', { name: 'PDF page', exact: true })).toHaveValue(
        i % 2 ? '290' : '4',
      )
    }
  }
  const switched = await sample()
  expect(switched.workers).toBe(5)
  for (let i = 0; i < 5; i++)
    await page.getByRole('button', { name: `Close memory-${i}.pdf`, exact: true }).press('Enter')
  await expect.poll(() => page.workers().length).toBe(0)
  const closed = await sample()
  expect(closed.canvases).toBe(0)
  const measurements = { baseline, opened, switched, closed }
  console.log('PDF memory measurements:', JSON.stringify(measurements))
  await test.info().attach('memory.json', {
    body: JSON.stringify(measurements, null, 2),
    contentType: 'application/json',
  })
})

test('a PDF finishing its initial load in the background resumes when selected', async ({
  page,
}) => {
  await page.addInitScript(() => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    Object.assign(window, { releasePdf: release })
    const slice = File.prototype.slice
    File.prototype.slice = function (...args) {
      const blob = slice.apply(this, args)
      const read = blob.arrayBuffer.bind(blob)
      blob.arrayBuffer = async () => {
        await gate
        return read()
      }
      return blob
    }
  })
  await page.goto('/')
  await page.getByRole('textbox', { name: 'Note title', exact: true }).fill('Loading note')
  await page.locator('input[type=file][accept="application/pdf,.pdf"]').setInputFiles({
    name: 'loading.pdf',
    mimeType: 'application/pdf',
    buffer: await readFile(fixture('text')),
  })
  await expect(page.getByText('Loading PDF…', { exact: true })).toBeVisible()
  await page.getByRole('tab', { name: 'Loading note', exact: true }).click()
  await page.evaluate(() => (window as unknown as { releasePdf: () => void }).releasePdf())
  await expect(page.locator('.pdf-session .pdf-page-controls input')).toBeEnabled()
  await page.getByRole('tab', { name: 'loading.pdf', exact: true }).click()
  await expect(page.locator('.pdf-session canvas').first()).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'PDF page', exact: true })).toHaveValue('1')
  expect(page.workers().length).toBe(1)
})
