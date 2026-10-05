import { test, expect, type Locator, type Page } from '@playwright/test'

test.describe.configure({ mode: 'parallel' })
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
})

const palettes = [
  'classic',
  'zen',
  'financial',
  'tiktok',
  'catppuccin',
  'lastchat',
  'qrafthive',
  'aster',
]

async function settings(page: Page) {
  await page.locator('.account-trigger').click()
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click()
}

// Resolve actual browser colors and alpha-composite through transparent ancestors.
async function contrast(locator: Locator, property = 'color', pseudo?: string) {
  return locator.evaluate(
    (el, { property, pseudo }) => {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 1
      const ctx = canvas.getContext('2d')!
      const rgba = (color: string) => {
        ctx.clearRect(0, 0, 1, 1)
        ctx.fillStyle = color
        ctx.fillRect(0, 0, 1, 1)
        return [...ctx.getImageData(0, 0, 1, 1).data]
      }
      const over = (a: number[], b: number[]) =>
        a.map((v, i) => (i === 3 ? 255 : (v * a[3]) / 255 + b[i] * (1 - a[3] / 255)))
      const parents: Element[] = []
      for (let node: Element | null = el; node; node = node.parentElement) parents.unshift(node)
      const bg = parents.reduce(
        (v, node) => over(rgba(getComputedStyle(node).backgroundColor), v),
        [255, 255, 255, 255],
      )
      const fg = over(rgba(getComputedStyle(el, pseudo).getPropertyValue(property)), bg)
      const luminance = (c: number[]) =>
        c
          .slice(0, 3)
          .map((v) => v / 255)
          .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
          .reduce((v, n, i) => v + n * [0.2126, 0.7152, 0.0722][i], 0)
      const a = luminance(fg),
        b = luminance(bg)
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
    },
    { property, pseudo },
  )
}

async function readable(page: Page, selectors: string[]) {
  for (const selector of selectors)
    for (const el of await page.locator(selector).all()) {
      if (await el.isVisible()) {
        const ratio = await contrast(el)
        expect(ratio, `${selector}: ${await el.innerText()}`).toBeGreaterThanOrEqual(4.5)
      }
    }
}

async function field(locator: Locator, shell = locator) {
  expect(
    await contrast(locator, 'color', '::placeholder'),
    'placeholder contrast',
  ).toBeGreaterThanOrEqual(4.5)
  expect(
    await contrast(shell, 'border-top-color'),
    'field boundary contrast',
  ).toBeGreaterThanOrEqual(3)
  await locator.focus()
  expect(await contrast(shell, '--focus-ring'), 'focus ring contrast').toBeGreaterThanOrEqual(3)
}

