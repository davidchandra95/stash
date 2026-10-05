import { test, expect, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
async function open(page: Page, name = 'text') {
  await page.goto('/')
  await page
    .locator('input[type=file][accept="application/pdf,.pdf"]')
    .setInputFiles(fileURLToPath(new URL(`./fixtures/${name}.pdf`, import.meta.url)))
  await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toBeEnabled()
  await expect(page.locator('.pdf-session:not([hidden]) .textLayer span').first()).toBeVisible()
}
async function select(page: Page, number = 1, multi = false) {
  await page.getByRole('textbox', { name: 'PDF page', exact: true }).fill(String(number))
  await page.getByRole('textbox', { name: 'PDF page', exact: true }).press('Enter')
  await page
    .locator(`.pdf-session:not([hidden]) .page[data-page-number="${number}"] .textLayer span`)
    .first()
    .waitFor()
  await page.locator('.pdf-session:not([hidden]) .pdf-scroll').focus()
  return page.evaluate(
    ({ number, multi }) => {
      const first = document.querySelector(
        `.pdf-session:not([hidden]) .page[data-page-number="${number}"] .textLayer span`,
      )!
      const range = document.createRange()
      range.selectNodeContents(first)
      if (multi) {
        const spans = document.querySelectorAll(
          `.pdf-session:not([hidden]) .page[data-page-number="${number + 1}"] .textLayer span`,
        )
        const last = spans[spans.length - 1]
        range.setEnd(last.firstChild!, last.textContent!.length)
      }
      getSelection()!.removeAllRanges()
      getSelection()!.addRange(range)
      return getSelection()!.toString()
    },
    { number, multi },
  )
}
test('paired capture preserves reading focus and drafts, clears selection, citations repeat, normal editor undo works', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await open(page)
  await expect(page.getByRole('button', { name: 'Take notes', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Companion note' })).toHaveCount(0)
  const text = await select(page)
  await page.getByRole('button', { name: 'Add quote to note', exact: true }).click()
  const editor = page.locator('.tiptap[aria-label="Note content"]')
  await expect(editor.locator('blockquote')).toContainText(text, { useInnerText: true })
  await expect(page.getByLabel('Note title', { exact: true })).toHaveValue('text - Notes')
  await expect(page.locator('.pdf-session:not([hidden]) .pdf-scroll')).toBeFocused()
  expect(await page.evaluate(() => getSelection()!.toString())).toBe('')
  await expect(page.getByRole('button', { name: 'Add quote to note', exact: true })).toBeDisabled()
  await expect(page.getByText('Added to note', { exact: true })).toHaveCount(0)
  await editor.click()
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(editor.locator('blockquote')).toHaveCount(0)
  await editor.locator('p').last().click()
  await page.keyboard.type('Later writing. ')
  await select(page, 3)
  const readerBounds = await page.locator('.pdf-session:not([hidden]) .pdf-scroll').boundingBox()
  await page.getByRole('button', { name: 'Add quote to note', exact: true }).click()
  await expect(editor.locator('blockquote')).toHaveCount(1)
  await expect(page.getByText('Added to note', { exact: true })).toHaveCount(0)
  expect(await page.locator('.pdf-session:not([hidden]) .pdf-scroll').boundingBox()).toEqual(
    readerBounds,
  )
  await editor.locator('p').last().click()
  await expect(editor).toBeFocused()
  const citation = editor.locator('blockquote p').getByRole('link', { name: '(p. 3)', exact: true })
  for (let i = 0; i < 2; i++) {
    await page.getByRole('textbox', { name: 'PDF page', exact: true }).fill('1')
    await page.getByRole('textbox', { name: 'PDF page', exact: true }).press('Enter')
    await citation.click()
    await expect(page.getByRole('textbox', { name: 'PDF page', exact: true })).toHaveValue('3')
    await expect(page.locator('.pdf-citation-region').first()).toBeVisible()
  }
  await page.screenshot({ path: test.info().outputPath('paired-1280.png') })
  await page.getByRole('button', { name: 'Hide notes', exact: true }).click()
  await page.getByRole('button', { name: 'Show notes', exact: true }).click()
  await expect(editor).toContainText('Later writing.')
  await expect(editor.locator('blockquote')).toHaveCount(1)
  const divider = page.getByRole('separator', { name: 'Resize PDF and notes' })
  await divider.focus()
  await divider.press('ArrowLeft')
  await page.setViewportSize({ width: 900, height: 650 })
  await expect(page.getByRole('group', { name: 'Reading and writing' })).toBeVisible()
  await page.getByRole('button', { name: 'Notes', exact: true }).click()
  await expect(editor).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('paired-900.png') })
  await page.getByRole('button', { name: 'PDF', exact: true }).click()
  await expect(page.locator('.pdf-session:not([hidden]) .pdf-scroll')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(errors).toEqual([])
})
test('rotated geometry and multipage quotes return to their source, Find follows focus', async ({
  page,
}) => {
  await open(page, 'rotated')
  await page.getByRole('button', { name: 'Take notes', exact: true }).click()
  const editor = page.locator('.tiptap[aria-label="Note content"]')
  await select(page, 2)
  await page.getByRole('button', { name: 'Add quote to note', exact: true }).click()
  const link = editor.locator('blockquote p').getByRole('link', { name: '(p. 2)', exact: true })
  await expect(link).toBeVisible()
  await link.click()
  await expect(page.locator('.pdf-citation-region').first()).toBeVisible()
  expect(await page.getByRole('alert').allTextContents()).not.toContain(
    'This citation contains a region outside its PDF page.',
  )
  await editor.click()
  await page.keyboard.press('Control+f')
  await expect(
    page.getByRole('textbox', { name: 'Find in current note', exact: true }),
  ).toBeFocused()
  await page.locator('.pdf-session:not([hidden]) .pdf-scroll').focus()
  await page.keyboard.press('Control+f')
  await expect(page.getByRole('textbox', { name: 'Find in PDF', exact: true })).toBeFocused()
  await page
    .locator('input[type=file][accept="application/pdf,.pdf"]')
    .setInputFiles(fileURLToPath(new URL('./fixtures/text.pdf', import.meta.url)))
  await expect(
    page.locator('.pdf-session:not([hidden]) .page[data-page-number="2"] .textLayer span').first(),
  ).toBeAttached()
  const text = await select(page, 1, true)
  await page.getByRole('button', { name: 'Add quote to note', exact: true }).click()
  await expect(
    editor.locator('blockquote p').getByRole('link', { name: '(pp. 1–2)', exact: true }),
  ).toBeVisible()
  await expect(editor.locator('blockquote')).toContainText(text, { useInnerText: true })
})
test('page references, normal-note Open PDF, trash recovery and close/reopen retain ownership', async ({
  page,
}) => {
  await page.goto('/')
  await page
    .locator('input[type=file][accept="application/pdf,.pdf"]')
    .setInputFiles(fileURLToPath(new URL('./fixtures/scanned.pdf', import.meta.url)))
  await expect(page.getByRole('button', { name: 'Add page reference', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Add page reference', exact: true }).click()
  await expect(page.getByLabel('Note title', { exact: true })).toHaveValue('scanned - Notes')
  await expect(
    page.locator('.tiptap > p').getByRole('link', { name: '(p. 1)', exact: true }),
  ).toBeVisible()
  await expect(page.locator('.tiptap blockquote')).toHaveCount(0)
  await expect(page.getByText('Added to note', { exact: true })).toHaveCount(0)
  await page.getByLabel('Note title', { exact: true }).fill('Renamed companion')
  await page.getByRole('button', { name: 'Close scanned.pdf', exact: true }).click()
  await page.locator('.note-row').filter({ hasText: 'Renamed companion' }).click()
  await expect(page.getByLabel('Note title', { exact: true })).toHaveValue('Renamed companion')
  await page
    .locator('.header-actions')
    .getByRole('button', { name: 'Open PDF', exact: true })
    .click()
  await expect(page.getByRole('tab', { name: 'scanned.pdf', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(page.getByLabel('Note title', { exact: true })).toHaveValue('Renamed companion')
  await page.getByLabel('Note title', { exact: true }).focus()
  // Move to Trash through the existing note action menu.
  await page.getByRole('button', { name: 'Note actions', exact: true }).click()
  await page.getByRole('menuitem', { name: /Move to trash/i }).click()
  await expect(
    page
      .locator('.pdf-session:not([hidden]) .pdf-toolbar')
      .getByRole('button', { name: 'Restore note', exact: true }),
  ).toBeVisible()
  await page
    .locator('.pdf-session:not([hidden]) .pdf-toolbar')
    .getByRole('button', { name: 'Restore note', exact: true })
    .click()
  await expect(page.getByLabel('Note title', { exact: true })).toHaveValue('Renamed companion')
  await expect(page.getByRole('button', { name: 'Hide notes', exact: true })).toBeVisible()
})

test('citations in other notes keep the originating tab and reject unavailable or invalid sources inside the app', async ({
  page,
}) => {
  await open(page)
  await page.getByRole('button', { name: 'Add page reference', exact: true }).click()
  const href = await page.locator('.tiptap a').last().getAttribute('href')
  await page.keyboard.press('Control+n')
  await page.getByLabel('Note title', { exact: true }).fill('Citation collection')
  await page.evaluate(async (href) => {
    const { library } = await import('/src/storage/useLibrary.ts')
    const { getEditor } = await import('/src/editor/session.ts')
    const note = library
      .getSnapshot()
      .notes.find((n: { title: string }) => n.title === 'Citation collection')!
    getEditor(note.id, note.content).commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Copied source', marks: [{ type: 'link', attrs: { href } }] },
          ],
        },
      ],
    })
  }, href)
  await page.getByRole('link', { name: 'Copied source', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'text.pdf', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(page.getByRole('tab', { name: 'Citation collection', exact: true })).toBeVisible()
  // Exercise the same citation event boundary with bad synced targets.
  await page.evaluate(
    (href) =>
      document.dispatchEvent(
        new CustomEvent('pdf-citation', { detail: href!.replace('page=1', 'page=99999') }),
      ),
    href,
  )
  await expect(
    page.getByText('This citation points to a page that is not in this PDF.', { exact: false }),
  ).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'PDF page', exact: true })).toBeEnabled()
  await page.evaluate(
    (href) =>
      document.dispatchEvent(
        new CustomEvent('pdf-citation', { detail: href!.replace('/v1/', '/v99/') }),
      ),
    href,
  )
  await expect(page.getByText('This PDF citation is malformed', { exact: false })).toBeVisible()
  await page.evaluate((href) => {
    const u = new URL(href!)
    u.pathname = '/v1/missing'
    u.searchParams.set('fingerprint', 'f'.repeat(64))
    document.dispatchEvent(new CustomEvent('pdf-citation', { detail: u.href }))
  }, href)
  await expect(
    page.getByText('This PDF is unavailable on this device.', { exact: false }),
  ).toBeVisible()
})

test('opening and resizing notes keeps the reading anchor and clears the captured selection', async ({
  page,
}) => {
  await open(page)
  await select(page, 4)
  await page.locator('.pdf-session:not([hidden]) .pdf-scroll').evaluate((el) => {
    el.scrollTop += 180
  })
  const read = () =>
    page.evaluate(() => {
      const scroll = document.querySelector<HTMLElement>('.pdf-session:not([hidden]) .pdf-scroll')!
      const div = document.querySelector<HTMLElement>(
        '.pdf-session:not([hidden]) .page[data-page-number="4"]',
      )!
      return {
        y: (scroll.scrollTop - div.offsetTop) / div.clientHeight,
        selected: getSelection()!.toString(),
      }
    })
  const before = await read()
  await page.getByRole('button', { name: 'Add quote to note', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Hide notes', exact: true })).toBeVisible()
  await expect.poll(async () => Math.abs((await read()).y - before.y)).toBeLessThan(0.02)
  expect((await read()).selected).toBe('')
  const divider = page.getByRole('separator', { name: 'Resize PDF and notes' })
  await divider.click()
  await divider.press('ArrowLeft')
  await expect(divider).toHaveAttribute('aria-valuenow', '57')
  await expect.poll(async () => Math.abs((await read()).y - before.y)).toBeLessThan(0.02)
  expect((await read()).selected).toBe('')
  const bounds = (await divider.boundingBox())!
  const x = bounds.x + bounds.width / 2
  const y = bounds.y + bounds.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 40, y, { steps: 8 })
  await page.mouse.up()
  expect(Number(await divider.getAttribute('aria-valuenow'))).toBeGreaterThan(57)
  await expect.poll(async () => Math.abs((await read()).y - before.y)).toBeLessThan(0.02)
  expect((await read()).selected).toBe('')
})

test('deselecting PDF text disables the visible quote button and cannot restore an old quote', async ({
  page,
}) => {
  await open(page)
  const quote = page.getByRole('button', { name: 'Add quote to note', exact: true })
  await expect(quote).toBeVisible()
  await expect(quote).toBeDisabled()
  await select(page)
  await expect(quote).toBeEnabled()
  await page.locator('.pdf-session:not([hidden]) .textLayer span').first().click()
  await expect(quote).toBeDisabled()
  await expect(quote).toBeVisible()
  expect(await page.evaluate(() => getSelection()!.toString())).toBe('')
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await expect(page.getByLabel('PDF zoom')).not.toHaveValue('1')
  await expect(quote).toBeDisabled()
  expect(await page.evaluate(() => getSelection()!.toString())).toBe('')

  // Clear and activate in the same task, before selectionchange can update the button.
  for (const collapse of [true, false]) {
    await select(page)
    await expect(quote).toBeEnabled()
    await quote.evaluate((button: HTMLButtonElement, collapse) => {
      if (collapse) getSelection()!.collapseToEnd()
      else getSelection()!.removeAllRanges()
      button.click()
    }, collapse)
    await expect(quote).toBeDisabled()
    await expect(page.getByRole('region', { name: 'Companion note' })).toHaveCount(0)
  }

  // Replacing a selection and immediately capturing must use the new text.
  await select(page)
  await expect(quote).toBeEnabled()
  const text = await quote.evaluate((button: HTMLButtonElement) => {
    const span = document.querySelector('.pdf-session:not([hidden]) .textLayer span')!
    const range = document.createRange()
    range.setStart(span.firstChild!, 1)
    range.setEnd(span.firstChild!, 5)
    getSelection()!.removeAllRanges()
    getSelection()!.addRange(range)
    const text = getSelection()!.toString()
    button.click()
    return text
  })
  await expect(page.locator('.tiptap blockquote')).toHaveText(`${text} (p. 1)`)
  await expect(quote).toBeDisabled()
})

test('valid PDF selection survives zoom and fit-width reflow, but selection outside the PDF disables capture', async ({
  page,
}) => {
  await open(page)
  const text = await select(page)
  const quote = page.getByRole('button', { name: 'Add quote to note', exact: true })
  await expect(quote).toBeEnabled()
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await expect(quote).toBeEnabled()
  await expect.poll(() => page.evaluate(() => getSelection()!.toString())).toBe(text)
  await page.getByRole('button', { name: 'Fit width', exact: true }).click()
  await page.setViewportSize({ width: 900, height: 650 })
  await expect(quote).toBeEnabled()
  await expect.poll(() => page.evaluate(() => getSelection()!.toString())).toBe(text)
  await page.getByRole('button', { name: 'Take notes', exact: true }).click()
  const paneSwitch = page.getByRole('button', { name: 'Notes', exact: true })
  if (await paneSwitch.isVisible()) await paneSwitch.click()
  const editor = page.locator('.tiptap[aria-label="Note content"]')
  await editor.click()
  await page.keyboard.type('Outside PDF')
  await editor.evaluate((el) => {
    const range = document.createRange()
    range.selectNodeContents(el)
    getSelection()!.removeAllRanges()
    getSelection()!.addRange(range)
  })
  const pdfSwitch = page.getByRole('button', { name: 'PDF', exact: true })
  if (await pdfSwitch.isVisible()) await pdfSwitch.click()
  await expect(quote).toBeDisabled()
})

test('quote selection is consumed once for rapid and keyboard actions, and stays cleared after zoom', async ({
  page,
}) => {
  await open(page)
  await select(page)
  const quote = page.getByRole('button', { name: 'Add quote to note', exact: true })
  await expect(quote).toBeEnabled()
  await quote.evaluate((button: HTMLButtonElement) => {
    button.click()
    button.click()
    button.click()
  })
  const blocks = page.locator('.tiptap blockquote')
  await expect(blocks).toHaveCount(1)
  await expect(quote).toBeVisible()
  await expect(quote).toBeDisabled()
  expect(await page.evaluate(() => getSelection()!.toString())).toBe('')
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await expect(page.getByLabel('PDF zoom')).not.toHaveValue('1')
  // Wait for the text layer to be rebuilt before checking the saved range cannot return.
  await page
    .locator('.pdf-session:not([hidden]) .textLayer span')
    .first()
    .waitFor({ state: 'visible' })
  await expect(quote).toBeVisible()
  await expect(quote).toBeDisabled()
  expect(await page.evaluate(() => getSelection()!.toString())).toBe('')
  await select(page)
  await quote.focus()
  await quote.press('Enter')
  await expect(blocks).toHaveCount(2)
  await expect(quote).toBeVisible()
  await expect(quote).toBeDisabled()
  await expect(page.locator('.pdf-session:not([hidden]) .pdf-scroll')).toBeFocused()
  expect(await page.evaluate(() => getSelection()!.toString())).toBe('')
})

test('failed quote capture keeps the selection available for retry', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'Take notes', exact: true }).click()
  await expect(page.locator('.tiptap')).toBeVisible()
  const text = await select(page)
  await page.evaluate(async () => {
    const { library } = await import('/src/storage/useLibrary.ts')
    const load = library.load
    library.load = async () => {
      library.load = load
      throw Error('Capture test load failure')
    }
  })
  const quote = page.getByRole('button', { name: 'Add quote to note', exact: true })
  await quote.click()
  await expect(page.getByText('Capture test load failure', { exact: false })).toBeVisible()
  await expect(quote).toBeEnabled()
  await expect(page.locator('.tiptap blockquote')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => getSelection()!.toString())).toBe(text)
  await quote.click()
  await expect(page.locator('.tiptap blockquote')).toHaveCount(1)
  await expect(quote).toBeVisible()
  await expect(quote).toBeDisabled()
  expect(await page.evaluate(() => getSelection()!.toString())).toBe('')
})

