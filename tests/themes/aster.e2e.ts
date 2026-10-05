import { test, expect, type Locator, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'

async function settings(page: Page) {
  await page.locator('.account-trigger').click()
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click()
}

async function appearance(page: Page, dark: boolean, cards = false) {
  await settings(page)
  await page.getByLabel('Theme', { exact: true }).selectOption('aster')
  await page.getByRole('button', { name: dark ? 'Dark' : 'Light', exact: true }).click()
  await page.locator(`input[name="app-style"][value="${cards ? 'cards' : 'default'}"]`).check()
  await page.getByLabel('Close settings').click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

// Resolve browser colors (including color-mix) and transparent ancestor surfaces.
async function contrast(locator: Locator, property = 'color', backgroundProperty?: string) {
  return locator.evaluate(
    (el, { property, backgroundProperty }) => {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 1
      const ctx = canvas.getContext('2d')!
      const rgba = (color: string) => {
        ctx.clearRect(0, 0, 1, 1)
        ctx.fillStyle = color
        ctx.fillRect(0, 0, 1, 1)
        return Array.from(ctx.getImageData(0, 0, 1, 1).data)
      }
      const style = getComputedStyle(el)
      let bg = [255, 255, 255, 255]
      if (backgroundProperty) bg = rgba(style.getPropertyValue(backgroundProperty))
      else {
        const parents: Element[] = []
        for (let node: Element | null = el; node; node = node.parentElement) parents.unshift(node)
        for (const parent of parents) {
          const c = rgba(getComputedStyle(parent).backgroundColor)
          bg = bg.map((v, i) => (i === 3 ? 255 : (c[i] * c[3]) / 255 + v * (1 - c[3] / 255)))
        }
      }
      const fg = rgba(style.getPropertyValue(property))
      const l = (c: number[]) =>
        c
          .slice(0, 3)
          .map((v) => v / 255)
          .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
          .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0)
      const f = l(fg),
        b = l(bg)
      return (Math.max(f, b) + 0.05) / (Math.min(f, b) + 0.05)
    },
    { property, backgroundProperty },
  )
}

async function readable(page: Page, selectors: string[]) {
  for (const selector of selectors) {
    for (const el of await page.locator(selector).all()) {
      if (!(await el.isVisible())) continue
      expect(await contrast(el), `Text contrast: ${selector}`).toBeGreaterThanOrEqual(4.5)
    }
  }
}

async function connectedDocumentSurface(page: Page, header: string) {
  const surface = await page
    .locator('.writing-pane')
    .evaluate((el) => getComputedStyle(el).backgroundColor)
  const active = page.locator('.note-tab.active')
  await expect(active).toHaveCSS('background-color', surface)
  await expect(page.locator(header)).toHaveCSS('background-color', surface)
  await expect(page.locator(header)).toHaveCSS('border-bottom-color', 'rgba(0, 0, 0, 0)')
  const strip = await page
    .locator('.note-tabs')
    .evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(strip).not.toBe(surface)
  await active.hover()
  await expect(active).toHaveCSS('background-color', surface)
  const tabBounds = (await active.boundingBox())!
  const headerBounds = (await page.locator(header).boundingBox())!
  expect(tabBounds.y + tabBounds.height).toBeCloseTo(headerBounds.y)
}

for (const dark of [false, true])
  for (const cards of [false, true]) {
    const label = `${dark ? 'dark' : 'light'}-${cards ? 'cards' : 'default'}`
    test(`${label}: distinct surfaces, readable states, controls and portal settings`, async ({
      page,
    }) => {
      await page.goto('/')
      await appearance(page, dark, cards)
      const colors = await page
        .locator('.sidebar,.note-list,.writing-pane')
        .evaluateAll((els) => els.map((el) => getComputedStyle(el).backgroundColor))
      expect(new Set(colors).size).toBe(3)
      await page.locator('.note-row').nth(0).dblclick()
      await page.locator('.note-row').nth(1).dblclick()
      await connectedDocumentSurface(page, '.editor-header')
      await page.locator('.note-tab.active [role="tab"]').focus()
      await page.keyboard.press('ArrowLeft')
      await connectedDocumentSurface(page, '.editor-header')
      await readable(page, ['.note-tab', '.breadcrumb'])
      const row = page.locator('.note-row.selected')
      await row.evaluate(async (el) => {
        await Promise.all(el.getAnimations().map((animation) => animation.finished.catch(() => {})))
      })
      const selected = await row.evaluate((el) => getComputedStyle(el).backgroundColor)
      await row.hover()
      await expect(row).toHaveCSS('background-color', selected)
      await readable(page, [
        '.note-row-title',
        '.note-row-meta',
        '.nav-item',
        '.list-footer',
        '.section-toggle',
        '.breadcrumb',
        '.quick-open-shell kbd',
        '.tiptap',
      ])
      await row.click({ button: 'right' })
      await expect(page.locator('.workspace-action-menu')).toHaveAttribute('data-palette', 'aster')
      await expect(row).toHaveCSS('background-color', selected)
      await readable(page, ['.workspace-action-menu [role="menuitem"]:not([data-disabled])'])
      await page.keyboard.press('Escape')
      const field = page.getByRole('textbox', { name: 'Search notes', exact: true })
      await field.focus()
      expect(await contrast(field, 'border-top-color')).toBeGreaterThanOrEqual(3)
      expect(await contrast(field, '--focus-ring')).toBeGreaterThanOrEqual(3)
      await field.fill('No matching Aster note')
      await expect(page.locator('.list-empty')).toBeVisible()
      await readable(page, ['.list-empty'])
      await field.fill('')
      await field.blur()
      for (const size of [
        { width: 1280, height: 800 },
        { width: 900, height: 650 },
      ]) {
        await page.setViewportSize(size)
        await page.screenshot({ path: test.info().outputPath(`${label}-${size.width}.png`) })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        )
      }
      await settings(page)
      const dialog = page.getByRole('dialog')
      await expect(dialog).toHaveAttribute('data-theme', dark ? 'dark' : 'light')
      await expect(dialog).toHaveAttribute('data-palette', 'aster')
      await readable(page, [
        '.setting-row small',
        '.settings-section h3',
        '.setting-row select',
        '.settings-search',
        '.app-style-option small',
      ])
      expect(
        await contrast(page.getByLabel('Theme', { exact: true }), '--border-control'),
      ).toBeGreaterThanOrEqual(3)
      expect(await contrast(dialog, '--border-control', '--surface-group')).toBeGreaterThanOrEqual(
        3,
      )
      const toggle = page.getByRole('switch', { name: 'Enable animations' })
      expect(await contrast(toggle, '--on-accent', '--accent')).toBeGreaterThanOrEqual(3)
      await toggle.uncheck()
      expect(await contrast(toggle, '--switch-thumb', '--muted')).toBeGreaterThanOrEqual(3)
      await page.screenshot({ path: test.info().outputPath(`${label}-settings.png`) })
      for (const category of ['Typography', 'Editor', 'Keyboard shortcuts', 'Sync']) {
        await page
          .getByRole('navigation', { name: 'Settings categories' })
          .getByRole('button', { name: category, exact: true })
          .click()
        await readable(page, [
          '.setting-row small',
          '.settings-section h3',
          '.font-picker-trigger',
          '.setting-row select',
        ])
      }
      await page.setViewportSize({ width: 680, height: 750 })
      await page
        .getByRole('navigation', { name: 'Settings categories' })
        .getByRole('button', { name: 'Appearance', exact: true })
        .click()
      await page.screenshot({ path: test.info().outputPath(`${label}-settings-680.png`) })
      expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    })
  }

