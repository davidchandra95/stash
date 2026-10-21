import { expect, test, type Page } from '@playwright/test'

async function resetEditor(page: Page) {
  await page.locator('.tiptap').evaluate((dom) => {
    const editor = (
      dom as HTMLElement & {
        editor: { commands: { setContent: (html: string) => void; focus: () => void } }
      }
    ).editor
    editor.commands.setContent('<p></p>')
    editor.commands.focus()
  })
}

for (const mobile of [false, true]) {
  test(`${mobile ? 'mobile' : 'desktop'} confirms tags only by Enter or click`, async ({
    page,
  }) => {
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 })
    await page.goto(mobile ? '/?mobile=1' : '/')
    await page
      .locator(mobile ? '.mobile-note-label' : '.note-row[data-note-id="writing-lab"]')
      .first()
      .click()
    await resetEditor(page)
    await page.keyboard.type('#thisisanewtag')
    const menu = page.locator('.body-tag-menu:visible')
    await expect(menu).toBeVisible()
    await expect(page.locator('.tiptap [data-body-tag]')).toHaveCount(0)
    const box = (await menu.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(mobile ? 390 : 1280)
    await page.screenshot({ path: test.info().outputPath('tag-suggestion.png') })
    await page.keyboard.press('Enter')
    await expect(page.locator('.tiptap [data-body-tag]')).toHaveText('#thisisanewtag')
    await page.keyboard.type(' #thisisnotatag')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Enter')
    await page.keyboard.type('#clickedtag')
    await menu.getByRole('option', { name: 'Create new tag "#clickedtag"' }).click()
    await expect(page.locator('.tiptap [data-body-tag]')).toHaveCount(2)
    await page.screenshot({ path: test.info().outputPath('confirmed-and-plain.png') })
    await page.locator('.tiptap').evaluate((dom) => {
      const data = new DataTransfer()
      data.setData('text/html', '<p style="color:#abcdef">#external #abcdef</p>')
      data.setData('text/plain', '#external #abcdef')
      dom.dispatchEvent(
        new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }),
      )
    })
    await expect(menu).toHaveCount(0)
    await expect(page.locator('.tiptap [data-body-tag]')).toHaveCount(2)
  })
}

test('real copy and cut preserve only confirmed tags between notes', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/')
  await page.locator('.note-row[data-note-id="writing-lab"]').click()
  await resetEditor(page)
  await page.keyboard.type('#confirmed')
  await page.keyboard.press('Enter')
  await page.keyboard.type(' #abcdef #plain')
  await page.keyboard.press('Escape')
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
  await page.keyboard.press(`${mod}+a`)
  await page.keyboard.press(`${mod}+c`)
  await page.locator('.note-row[data-note-id="welcome"]').click()
  await resetEditor(page)
  await page.keyboard.press(`${mod}+v`)
  await expect(page.locator('.tiptap')).toHaveText('#confirmed #abcdef #plain')
  await expect(page.locator('.tiptap [data-body-tag]')).toHaveText('#confirmed')
  await page.keyboard.press(`${mod}+a`)
  await page.keyboard.press(`${mod}+x`)
  await expect(page.locator('.tiptap [data-body-tag]')).toHaveCount(0)
  await page.locator('.note-row[data-note-id="writing-lab"]').click()
  await resetEditor(page)
  await page.keyboard.press(`${mod}+v`)
  await expect(page.locator('.tiptap [data-body-tag]')).toHaveText('#confirmed')
  await resetEditor(page)
  await page.keyboard.press(`${mod}+Shift+v`)
  await expect(page.locator('.tiptap')).toHaveText('#confirmed #abcdef #plain')
  await expect(page.locator('.tiptap [data-body-tag]')).toHaveCount(0)
})

test('long tag choices fit narrow windows in light and dark color modes', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 650 })
  await page.goto('/')
  await page.locator('.note-row[data-note-id="writing-lab"]').click()
  await resetEditor(page)
  await page.keyboard.type('#' + 'longtag'.repeat(20))
  const menu = page.locator('.body-tag-menu:visible')
  for (const colorMode of ['light', 'dark'] as const) {
    await page.evaluate(async (colorMode) => {
      const url = performance
        .getEntriesByType('resource')
        .find((entry) => new URL(entry.name).pathname === '/src/storage/useLibrary.ts')!.name
      const { library } = await import(/* @vite-ignore */ url)
      library.setAppearance({ ...library.getSnapshot().appearance, colorMode })
    }, colorMode)
    // Continue the typed candidate after the appearance update.
    await page.keyboard.type('x')
    await expect(page.locator('html')).toHaveAttribute('data-theme', colorMode)
    await expect(menu).toBeVisible()
    const box = (await menu.boundingBox())!
    expect(box.x + box.width).toBeLessThanOrEqual(900)
    expect(box.y + box.height).toBeLessThanOrEqual(650)
    expect(await menu.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
  }
  await page.screenshot({ path: test.info().outputPath('long-tag-narrow.png') })
})
