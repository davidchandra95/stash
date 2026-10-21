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
  await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeVisible()
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
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await page.getByRole('combobox', { name: 'Find note titles', exact: true }).fill('needlemarker')
  await page.keyboard.press('Tab')
  const field = page.locator('input[aria-label="Search note bodies"]')
  await expect(page.locator('.content-search-match')).toHaveCount(2)
  await expect(page.locator('.content-search-results')).toHaveAttribute('aria-busy', 'true')
  await expect(page.locator('.palette-heading[role="status"]')).toContainText('2 matches in 1 note')
  await expect(page.locator('.palette-empty')).toHaveCount(0)
  await field.press('ArrowDown')
  const active = await field.getAttribute('aria-activedescendant')
  await page.evaluate(() => Reflect.get(window, 'releaseSyntheticSearchRead')('synthetic-new'))
  await expect(page.locator('.palette-heading[role="status"]')).toContainText(
    '3 matches in 2 notes',
  )
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
  await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeVisible()
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
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await page.keyboard.press('Tab')
  const field = page.locator('input[aria-label="Search note bodies"]')
  await field.fill('body')
  await expect(page.locator('.content-search-results')).toHaveAttribute('aria-busy', 'false', {
    timeout: 30000,
  })
  await expect(page.locator('.palette-heading[role="status"]')).toHaveText(
    '700000 matches in 10000 notes',
  )
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
  await expect(page.locator('.palette-heading[role="status"]')).toHaveText(
    '10000 matches in 10000 notes',
  )
  expect(await page.locator('.content-search-match').count()).toBeLessThan(60)
  await page.setViewportSize({ width: 680, height: 750 })
  await expect(page.locator('.content-search-match[aria-selected="true"]')).toBeInViewport()
  expect(
    await page
      .locator('.palette')
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true)
})

async function openMultilineResult(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeVisible()
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
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await page.keyboard.press('Tab')
  const field = page.locator('input[aria-label="Search note bodies"]')
  await field.fill('needlemarker')
  await expect(page.locator('.palette-heading[role="status"]')).toHaveText('1 match in 1 note')
  return { field, modulePath }
}

test('multiline body results keep their geometry across color modes and layouts', async ({
  page,
}, testInfo) => {
  const { field, modulePath } = await openMultilineResult(page)
  for (const colorMode of ['light', 'dark'] as const) {
    await page.evaluate(
      async ({ colorMode, modulePath }) => {
        const { library } = await import(/* @vite-ignore */ modulePath)
        library.setAppearance({ ...library.getSnapshot().appearance, colorMode })
      },
      { colorMode, modulePath },
    )
    await expect(page.locator('html')).toHaveAttribute('data-theme', colorMode)
    const dialog = page.locator('.palette')
    const selected = page.locator('.content-search-match[aria-selected="true"]')
    await expect(selected).toBeInViewport()
    // The whole snippet stays visible: the virtual row is measured, not clipped.
    expect(
      await selected.evaluate((element) => element.scrollHeight <= element.clientHeight + 1),
    ).toBe(true)
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    )
    await page.screenshot({ path: testInfo.outputPath(`${colorMode}.png`) })
  }
  for (const viewport of [
    { width: 900, height: 650 },
    { width: 680, height: 750 },
  ]) {
    await page.setViewportSize(viewport)
    await expect(page.locator('.content-search-match[aria-selected="true"]')).toBeInViewport()
    expect(
      await page
        .locator('.palette')
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`dark-${viewport.width}.png`) })
  }
  await field.press('Escape')
  await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeFocused()
})

test('multiline body results show the note line breaks', async ({ page }) => {
  // Suspected v2 regression: `.content-search-match` uses `white-space: normal`, so the
  // snippet's line breaks collapse into one line (v1 used `pre-wrap`). Remove `test.fail`
  // once the snippet keeps its lines again.
  test.fail()
  await openMultilineResult(page)
  const selected = page.locator('.content-search-match[aria-selected="true"]')
  await expect(selected).toBeInViewport()
  expect(
    await selected.evaluate((element) => element.getBoundingClientRect().height),
  ).toBeGreaterThan(70)
})
