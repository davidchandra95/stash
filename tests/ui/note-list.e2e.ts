import { test, expect, type Page, type Locator } from '@playwright/test'

async function store(
  page: Page,
  options: { colorMode?: 'light' | 'dark'; accent?: string; mode?: string; fixture?: boolean },
) {
  await page.evaluate(async (options) => {
    const moduleUrl = performance
      .getEntriesByType('resource')
      .find((entry) => new URL(entry.name).pathname === '/src/storage/useLibrary.ts')!.name
    const { library } = await import(/* @vite-ignore */ moduleUrl)
    if (options.fixture) {
      library.setNotebooks([
        { id: 'work', name: 'Work', icon: 'briefcase', color: '#888888' },
        {
          id: 'plans',
          name: 'Planning a longer project with several phases',
          parentId: 'work',
          icon: 'book',
          color: '#888888',
        },
        { id: 'personal', name: 'Personal', icon: 'book', color: '#888888' },
      ])
      library.setNotes(
        Array.from({ length: 40 }, (_, i) => ({
          id: `context-${i}`,
          title: i === 2 ? '' : `Meeting notes ${String(i).padStart(2, '0')}`,
          text:
            i === 1
              ? ''
              : `Discuss phase ${i}, decisions, and next steps. ` +
                'A longer preview that stays on one line. '.repeat(12),
          content: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content:
                  i === 1
                    ? []
                    : [{ type: 'text', text: `Discuss phase ${i}, decisions, and next steps.` }],
              },
            ],
          },
          notebookIds: i === 2 ? [] : ['plans', 'personal'],
          pinned: i === 0,
          trashed: false,
          quickAccess: false,
          tags: [],
          updated: 100 - i,
        })),
      )
    }
    const appearance = library.getSnapshot().appearance
    library.setAppearance({
      ...appearance,
      ...(options.colorMode ? { colorMode: options.colorMode } : {}),
      ...(options.accent ? { accent: options.accent } : {}),
      animationsEnabled: false,
    })
    if (options.mode) library.setNoteListMode(options.mode)
  }, options)
}

async function contrast(locator: Locator) {
  return locator.evaluate((element) => {
    const canvas = document.createElement('canvas'),
      context = canvas.getContext('2d')!
    canvas.width = canvas.height = 1
    const rgba = (color: string) => {
      context.clearRect(0, 0, 1, 1)
      context.fillStyle = color
      context.fillRect(0, 0, 1, 1)
      return [...context.getImageData(0, 0, 1, 1).data]
    }
    const over = (a: number[], b: number[]) =>
      a.map((v, i) => (i === 3 ? 255 : (v * a[3]) / 255 + b[i] * (1 - a[3] / 255)))
    const parents: Element[] = []
    for (let node: Element | null = element; node; node = node.parentElement) parents.unshift(node)
    const bg = parents.reduce(
      (v, node) => over(rgba(getComputedStyle(node).backgroundColor), v),
      [255, 255, 255, 255],
    )
    const fg = over(rgba(getComputedStyle(element).color), bg)
    const luminance = (c: number[]) =>
      c
        .slice(0, 3)
        .map((v) => v / 255)
        .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
        .reduce((v, n, i) => v + n * [0.2126, 0.7152, 0.0722][i], 0)
    const a = luminance(fg),
      b = luminance(bg)
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
  })
}