for (const dark of [false, true]) {
  test(`${dark ? 'dark' : 'light'}: amber search, teal links and PDF surroundings`, async ({
    page,
  }) => {
    await page.goto('/')
    await appearance(page, dark)
    await page.getByRole('combobox', { name: 'Find notes', exact: true }).fill('note')
    await expect(page.locator('.quick-open-match').first()).toBeVisible()
    await readable(page, ['.quick-open-match', '.quick-open-result small'])
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Search note content', exact: true }).click()
    await page.locator('input[aria-label="Search note content"]').fill('note')
    const match = page.locator('.content-search-match mark').first()
    await expect(match).toBeVisible()
    expect(await contrast(match)).toBeGreaterThanOrEqual(4.5)
    await page.screenshot({ path: test.info().outputPath('content-search.png') })
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Find in note', exact: true }).click()
    await page.locator('.note-find-bar input').first().fill('note')
    await expect(page.locator('.note-find-match.current-match').first()).toBeVisible()
    expect(
      await contrast(page.locator('.note-find-match.current-match').first()),
    ).toBeGreaterThanOrEqual(4.5)
    await page.keyboard.press('Escape')
    // Use ordinary document surfaces. The rich sample intentionally contains
    // user-authored colors and backgrounds, which a theme must not overwrite.
    await page.getByRole('button', { name: 'New note', exact: true }).click()
    await page.locator('.tiptap').click()
    await page.locator('.tiptap').evaluate((el) => {
      const data = new DataTransfer()
      data.setData(
        'text/html',
        '<p><a href="https://example.com">A default link</a></p><pre><code class="language-typescript">const message = "Hello"; const count = 3;</code></pre>',
      )
      el.dispatchEvent(
        new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }),
      )
    })
    await expect(page.locator('.tiptap a')).toHaveCount(1)
    await expect(page.locator('.hljs-keyword').first()).toBeVisible()
    await readable(page, ['.tiptap a', '.hljs-keyword', '.hljs-string', '.hljs-number'])
    const pdf = fileURLToPath(new URL('../pdf/fixtures/text.pdf', import.meta.url))
    await page.locator('input[type=file][accept="application/pdf,.pdf"]').setInputFiles(pdf)
    await expect(page.locator('.pdf-session:not([hidden]) canvas').first()).toBeVisible()
    await connectedDocumentSurface(page, '.pdf-session:not([hidden]) .pdf-toolbar')
    await expect(page.locator('.pdf-session:not([hidden]) .pdfViewer .page').first()).toHaveCSS(
      'background-color',
      'rgb(255, 255, 255)',
    )
    await readable(page, [
      '.pdf-bottom-toolbar',
      '.pdf-page-controls',
      '.pdf-bottom-toolbar input',
      '.pdf-bottom-toolbar select',
    ])
    await page.keyboard.press('Control+f')
    await page.getByRole('textbox', { name: 'Find in PDF', exact: true }).fill('Stash')
    await expect(page.locator('.pdf-search-result mark').first()).toBeVisible()
    expect(await contrast(page.locator('.pdf-search-result mark').first())).toBeGreaterThanOrEqual(
      4.5,
    )
    await page.screenshot({ path: test.info().outputPath('pdf.png') })
    await page
      .locator('input[type=file][accept="application/pdf,.pdf"]')
      .setInputFiles(fileURLToPath(new URL('../pdf/fixtures/corrupt.pdf', import.meta.url)))
    await expect(page.getByText('Could not open this PDF.', { exact: false })).toBeVisible()
    await readable(page, ['.pdf-message[role="alert"]'])
    await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toBeDisabled()
    await page.screenshot({ path: test.info().outputPath('pdf-error.png') })
  })
  test(`${dark ? 'dark' : 'light'}: mobile surfaces, settings, portals and touch targets`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/?mobile=1')
    await page.getByRole('button', { name: 'Open navigation' }).click()
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: 'Appearance', exact: true }).click()
    await page.getByLabel('Theme', { exact: true }).selectOption('aster')
    await page.getByRole('button', { name: dark ? 'Dark' : 'Light', exact: true }).click()
    await readable(page, ['.setting-row small', '.setting-row select', '.settings-section h3'])
    await page.screenshot({ path: test.info().outputPath('mobile-settings.png') })
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    for (const size of [
      { width: 390, height: 844 },
      { width: 844, height: 390 },
    ]) {
      await page.setViewportSize(size)
      await readable(page, ['.mobile-note-label', '.mobile-preview', '.mobile-header h1'])
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
      await page.screenshot({ path: test.info().outputPath(`mobile-${size.width}.png`) })
    }
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: 'Open navigation' }).click()
    await expect(page.locator('.mobile-drawer')).toHaveAttribute('data-palette', 'aster')
    await readable(page, ['.mobile-drawer nav > button', '.mobile-drawer nav > button small'])
    expect(
      (await page.getByRole('button', { name: 'Settings', exact: true }).boundingBox())!.height,
    ).toBeGreaterThanOrEqual(48)
    await page.screenshot({ path: test.info().outputPath('mobile-drawer.png') })
  })
}