for (const palette of palettes)
  for (const dark of [false, true])
    for (const cards of [false, true]) {
      const label = `${palette}-${dark ? 'dark' : 'light'}-${cards ? 'cards' : 'default'}`
      test(`${label}: shared surfaces, states and form contrast`, async ({ page }) => {
        await page.goto('/')
        const fonts = await page
          .locator('.app')
          .evaluate((el) =>
            ['--ui-font', '--title-font', '--note-font', '--code-font'].map((k) =>
              getComputedStyle(el).getPropertyValue(k),
            ),
          )
        await settings(page)
        await page.getByLabel('Theme', { exact: true }).selectOption(palette)
        await page.getByRole('button', { name: dark ? 'Dark' : 'Light', exact: true }).click()
        await page
          .locator(`input[name="app-style"][value="${cards ? 'cards' : 'default'}"]`)
          .check()
        await field(
          page.getByRole('textbox', { name: 'Search settings', exact: true }),
          page.locator('.settings-search'),
        )
        await readable(page, [
          '.settings-sidebar nav button',
          '.setting-row',
          '.setting-row small',
          '.app-style-option small',
          '.theme-options button',
        ])
        for (const size of [
          { width: 1280, height: 800 },
          { width: 900, height: 650 },
        ]) {
          await page.setViewportSize(size)
          await page.screenshot({
            path: test.info().outputPath(`${label}-settings-${size.width}.png`),
          })
        }
        await page.setViewportSize({ width: 1280, height: 800 })
        for (const category of ['Typography', 'Editor', 'Keyboard shortcuts', 'Sync']) {
          await page.getByRole('button', { name: category, exact: true }).click()
          await readable(page, [
            '.setting-row',
            '.setting-row small',
            '.settings-content .muted',
            '.shortcut-description small',
            '.settings-section h3',
          ])
          if (category === 'Sync')
            for (const el of await page.locator('.sync-connection .text-field').all())
              await field(el)
          for (const range of await page.locator('.setting-row input[type="range"]').all())
            expect(
              await contrast(range, 'accent-color'),
              'range control indicator',
            ).toBeGreaterThanOrEqual(3)
          if (category === 'Typography') {
            await page.getByRole('button', { name: 'Note font', exact: true }).click()
            await field(
              page.getByRole('textbox', { name: 'Search Note font', exact: true }),
              page.locator('.font-picker-search'),
            )
            await readable(page, ['.font-picker-option', '.font-picker-group-label'])
            await page.keyboard.press('Escape')
          }
          await page.screenshot({ path: test.info().outputPath(`${label}-${category}.png`) })
        }
        await page.getByLabel('Close settings').click()
        expect(
          await page
            .locator('.app')
            .evaluate((el) =>
              ['--ui-font', '--title-font', '--note-font', '--code-font'].map((k) =>
                getComputedStyle(el).getPropertyValue(k),
              ),
            ),
        ).toEqual(fonts)
        await field(
          page.getByRole('textbox', { name: 'Search notes', exact: true }),
          page.locator('.search-box'),
        )
        await page.getByRole('textbox', { name: 'Search notes', exact: true }).blur()
        const checkmark = page
          .locator('[data-checked="true"] > .checkbox-glyph > .checkbox-box svg')
          .first()
        expect(
          await contrast(checkmark, 'stroke'),
          'checked writing control indicator',
        ).toBeGreaterThanOrEqual(3)
        await readable(page, [
          '.nav-item',
          '.nav-item small',
          '.section-toggle',
          '.note-row-title',
          '.note-row-meta',
          '.list-footer',
          '.breadcrumb',
          '.note-tag',
          '.note-organization-button',
        ])
        const selected = page.locator('.note-row.selected')
        const fill = await selected.evaluate((el) => getComputedStyle(el).backgroundColor)
        await selected.hover()
        await expect(selected).toHaveCSS('background-color', fill)
        await selected.click({ button: 'right' })
        await expect(page.getByRole('menu')).toBeVisible()
        await readable(page, ['.workspace-action-menu [role="menuitem"]:not([data-disabled])'])
        await expect(selected).toHaveCSS('background-color', fill)
        await page.keyboard.press('Escape')
        const surface = await page
          .locator('.writing-pane')
          .evaluate((el) => getComputedStyle(el).backgroundColor)
        await expect(page.locator('.note-tab.active')).toHaveCSS('background-color', surface)
        await expect(page.locator('.editor-header')).toHaveCSS('background-color', surface)
        await expect(page.locator('.editor-header')).toHaveCSS(
          'border-bottom-color',
          'rgba(0, 0, 0, 0)',
        )
        for (const size of [
          { width: 1280, height: 800 },
          { width: 900, height: 650 },
        ]) {
          await page.setViewportSize(size)
          await page.screenshot({ path: test.info().outputPath(`${label}-${size.width}.png`) })
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          ).toBe(true)
        }
        await page.getByRole('button', { name: 'Move', exact: true }).click()
        await field(
          page.getByRole('textbox', { name: 'Search notebooks', exact: true }),
          page.locator('.add-notebooks-search'),
        )
        await page.keyboard.press('Escape')
        await page.getByRole('button', { name: 'Table of contents', exact: true }).click()
        await readable(page, ['.outline-heading', '.outline-header h2'])
        await page.screenshot({ path: test.info().outputPath(`${label}-outline-900.png`) })
        await page.getByRole('button', { name: 'Close table of contents', exact: true }).click()
        await page.getByRole('button', { name: 'New notebook', exact: true }).click()
        await field(page.getByRole('textbox', { name: 'Notebook name', exact: true }))
        await page
          .getByRole('textbox', { name: 'Notebook name', exact: true })
          .fill('Review notebook')
        expect(
          await contrast(page.getByRole('button', { name: 'Create notebook', exact: true })),
          'filled button text',
        ).toBeGreaterThanOrEqual(4.5)
        await page
          .getByRole('button', { name: 'Link a folder from this computer', exact: true })
          .click()
        await readable(page, [
          '.folder-error',
          '.notebook-field-label',
          '.notebook-icon-picker legend',
        ])
        await page.screenshot({ path: test.info().outputPath(`${label}-dialog-error.png`) })
        await page.getByRole('button', { name: 'Cancel', exact: true }).click()
        await page
          .locator('.notebook-tree-row')
          .filter({ has: page.getByRole('button', { name: 'Actions for Personal', exact: true }) })
          .hover()
        await page.getByRole('button', { name: 'Actions for Personal', exact: true }).click()
        await page.getByRole('menuitem', { name: 'Delete notebook', exact: true }).click()
        await readable(page, [
          '.notebook-choice strong',
          '.notebook-choice small',
          '.notebook-delete-note',
        ])
        const choice = page
          .locator('.notebook-choice')
          .filter({ has: page.getByRole('radio', { name: /^Move notes to Trash/ }) })
        await choice.click()
        const chosen = await choice.evaluate((el) => getComputedStyle(el).backgroundColor)
        await choice.hover()
        await expect(choice).toHaveCSS('background-color', chosen)
        await readable(page, ['.notebook-choice strong', '.notebook-choice small'])
        expect(await contrast(page.locator('.destructive-button'))).toBeGreaterThanOrEqual(4.5)
        await page.screenshot({ path: test.info().outputPath(`${label}-deletion.png`) })
        await page.getByRole('button', { name: 'Cancel', exact: true }).click()
        await page.setViewportSize({ width: 1280, height: 800 })
        await page.locator('.tiptap p').first().click()
        await page.getByRole('button', { name: 'Insert or edit link', exact: true }).click()
        await field(page.getByRole('textbox', { name: 'Link address', exact: true }))
        await readable(page, [
          '.writing-picker label',
          '.writing-field-hint',
          '.writing-picker button:not(:disabled)',
        ])
        await page
          .getByRole('textbox', { name: 'Link address', exact: true })
          .fill('invalid-address')
        await page.getByRole('button', { name: 'Apply link', exact: true }).click()
        await readable(page, ['.editor-error'])
        await page.screenshot({ path: test.info().outputPath(`${label}-writing-picker.png`) })
        await page.keyboard.press('Escape')
        await page.getByRole('button', { name: 'Alignment', exact: true }).click()
        await readable(page, ['.writing-picker button'])
        await page.keyboard.press('Escape')
      })
    }