for (const mobile of [false, true]) {
  test(`${mobile ? 'mobile' : 'desktop'}: list choices, recognition context, retained state and color modes`, async ({
    page,
  }) => {
    test.setTimeout(120000)
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 })
    await page.goto(mobile ? '/?mobile=1' : '/')
    const rows = page.locator(mobile ? '.mobile-list' : '.note-rows')
    const previewLine = mobile ? '.note-list-preview' : '.note-row-preview'
    const viewMenu = page.getByRole('button', { name: 'Sort and view options', exact: true })
    await expect(rows).toBeVisible()
    await store(page, { fixture: true, mode: 'compact' })
    const first = page.getByRole('button', { name: 'Meeting notes 00', exact: true })
    await expect(first).toBeVisible()
    await expect(first.locator('.note-list-notebook')).toContainText('+1')
    await expect(first).toHaveAttribute(
      'aria-description',
      'Notebooks: Work / Planning a longer project with several phases, Personal',
    )
    await expect(page.locator(previewLine)).toHaveCount(0)
    if (!mobile) {
      await first.click()
      await viewMenu.focus()
      await first.focus()
      await expect(page.getByRole('tooltip')).toContainText('Notebooks: Work / Planning')
      await first.press('Shift+F10')
      await expect(page.getByRole('menuitem', { name: 'Unpin', exact: true })).toBeVisible()
      await page.keyboard.press('Escape')
    }
    const filter = page.getByRole('textbox', {
      name: mobile ? 'Search notes' : 'Filter this view',
      exact: true,
    })
    if (mobile) await page.getByRole('button', { name: 'Search notes', exact: true }).click()
    await filter.fill('Meeting')
    await rows.evaluate((el) => {
      el.scrollTop = 120
    })
    const scroll = await rows.evaluate((el) => el.scrollTop)
    if (mobile) {
      await page.getByRole('button', { name: 'Page actions', exact: true }).click()
      await page.getByRole('radio', { name: 'Preview', exact: true }).click()
    } else {
      await viewMenu.press('Enter')
      await page
        .getByRole('group', { name: 'Note list view', exact: true })
        .getByRole('menuitemradio', { name: 'Preview', exact: true })
        .click()
      await expect(viewMenu).toBeFocused()
      await expect(page.locator('.note-row.is-selected')).toHaveAttribute(
        'data-note-id',
        'context-0',
      )
    }
    await expect(filter).toHaveValue('Meeting')
    expect(await rows.evaluate((el) => el.scrollTop)).toBe(scroll)
    await expect(page.locator(previewLine).first()).toContainText('Discuss phase 0')
    await expect(
      page.getByRole('button', { name: 'Meeting notes 01', exact: true }).locator(previewLine),
    ).toHaveText('No text preview')
    await filter.fill('')
    await expect(
      page
        .getByRole('button', { name: 'Untitled note', exact: true })
        .locator('.note-list-notebook'),
    ).toHaveText('Uncategorized')
    await rows.evaluate((el) => {
      el.scrollTop = 0
    })
    if (mobile) {
      await page.getByRole('button', { name: 'Open navigation', exact: true }).click()
      await page
        .locator('.mobile-drawer .mobile-book-label')
        .filter({ hasText: 'Personal' })
        .click()
    } else {
      await page.locator('.sidebar .side-row-main').filter({ hasText: 'Personal' }).first().click()
    }
    await expect(page.locator('.note-list-notebook')).toHaveCount(0)
    await expect(page.locator(previewLine).first()).toBeVisible()
    if (mobile) {
      await page.getByRole('button', { name: 'Open navigation', exact: true }).click()
      await page.getByRole('button', { name: /All notes/ }).click()
    } else
      await page
        .getByRole('navigation', { name: 'Notes navigation', exact: true })
        .getByRole('button', { name: /^All notes/ })
        .click()
    await expect(first.locator('.note-list-notebook')).toBeVisible()

    for (const colorMode of ['light', 'dark'] as const) {
      await store(page, { colorMode })
      await expect(page.locator('html')).toHaveAttribute('data-theme', colorMode)
      await expect(first.locator(previewLine)).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
    }
    await store(page, { colorMode: 'dark' })
    await page.mouse.move(0, 0)
    await page.screenshot({
      path: test.info().outputPath(`${mobile ? 'mobile-390' : 'desktop-1280'}-preview.png`),
    })
    await page.setViewportSize(mobile ? { width: 844, height: 390 } : { width: 900, height: 650 })
    await store(page, { colorMode: 'light' })
    await page.screenshot({
      path: test.info().outputPath(`${mobile ? 'mobile-landscape' : 'desktop-900'}-preview.png`),
    })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const line = first.locator(previewLine)
    await expect(line).toHaveCSS('white-space', 'nowrap')
    expect(await line.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
    if (mobile) {
      const action = page.getByRole('button', { name: 'Actions for Meeting notes 00', exact: true })
      const box = await action.boundingBox()
      expect(box!.width).toBeGreaterThanOrEqual(48)
      expect(box!.height).toBeGreaterThanOrEqual(48)
      await page.getByRole('button', { name: 'Page actions', exact: true }).click()
      await page.getByRole('radio', { name: 'Compact', exact: true }).click()
    } else {
      await viewMenu.click()
      await page.getByRole('menuitemradio', { name: 'Compact', exact: true }).click()
    }
    await expect(page.locator(previewLine)).toHaveCount(0)
    await expect(first.locator('.note-list-notebook')).toBeVisible()
  })
}

for (const mobile of [false, true]) {
  test(`${mobile ? 'mobile' : 'desktop'}: row text keeps 4.5:1 contrast in both color modes`, async ({
    page,
  }) => {
    if (!mobile)
      // Suspected v2 regression (v1 kept these at 4.5:1 or more). Measured at 1280×800:
      // the accent-filled selection draws `--on-accent` text at 80% over the accent, which is
      // 2.0–3.1:1 for blue, graphite and green (the title itself is 2.4–4.0:1; dark green
      // gives white on light green). Unselected notebook context uses `--text-3` at 3.4–3.6:1.
      // Remove `test.fail` once the note list meets 4.5:1 again.
      test.fail()
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 })
    await page.goto(mobile ? '/?mobile=1' : '/')
    await expect(page.locator(mobile ? '.mobile-list' : '.note-rows')).toBeVisible()
    await store(page, { fixture: true, mode: 'preview' })
    const previewLine = mobile ? '.note-list-preview' : '.note-row-preview'
    const first = page.getByRole('button', { name: 'Meeting notes 00', exact: true })
    const unselected = page.getByRole('button', { name: 'Meeting notes 01', exact: true })
    // Select the first row with the notes list as the active pane.
    if (!mobile) await first.click()
    for (const colorMode of ['light', 'dark'] as const)
      for (const accent of ['blue', 'graphite', 'yellow', 'green']) {
        await store(page, { colorMode, accent })
        await expect(page.locator('html')).toHaveAttribute('data-theme', colorMode)
        const context = `${mobile ? 'mobile' : 'desktop'} ${colorMode} ${accent}`
        await page.mouse.move(0, 0)
        for (const selector of [
          previewLine,
          '.note-list-notebook > span:first-child',
          '.note-list-notebook-extra',
        ])
          expect
            .soft(await contrast(first.locator(selector)), `${context} selected ${selector}`)
            .toBeGreaterThanOrEqual(4.5)
        await first.hover()
        expect
          .soft(await contrast(first.locator(previewLine)), `${context} selected hover`)
          .toBeGreaterThanOrEqual(4.5)
        for (const hover of [false, true]) {
          if (hover) await unselected.hover()
          else await page.mouse.move(0, 0)
          for (const selector of [previewLine, '.note-list-notebook > span:first-child'])
            expect
              .soft(
                await contrast(unselected.locator(selector)),
                `${context} unselected hover=${hover} ${selector}`,
              )
              .toBeGreaterThanOrEqual(4.5)
        }
      }
  })
}
