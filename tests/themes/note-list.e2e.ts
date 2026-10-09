import { test, expect, type Page, type Locator } from '@playwright/test'

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

async function store(
  page: Page,
  options: { theme?: string; dark?: boolean; appStyle?: string; mode?: string; fixture?: boolean },
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
      ...(options.theme ? { theme: options.theme } : {}),
      ...(options.dark !== undefined ? { dark: options.dark } : {}),
      ...(options.appStyle ? { appStyle: options.appStyle } : {}),
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
  test(`${mobile ? 'mobile' : 'desktop'}: list choices, recognition context, retained state and themes`, async ({
    page,
  }) => {
    test.setTimeout(120000)
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 })
    await page.goto(mobile ? '/?mobile=1' : '/')
    const rows = page.locator(mobile ? '.mobile-list' : '.note-rows')
    await expect(rows).toBeVisible()
    await store(page, { fixture: true, mode: 'compact' })
    const first = page.getByRole('button', { name: 'Meeting notes 00', exact: true })
    await expect(first).toBeVisible()
    await expect(first.locator('.note-list-notebook')).toContainText('+1')
    await expect(first).toHaveAttribute(
      'aria-description',
      'Notebooks: Work / Planning a longer project with several phases, Personal',
    )
    await expect(page.locator('.note-list-preview')).toHaveCount(0)
    if (!mobile) {
      await first.click()
      await page.getByRole('button', { name: 'Note list view', exact: true }).focus()
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
      await page.getByRole('button', { name: 'Note list view', exact: true }).press('Enter')
      await page.getByRole('menuitemradio', { name: 'Preview', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Note list view', exact: true })).toBeFocused()
      await expect(page.locator('.note-row.selected')).toHaveAttribute('data-note-id', 'context-0')
    }
    await expect(filter).toHaveValue('Meeting')
    expect(await rows.evaluate((el) => el.scrollTop)).toBe(scroll)
    await expect(page.locator('.note-list-preview').first()).toContainText('Discuss phase 0')
    await expect(
      page
        .getByRole('button', { name: 'Meeting notes 01', exact: true })
        .locator('.note-list-preview'),
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
      await page
        .locator('.sidebar .notebook-tree-row > button')
        .filter({ hasText: 'Personal' })
        .first()
        .click()
    }
    await expect(page.locator('.note-list-notebook')).toHaveCount(0)
    await expect(page.locator('.note-list-preview').first()).toBeVisible()
    if (mobile) {
      await page.getByRole('button', { name: 'Open navigation', exact: true }).click()
      await page.getByRole('button', { name: /All notes/ }).click()
    } else await page.locator('.sidebar .nav-item').filter({ hasText: 'All notes' }).click()
    await expect(first.locator('.note-list-notebook')).toBeVisible()

    if (!mobile) {
      await store(page, { theme: 'classic', dark: true, appStyle: 'default' })
      await page.mouse.move(0, 0)
      await page.screenshot({ path: '.artifact-work/note-list/desktop-1280-preview.png' })
      await page.setViewportSize({ width: 900, height: 650 })
      await store(page, { theme: 'aster', dark: false, appStyle: 'cards' })
      await page.screenshot({ path: '.artifact-work/note-list/desktop-900-preview.png' })
      await page.setViewportSize({ width: 1280, height: 800 })
    }
    // Inspect all existing appearance combinations in one bounded pass.
    for (const theme of palettes)
      for (const dark of [false, true])
        for (const appStyle of ['default', 'cards']) {
          await store(page, { theme, dark, appStyle })
          await expect(page.locator(mobile ? '.mobile-app' : '.app')).toHaveAttribute(
            'data-palette',
            theme,
          )
          for (const selector of [
            '.note-list-preview',
            '.note-list-notebook > span:first-child',
            '.note-list-notebook-extra',
          ]) {
            const el = first.locator(selector)
            expect(
              await contrast(el),
              `${mobile ? 'mobile' : 'desktop'} ${theme} ${dark} ${appStyle} ${selector}`,
            ).toBeGreaterThanOrEqual(4.5)
          }
          await first.hover()
          expect(await contrast(first.locator('.note-list-preview'))).toBeGreaterThanOrEqual(4.5)
          const unselected = page.getByRole('button', { name: 'Meeting notes 01', exact: true })
          for (const hover of [false, true]) {
            if (hover) await unselected.hover()
            else await page.mouse.move(0, 0)
            expect(
              await contrast(unselected.locator('.note-list-preview')),
              `Unselected preview ${theme} ${dark} ${appStyle} hover=${hover}`,
            ).toBeGreaterThanOrEqual(4.5)
            expect(
              await contrast(unselected.locator('.note-list-notebook > span:first-child')),
              `Unselected notebook ${theme} ${dark} ${appStyle} hover=${hover}`,
            ).toBeGreaterThanOrEqual(4.5)
          }
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          ).toBe(true)
        }
    await store(page, { theme: 'classic', dark: true, appStyle: 'default' })
    await page.mouse.move(0, 0)
    await page.screenshot({
      path: `.artifact-work/note-list/${mobile ? 'mobile-390' : 'desktop-1280'}-preview.png`,
    })
    await page.setViewportSize(mobile ? { width: 844, height: 390 } : { width: 900, height: 650 })
    await store(page, { theme: 'aster', dark: false, appStyle: 'cards' })
    await page.screenshot({
      path: `.artifact-work/note-list/${mobile ? 'mobile-landscape' : 'desktop-900'}-preview.png`,
    })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const line = first.locator('.note-list-preview')
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
      await page.getByRole('button', { name: 'Note list view', exact: true }).click()
      await page.getByRole('menuitemradio', { name: 'Compact', exact: true }).click()
    }
    await expect(page.locator('.note-list-preview')).toHaveCount(0)
    await expect(first.locator('.note-list-notebook')).toBeVisible()
  })
}
