import { test, expect } from '@playwright/test'

test('keeps the canvas usable across desktop sizes, palettes, and app styles', async ({ page }) => {
  test.setTimeout(180000)
  await page.goto('/')
  await page.getByRole('button', { name: 'New note', exact: true }).first().click()
  await page.locator('.tiptap[contenteditable="true"]').first().click()
  await page.keyboard.type('/drawing')
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Drawing', exact: true })
  await expect(dialog.locator('.excalidraw')).toBeVisible()
  for (const width of [1280, 900]) {
    await page.setViewportSize({ width, height: width === 900 ? 650 : 800 })
    for (const appStyle of ['default', 'cards']) {
      for (const dark of [false, true]) {
        for (const theme of [
          'classic',
          'zen',
          'financial',
          'tiktok',
          'catppuccin',
          'lastchat',
          'qrafthive',
        ]) {
          await page.evaluate(
            async ({ appStyle, dark, theme }) => {
              const path = '/src/storage/useLibrary.ts'
              const { library } = await import(path)
              library.setAppearance({ ...library.getSnapshot().appearance, appStyle, dark, theme })
            },
            { appStyle, dark, theme },
          )
          await dialog.getByRole('button', { name: 'Close drawing' }).click()
          const edit = page.getByRole('button', { name: 'Edit drawing', exact: true })
          await expect(edit).toBeInViewport()
          const editBounds = (await edit.boundingBox())!
          const previewBounds = (await page.locator('.drawing-preview').boundingBox())!
          expect(editBounds.y + editBounds.height).toBeLessThanOrEqual(previewBounds.y)
          if (appStyle === 'cards' && theme === 'qrafthive')
            await page.screenshot({
              path: `.artifact-work/drawing-block-${width}-${dark ? 'dark' : 'light'}.png`,
            })
          await edit.click()
          await expect(dialog.locator('.excalidraw')).toBeVisible()
          await expect(dialog).toHaveAttribute('data-theme', dark ? 'dark' : 'light')
          await expect(dialog.getByRole('button', { name: 'Close drawing' })).toBeInViewport()
          expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
        }
        if (appStyle === 'cards')
          await page.screenshot({
            path: `.artifact-work/drawing-${width}-${dark ? 'dark' : 'light'}.png`,
          })
      }
    }
  }
  await dialog.getByRole('button', { name: 'Close drawing' }).click()
  await expect(page.locator('.tiptap')).toBeFocused()
})

