import { expect, test, type Page } from '@playwright/test'

async function libraryPath(page: Page) {
  return page.evaluate(
    () =>
      performance
        .getEntriesByType('resource')
        .map(({ name }) => name)
        .filter((url) => new URL(url).pathname === '/src/storage/useLibrary.ts')
        .at(-1) ?? '/src/storage/useLibrary.ts',
  )
}

test('body search publishes before a slow final read and keeps selection stable', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.getByRole('combobox', { name: 'Find note titles', exact: true })).toBeVisible()
  const modulePath = await libraryPath(page)
  await page.evaluate(async (modulePath) => {
    const { library } = await import(/* @vite-ignore */ modulePath)
    const make = (id: string, text: string, updated: number) => ({
      id,
      title: id,
      text,
      updated,
      tags: [],
      notebookIds: [],
      pinned: false,
      trashed: false,
      quickAccess: false,
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
    })
    const notes = [
      make('synthetic-old', 'needlemarker one needlemarker two', 1),
      make('synthetic-new', 'needlemarker newer', 3),
      make('synthetic-slow', 'nothing', 2),
    ]
    const originalRead = library.readSearchNote
    const release = new Map<string, () => void>()
    Reflect.set(window, 'releaseSyntheticSearchRead', (id: string) => release.get(id)?.())
    library.readSearchNote = async (id: string) => {
      await new Promise<void>((resolve) => {
        if (id === 'synthetic-old') setTimeout(resolve, 2)
        else release.set(id, resolve)
      })
      return originalRead(id)
    }
    library.setNotes(notes)
  }, modulePath)
  const titles = page.getByRole('combobox', { name: 'Find note titles', exact: true })
  await titles.fill('needlemarker')
  await page.locator('.quick-open-content-action').click()
  const field = page.locator('input[aria-label="Search note bodies"]')
  await expect(page.locator('.content-search-match')).toHaveCount(2)
  await expect(page.locator('.content-search-results')).toHaveAttribute('aria-busy', 'true')
  await expect(page.locator('.content-search-status')).toContainText('2 matches in 1 note')
  await expect(page.locator('.global-search-empty')).toHaveCount(0)
  await field.press('ArrowDown')
  const active = await field.getAttribute('aria-activedescendant')
  await page.evaluate(() => Reflect.get(window, 'releaseSyntheticSearchRead')('synthetic-new'))
  await expect(page.locator('.content-search-status')).toContainText('3 matches in 2 notes')
  await expect(field).toHaveAttribute('aria-activedescendant', active!)
  await expect(
    page.locator('.content-search-match[aria-selected="true"] .target-match'),
  ).toHaveText('needlemarker')
  await page.evaluate(() => Reflect.get(window, 'releaseSyntheticSearchRead')('synthetic-slow'))
  await expect(page.locator('.content-search-results')).toHaveAttribute('aria-busy', 'false')
  await field.press('Enter')
  await expect(page.locator('input.note-title')).toHaveValue('synthetic-old')
  await expect(page.locator('.note-find-match.current-match')).toContainText('needlemarker')
})