test('compact PDF toolbar keeps icon actions aligned and keyboard accessible across layouts', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await open(page)
  const toolbar = page.locator('.pdf-session:not([hidden]) .pdf-toolbar')
  const notes = toolbar.getByRole('button', { name: 'Take notes', exact: true })
  await expect(page.locator('.pdf-document-header')).toHaveCount(0)
  await expect(toolbar.locator('button')).toHaveCount(6)
  for (const button of await toolbar.locator('button').all()) {
    await expect(button).not.toHaveAttribute('title')
    await expect(button).toHaveAttribute('aria-label', /.+/)
    expect(await button.innerText()).toBe('')
  }
  await toolbar.getByRole('button', { name: 'Add page reference', exact: true }).focus()
  await page.keyboard.press('Tab')
  await expect(toolbar.getByRole('button', { name: 'Focus mode', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(toolbar.getByRole('button', { name: 'Find in PDF', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(notes).toBeFocused()
  await page.keyboard.press('Enter')
  const hideNotes = toolbar.getByRole('button', { name: 'Hide notes', exact: true })
  await expect(hideNotes).toHaveAttribute('aria-expanded', 'true')
  await expect(hideNotes.locator('.lucide-panel-right-close')).toHaveCount(1)
  await select(page)
  const before = await hideNotes.boundingBox()
  await toolbar.getByRole('button', { name: 'Add quote to note', exact: true }).click()
  await expect(
    toolbar.getByRole('button', { name: 'Add quote to note', exact: true }),
  ).toBeDisabled()
  expect(await hideNotes.boundingBox()).toEqual(before)
  await toolbar.getByRole('button', { name: 'Focus mode', exact: true }).click()
  await expect(
    toolbar.getByRole('button', { name: 'Exit focus mode', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await toolbar.getByRole('button', { name: 'Exit focus mode', exact: true }).click()
  for (const width of [1280, 900, 680]) {
    await page.setViewportSize({ width, height: width === 1280 ? 800 : 650 })
    const paneSwitch = page.getByRole('button', { name: 'PDF', exact: true })
    if (await paneSwitch.isVisible()) await paneSwitch.click()
    for (const mode of ['light', 'dark']) {
      for (const style of ['default', 'cards']) {
        await page.evaluate(
          ({ mode, style }) => {
            document.querySelector<HTMLElement>('.app')!.dataset.theme = mode
            document.documentElement.dataset.appStyle = style
          },
          { mode, style },
        )
        await expect(async () => {
          const { bounds, boxes } = await toolbar.evaluate((element) => ({
            bounds: element.getBoundingClientRect().toJSON(),
            boxes: [...element.querySelectorAll('button')].map((button) =>
              button.getBoundingClientRect().toJSON(),
            ),
          }))
          expect(bounds.width).toBeGreaterThan(0)
          for (const box of boxes) {
            expect(Math.abs(box.y - boxes[0].y)).toBeLessThan(1)
            expect(box.x).toBeGreaterThanOrEqual(bounds.x)
            expect(box.right).toBeLessThanOrEqual(bounds.right)
          }
          expect(boxes[4].x).toBeGreaterThan(boxes[3].right)
          for (const [left, right] of [
            [0, 1],
            [1, 2],
            [2, 3],
            [4, 5],
          ]) {
            expect(boxes[right].x - boxes[left].right).toBeCloseTo(4, 0)
          }
          expect(bounds.right - boxes[5].right).toBeLessThan(20)
        }).toPass({ timeout: 5000 })
        await page.screenshot({
          path: test.info().outputPath(`toolbar-${width}-${mode}-${style}.png`),
        })
      }
    }
  }
  await toolbar.getByRole('button', { name: 'Find in PDF', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(toolbar.getByRole('button', { name: 'Find in PDF', exact: true })).toHaveAttribute(
    'aria-expanded',
    'true',
  )
})

test('PDF icon tooltips open instantly for hover, keyboard and disabled controls', async ({
  page,
}) => {
  await open(page)
  const toolbar = page.locator('.pdf-session:not([hidden]) .pdf-toolbar')
  const notes = toolbar.getByRole('button', { name: 'Take notes', exact: true })
  await expect(notes.locator('.lucide-panel-right-open')).toHaveCount(1)
  await notes.hover()
  await expect(page.getByRole('tooltip')).toHaveText('Take notes', { timeout: 250 })
  await page.keyboard.press('Escape')
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  await notes.click()
  const hide = toolbar.getByRole('button', { name: 'Hide notes', exact: true })
  await hide.click()
  const show = toolbar.getByRole('button', { name: 'Show notes', exact: true })
  await expect(show.locator('.lucide-panel-right-open')).toHaveCount(1)
  await page.mouse.move(0, 0, { steps: 5 })
  await show.focus()
  await expect(page.getByRole('tooltip')).toHaveText('Show notes')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  const quote = toolbar.getByRole('button', { name: 'Add quote to note', exact: true })
  await expect(quote).toBeDisabled()
  await quote.locator('..').hover()
  await expect(page.getByRole('tooltip')).toHaveText('Add quote to note', { timeout: 250 })
  await quote.locator('..').click()
  await expect(quote).toBeDisabled()
  const zoom = page.getByRole('button', { name: 'Zoom in', exact: true })
  await zoom.hover()
  await expect(page.getByRole('tooltip')).toHaveText('Zoom in')
  await expect(page.locator('.app-tooltip')).toHaveAttribute('data-side', 'top')
  await page.locator('.app-tooltip').hover()
  await expect(page.getByRole('tooltip')).toHaveText('Zoom in')
  await expect(page.locator('.pdf-toolbar [title], .pdf-bottom-toolbar [title]')).toHaveCount(0)
  await page.mouse.move(0, 0, { steps: 5 })
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  const text = await select(page)
  await quote.hover()
  await expect(page.getByRole('tooltip')).toHaveText('Add quote to note', { timeout: 250 })
  expect(await page.evaluate(() => getSelection()!.toString())).toBe(text)
  await quote.click()
  await expect(page.locator('.tiptap blockquote')).toContainText(text)
})

test('text tooltips retain their hover delay after using an instant icon', async ({ page }) => {
  await open(page)
  const label = page.locator('.app-tooltip > .app-tooltip-label')
  const icon = page.getByRole('button', { name: 'Zoom in', exact: true })
  await icon.hover()
  await expect(label).toHaveText('Zoom in', { timeout: 250 })
  await page.mouse.move(0, 0, { steps: 5 })
  await expect(label).toHaveCount(0)
  await page.getByRole('combobox', { name: 'PDF zoom', exact: true }).hover()
  await expect(label).toHaveCount(0)
  await expect(label).toHaveText('Zoom percentage', { timeout: 1500 })
  await page.mouse.move(0, 0, { steps: 5 })
  await expect(label).toHaveCount(0)
  const tab = page.locator('.note-tab [role="tab"]').first()
  const title = await tab.innerText()
  await tab.hover()
  await expect(label).toHaveCount(0)
  await expect(label).toHaveText(title, { timeout: 1500 })
  await page.keyboard.press('Escape')
  await expect(label).toHaveCount(0)
})