for (const cards of [false, true])
  test(`outline adapts without changing panes or document state: ${cards ? 'cards' : 'default'}`, async ({
    page,
  }) => {
    await page.goto('/')
    await page.locator('.note-row[data-note-id="writing-lab"]').click()
    if (cards) {
      await settings(page)
      await page.locator('input[name="app-style"][value="cards"]').check()
      await page.getByLabel('Close settings').click()
    }
    const widths = () =>
      page
        .locator('.sidebar,.note-list')
        .evaluateAll((es) => es.map((el) => el.getBoundingClientRect().width))
    const before = await widths()
    const trigger = page.getByRole('button', { name: 'Table of contents', exact: true })
    await trigger.click()
    await expect(page.locator('.note-outline')).toHaveAttribute('data-mode', 'docked')
    const disclosure = page.locator('.outline-disclosure').first()
    await disclosure.click()
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false')
    expect(await widths()).toEqual(before)
    const separator = page.getByRole('separator', { name: 'Resize table of contents' })
    await separator.focus()
    await separator.press('Shift+ArrowLeft')
    await expect(separator).toHaveAttribute('aria-valuenow', '292')
    await page.setViewportSize({ width: 900, height: 650 })
    await expect(page.locator('.note-outline')).toHaveAttribute('data-mode', 'overlay')
    await expect(separator).toHaveCount(0)
    await expect(page.locator('.note-outline')).toHaveCSS('width', '292px')
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false')
    const narrow = await widths()
    const scroll = page.locator('.note-scroll')
    await scroll.evaluate((el) => (el.scrollTop = 120))
    await page.getByRole('button', { name: 'Close table of contents', exact: true }).click()
    await expect(page.locator('.note-outline')).toHaveCount(0)
    await expect(trigger).toBeFocused()
    await trigger.press('Enter')
    await expect(page.locator('.outline-heading').first()).toBeFocused()
    expect(await scroll.evaluate((el) => el.scrollTop)).toBe(120)
    expect(await widths()).toEqual(narrow)
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false')
    await page.keyboard.press('Escape')
    await expect(page.locator('.note-outline')).toHaveCount(0)
    await expect(trigger).toBeFocused()
    await trigger.click()
    await page.locator('.outline-heading').first().click()
    await expect(page.locator('.note-outline')).toHaveCount(0)
    await trigger.click()
    await page.locator('.note-title').click({ position: { x: 16, y: 10 } })
    await expect(page.locator('.note-outline')).toHaveCount(0)
    await trigger.click()
    await page.setViewportSize({ width: 1280, height: 800 })
    await expect(page.locator('.note-outline')).toHaveAttribute('data-mode', 'docked')
    await expect(page.getByRole('separator', { name: 'Resize table of contents' })).toHaveAttribute(
      'aria-valuenow',
      '292',
    )
    expect(await widths()).toEqual(before)
    await page.getByRole('button', { name: 'Focus mode', exact: true }).click()
    await expect(page.locator('.note-outline')).toHaveAttribute('data-mode', 'docked')
    await page.getByRole('button', { name: 'Exit focus mode', exact: true }).click()
    await page.getByRole('button', { name: 'Hide notes list', exact: true }).click()
    await expect(page.locator('.note-outline')).toHaveAttribute('data-mode', 'docked')
    await page.getByRole('button', { name: 'Show notes list', exact: true }).click()
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false')
    await page.screenshot({ path: test.info().outputPath('outline-docked.png') })
  })