test('10,000 synthetic notes keep dense search results windowed and navigation accessible', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.getByRole('combobox', { name: 'Find note titles', exact: true })).toBeVisible()
  const modulePath = await libraryPath(page)
  await page.evaluate(async (modulePath) => {
    const { library } = await import(/* @vite-ignore */ modulePath)
    const notes = Array.from({ length: 10000 }, (_, i) => {
      const text = `needlemarker ${i} ` + 'ordinary body text. '.repeat(70)
      return {
        id: `synthetic-${i}`,
        title: `Synthetic ${i}`,
        text,
        updated: 10000 - i,
        tags: [],
        notebookIds: [],
        pinned: false,
        trashed: false,
        quickAccess: false,
        content: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
        },
      }
    })
    library.setNotes(notes)
  }, modulePath)
  await page.getByRole('button', { name: 'Search note bodies', exact: true }).click()
  const field = page.locator('input[aria-label="Search note bodies"]')
  await field.fill('body')
  await expect(page.locator('.content-search-results')).toHaveAttribute('aria-busy', 'false', {
    timeout: 30000,
  })
  await expect(page.locator('.content-search-status')).toHaveText('700000 matches in 10000 notes')
  expect(await page.locator('.content-search-match').count()).toBeLessThan(60)
  await field.press('ArrowUp')
  await expect(page.locator('.content-search-match[aria-selected="true"]')).toHaveAttribute(
    'aria-posinset',
    '700000',
  )
  const active = await field.getAttribute('aria-activedescendant')
  expect(await page.evaluate((id) => !!document.getElementById(id!), active)).toBe(true)
  await expect(page.locator('.content-search-match[aria-selected="true"]')).toBeInViewport()
  await field.press('ArrowDown')
  await expect(page.locator('.content-search-match[aria-selected="true"]')).toHaveAttribute(
    'aria-posinset',
    '1',
  )
  await page.locator('.content-search-results').evaluate((element) => {
    element.scrollTop = element.scrollHeight / 2
  })
  await expect
    .poll(() => page.locator('.content-search-results').evaluate((element) => element.scrollTop))
    .toBeGreaterThan(1000000)
  await field.press('ArrowDown')
  await expect(page.locator('.content-search-match[aria-selected="true"]')).toBeInViewport()
  await field.fill('absent')
  await field.fill('needlemarker')
  await expect(page.locator('.content-search-status')).toHaveText('10000 matches in 10000 notes')
  expect(await page.locator('.content-search-match').count()).toBeLessThan(60)
  await page.setViewportSize({ width: 680, height: 750 })
  await expect(page.locator('.content-search-match[aria-selected="true"]')).toBeInViewport()
  expect(
    await page
      .locator('.global-search-dialog')
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true)
})

test('multiline body results keep their geometry across palettes, modes, and layouts', async ({
  page,
}, testInfo) => {
  await page.goto('/')
  await expect(page.getByRole('combobox', { name: 'Find note titles', exact: true })).toBeVisible()
  const modulePath = await libraryPath(page)
  await page.evaluate(async (modulePath) => {
    const { library } = await import(/* @vite-ignore */ modulePath)
    const text =
      'First fictional line\nSecond fictional line\nneedlemarker\nFourth fictional line\nFifth fictional line'
    library.setNotes([
      {
        id: 'synthetic-multiline',
        title: 'Fictional multiline result',
        text,
        updated: 1,
        tags: [],
        notebookIds: [],
        pinned: false,
        trashed: false,
        quickAccess: false,
        content: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
        },
      },
    ])
  }, modulePath)
  await page.getByRole('button', { name: 'Search note bodies', exact: true }).click()
  const field = page.locator('input[aria-label="Search note bodies"]')
  await field.fill('needlemarker')
  await expect(page.locator('.content-search-status')).toHaveText('1 match in 1 note')
  for (const theme of [
    'classic',
    'zen',
    'financial',
    'tiktok',
    'catppuccin',
    'lastchat',
    'qrafthive',
    'aster',
  ])
    for (const dark of [false, true])
      for (const appStyle of ['default', 'cards']) {
        await page.evaluate(
          async ({ values, modulePath }) => {
            const { library } = await import(/* @vite-ignore */ modulePath)
            library.setAppearance({ ...library.getSnapshot().appearance, ...values })
          },
          { values: { theme, dark, appStyle }, modulePath },
        )
        const dialog = page.locator('.global-search-dialog')
        await expect(dialog).toHaveAttribute('data-palette', theme)
        await expect(dialog).toHaveAttribute('data-theme', dark ? 'dark' : 'light')
        const selected = page.locator('.content-search-match[aria-selected="true"]')
        await expect(selected).toBeInViewport()
        expect(
          await selected.evaluate((element) => element.getBoundingClientRect().height),
        ).toBeGreaterThan(70)
        expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
          true,
        )
        if (
          (theme === 'classic' && !dark && appStyle === 'default') ||
          (theme === 'aster' && dark && appStyle === 'cards')
        )
          await page.screenshot({ path: testInfo.outputPath(`${theme}-${dark}-${appStyle}.png`) })
      }
  for (const viewport of [
    { width: 900, height: 650 },
    { width: 680, height: 750 },
  ]) {
    await page.setViewportSize(viewport)
    await expect(page.locator('.content-search-match[aria-selected="true"]')).toBeInViewport()
    expect(
      await page
        .locator('.global-search-dialog')
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`aster-dark-cards-${viewport.width}.png`) })
  }
  await field.press('Escape')
  await expect(page.getByRole('button', { name: 'Search note bodies', exact: true })).toBeFocused()
})