test('draws offline, saves previews, reopens editable content, and preserves note typing', async ({
  page,
}) => {
  const errors: string[] = [],
    remote: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  // Use the file-input path available in the native WebView as well as browsers.
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, 'showOpenFilePicker')
  })
  await page.route('**/*', (route) => {
    if (!new URL(route.request().url()).hostname.match(/^(127\.0\.0\.1|localhost)$/)) {
      remote.push(route.request().url())
      return route.abort()
    }
    return route.continue()
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'New note', exact: true }).first().click()
  // Tiptap uses a contenteditable region without an explicit textbox role.
  const body = page.locator('.tiptap[contenteditable="true"]').first()
  await body.click()
  await page.keyboard.type('/drawing')
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Drawing', exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('.excalidraw')).toBeVisible()
  await expect(dialog.getByRole('checkbox', { name: 'Library', exact: true })).not.toBeVisible()
  await page.screenshot({ path: '.artifact-work/drawing-canvas-dark.png' })
  await dialog
    .getByTitle(/Rectangle/)
    .first()
    .click()
  const canvas = dialog.locator('canvas.interactive')
  await expect(canvas).toBeVisible()
  const bounds = (await canvas.boundingBox())!
  await page.mouse.move(bounds.x + bounds.width * 0.42, bounds.y + 180)
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width * 0.65, bounds.y + 310, { steps: 8 })
  await page.mouse.up()
  const imageData = await page.evaluate(() => {
    const image = document.createElement('canvas')
    image.width = 64
    image.height = 64
    const context = image.getContext('2d')!
    context.fillStyle = '#216f9c'
    context.fillRect(0, 0, 64, 64)
    return image.toDataURL('image/png').split(',')[1]
  })
  const chooser = page.waitForEvent('filechooser')
  await dialog
    .getByTitle(/Insert image/)
    .first()
    .click()
  await (
    await chooser
  ).setFiles({
    name: 'drawing-test.png',
    mimeType: 'image/png',
    buffer: Buffer.from(imageData, 'base64'),
  })
  await canvas.click({ position: { x: bounds.width * 0.53, y: 230 } })
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const path = '/src/storage/useLibrary.ts'
        const { library } = await import(path)
        return library
          .getSnapshot()
          .notes.some((note: { content: unknown }) =>
            JSON.stringify(note.content).includes('data:image/png;base64'),
          )
      }),
    )
    .toBe(true)
  await dialog.getByRole('button', { name: 'Close drawing', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.locator('.drawing-preview img')).toBeVisible()
  const dimensions = await page
    .locator('.drawing-preview img')
    .evaluate((image: HTMLImageElement) => [image.naturalWidth, image.naturalHeight])
  expect(Math.max(...dimensions)).toBeLessThanOrEqual(1600)
  await page.locator('.drawing-preview').click()
  await expect(dialog).not.toBeVisible()
  await page.locator('.drawing-preview').dblclick()
  await expect(dialog).not.toBeVisible()
  await page.getByRole('button', { name: 'Edit drawing', exact: true }).click()
  await expect(dialog.locator('.excalidraw')).toBeVisible()
  await dialog
    .getByTitle(/Rectangle/)
    .first()
    .click()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  for (const key of ['Enter', 'Space']) {
    await page.getByRole('button', { name: 'Edit drawing', exact: true }).focus()
    await page.keyboard.press(key)
    await expect(dialog.locator('.excalidraw')).toBeVisible()
    await dialog.getByRole('button', { name: 'Close drawing' }).click()
    await expect(dialog).not.toBeVisible()
  }
  await page.locator('.drawing-preview').click()
  await page.keyboard.press('Enter')
  await expect(dialog.locator('.excalidraw')).toBeVisible()
  await dialog.getByRole('button', { name: 'Close drawing' }).click()
  await body.locator('p').last().click()
  await page.keyboard.type('After the drawing')
  await expect(body).toContainText('After the drawing')
  await page.screenshot({ path: '.artifact-work/drawing-desktop.png' })
  // The browser preview is session-only, so transfer the saved note to a new mobile preview.
  const note = await page.evaluate(async () => {
    const modulePath = '/src/storage/useLibrary.ts'
    const { library } = await import(modulePath)
    return structuredClone(
      library
        .getSnapshot()
        .notes.find((note: { content: unknown }) =>
          JSON.stringify(note.content).includes('"drawing"'),
        ),
    )
  })
  expect(
    Object.keys(
      note.content.content.find((node: { type: string }) => node.type === 'drawing').attrs.data
        .scene.files,
    ),
  ).toHaveLength(1)
  await page.goto('/?mobile=1')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(async (note) => {
    const modulePath = '/src/storage/useLibrary.ts'
    const { library } = await import(modulePath)
    library.setNotes([{ ...note, title: 'Mobile drawing check' }])
  }, note)
  await page.getByText('Mobile drawing check', { exact: true }).first().click()
  await page.getByRole('button', { name: 'Open drawing', exact: true }).click()
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('img[alt="Drawing"]')).toBeVisible()
  await expect(dialog.locator('.excalidraw')).toHaveCount(0)
  await page.screenshot({ path: '.artifact-work/drawing-mobile.png' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.setViewportSize({ width: 844, height: 390 })
  await expect(dialog.getByRole('button', { name: 'Close drawing' })).toBeVisible()
  await page.screenshot({ path: '.artifact-work/drawing-mobile-landscape.png' })
  expect(remote).toEqual([])
  expect(errors).toEqual([])
})