for (const palette of palettes)
  for (const dark of [false, true])
    test(`${palette}-${dark ? 'dark' : 'light'}: mobile settings fields and touch boundaries`, async ({
      page,
    }) => {
      await page.goto('/')
      await settings(page)
      await page.getByLabel('Theme', { exact: true }).selectOption(palette)
      await page.getByRole('button', { name: dark ? 'Dark' : 'Light', exact: true }).click()
      await page.getByLabel('Close settings').click()
      await page.goto('/?mobile=1')
      // Browser preview settings are session-only, so set appearance through the mobile UI.
      await page.setViewportSize({ width: 390, height: 844 })
      await page.getByRole('button', { name: 'Open navigation', exact: true }).click()
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      await page.getByRole('button', { name: 'Appearance', exact: true }).click()
      await page.getByLabel('Theme', { exact: true }).selectOption(palette)
      await page.getByRole('button', { name: dark ? 'Dark' : 'Light', exact: true }).click()
      await field(
        page.getByRole('textbox', { name: 'Search settings', exact: true }),
        page.locator('.settings-search'),
      )
      await readable(page, [
        '.setting-row',
        '.setting-row small',
        '.settings-section h3',
        '.theme-options button',
      ])
      for (const size of [
        { width: 390, height: 844 },
        { width: 844, height: 390 },
      ]) {
        await page.setViewportSize(size)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        )
        expect(
          (await page.getByRole('button', { name: 'Back', exact: true }).boundingBox())!.height,
        ).toBeGreaterThanOrEqual(48)
        await page.screenshot({ path: test.info().outputPath(`mobile-${size.width}.png`) })
      }
      await page.getByRole('button', { name: 'Back', exact: true }).click()
      await page.getByRole('button', { name: 'Back', exact: true }).click()
      for (const size of [
        { width: 390, height: 844 },
        { width: 844, height: 390 },
      ]) {
        await page.setViewportSize(size)
        await readable(page, ['.mobile-note-label', '.mobile-preview', '.mobile-header h1'])
        await page.screenshot({ path: test.info().outputPath(`mobile-notes-${size.width}.png`) })
      }
      await page.getByRole('button', { name: 'Open navigation', exact: true }).click()
      await readable(page, [
        '.mobile-drawer nav > button',
        '.mobile-drawer nav > button small',
        '.mobile-section-label',
      ])
      const header = await page.locator('.mobile-drawer > header').boundingBox()
      await page.locator('.mobile-drawer-scroll').evaluate((el) => {
        el.scrollTop = 100
      })
      expect(
        await page.locator('.mobile-drawer-scroll').evaluate((el) => el.scrollTop),
      ).toBeGreaterThan(0)
      expect(await page.locator('.mobile-drawer > header').boundingBox()).toEqual(header)
      await page.screenshot({ path: test.info().outputPath('mobile-navigation.png') })
    })
