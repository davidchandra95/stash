import { expect, test, type Page } from '@playwright/test'

async function fixture(page: Page, count = 10_000) {
  await page.evaluate(async (count) => {
    const moduleUrl = performance
      .getEntriesByType('resource')
      .find((entry) => new URL(entry.name).pathname === '/src/storage/useLibrary.ts')!.name
    const { library } = await import(/* @vite-ignore */ moduleUrl)
    library.setNotebooks([{ id: 'work', name: 'Work', icon: 'book', color: '#888888' }])
    library.setNotes(
      Array.from({ length: count }, (_, i) => ({
        id: `virtual-${i}`,
        title: `Synthetic ${String(i).padStart(5, '0')}`,
        text: `Body ${i}`,
        content: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: `Body ${i}` }] }],
        },
        notebookIds: ['work'],
        pinned: i === 0,
        trashed: false,
        quickAccess: false,
        tags: [],
        updated: 1760000000000 - i,
      })),
    )
    library.setWorkspace({
      tabs: [],
      activeTabId: null,
      sidebarView: 'all',
      noteListMode: 'compact',
    })
    library.setAppearance({ ...library.getSnapshot().appearance, animationsEnabled: false })
  }, count)
}

for (const mobile of [false, true]) {
  test(`${mobile ? 'mobile' : 'desktop'}: bounded 10,000-note windows, keyboard, modes and retained scroll`, async ({
    page,
  }) => {
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 })
    await page.goto(mobile ? '/?mobile=1' : '/')
    const pane = page.locator(mobile ? '.mobile-list' : '.note-rows')
    await expect(pane).toBeVisible()
    await fixture(page)
    const rowClass = mobile ? '.mobile-note-row' : '.note-row'
    await expect(page.getByRole('button', { name: 'Synthetic 00000', exact: true })).toBeVisible()
    expect(await pane.locator(rowClass).count()).toBeLessThan(50)
    await expect(pane.getByRole('listitem').first()).toHaveAttribute('aria-setsize', '10000')

    await page.getByRole('button', { name: 'Synthetic 00000', exact: true }).focus()
    // Reach beyond the original mounted window using the actual browser Tab path.
    for (let i = 0; i < (mobile ? 62 : 31); i++) await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Synthetic 00031', exact: true })).toBeFocused()
    expect(await pane.locator(rowClass).count()).toBeLessThan(50)

    await pane.evaluate((el) => {
      el.scrollTop = el.scrollHeight
    })
    const last = page.getByRole('button', { name: 'Synthetic 09999', exact: true })
    await expect(last).toBeVisible()
    expect(await pane.locator(rowClass).count()).toBeLessThan(50)
    await expect(last.locator('xpath=ancestor::*[@role="listitem"]')).toHaveAttribute(
      'aria-posinset',
      '10000',
    )

    await pane.evaluate((el) => {
      el.scrollTop = 9000
    })
    const before = await pane.evaluate((el) => el.scrollTop)
    if (mobile) {
      await page.getByRole('button', { name: 'Page actions', exact: true }).click()
      await page.getByRole('radio', { name: 'Preview', exact: true }).click()
    } else {
      await page.getByRole('button', { name: 'Sort and view options', exact: true }).press('Enter')
      await page.getByRole('menuitemradio', { name: 'Preview', exact: true }).click()
    }
    await expect(
      pane.locator(mobile ? '.note-list-preview' : '.note-row-preview').first(),
    ).toBeVisible()
    expect(await pane.evaluate((el) => el.scrollTop)).toBe(before)
    expect(await pane.locator(rowClass).count()).toBeLessThan(50)

    if (mobile) {
      const title = await pane.evaluate((el) => {
        const bounds = el.getBoundingClientRect()
        return [...el.querySelectorAll<HTMLElement>('.mobile-note-label')]
          .find((row) => {
            const rect = row.getBoundingClientRect()
            return rect.top >= bounds.top && rect.bottom <= bounds.bottom
          })!
          .getAttribute('aria-label')!
      })
      await page.getByRole('button', { name: title, exact: true }).click()
      await expect(page.locator('.mobile-note-scroll')).toBeVisible()
      // Hardware Back is covered in MobileApp's native-event behavioral test.
    } else {
      await page.getByRole('button', { name: 'Sort and view options', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Hide notes list', exact: true }).click()
      // The collapsed column has zero width; the window class owns that state.
      await expect(page.locator('.window')).toHaveClass(/\bno-note-list\b/)
      const show = page.getByRole('button', { name: 'Show notes list', exact: true })
      await expect(show).toHaveAttribute('aria-expanded', 'false')
      await show.click()
      await expect(page.locator('.window')).not.toHaveClass(/\bno-note-list\b/)
      expect(await pane.evaluate((el) => el.scrollTop)).toBe(before)
      await pane.evaluate((el) => {
        el.scrollTop = 0
      })
      const first = page.getByRole('button', { name: 'Synthetic 00000', exact: true })
      await first.focus()
      await first.press('Shift+F10')
      await expect(page.getByRole('menuitem', { name: 'Unpin', exact: true })).toBeVisible()
      await pane.evaluate((el) => {
        el.scrollTop = 9000
      })
      await page.keyboard.press('Escape')
      await expect(first).toBeFocused()
    }
  })
}

for (const mobile of [false, true]) {
  test(`${mobile ? 'mobile' : 'desktop'}: remeasure font and viewport changes and clamp a shorter filter`, async ({
    page,
  }) => {
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 })
    await page.goto(mobile ? '/?mobile=1' : '/')
    const pane = page.locator(mobile ? '.mobile-list' : '.note-rows')
    await expect(pane).toBeVisible()
    await fixture(page)
    await pane.evaluate((el) => {
      el.scrollTop = 20000
    })
    // The interface font is no longer a setting; change the row font directly to force remeasuring.
    await page.addStyleTag({
      content:
        '.note-rows, .mobile-list { font-family: "Courier New", monospace; font-size: 15px; }',
    })
    await page.setViewportSize(mobile ? { width: 844, height: 390 } : { width: 900, height: 650 })
    const rows = pane.locator(mobile ? '.mobile-note-row' : '.note-row')
    await expect.poll(() => rows.count()).toBeGreaterThan(0)
    expect(await rows.count()).toBeLessThan(50)
    await expect
      .poll(() =>
        pane.evaluate((el) => {
          const bounds = el.getBoundingClientRect()
          const rows = [...el.querySelectorAll('.virtual-note-slot')]
            .map((row) => row.getBoundingClientRect())
            .filter((row) => row.bottom > bounds.top && row.top < bounds.bottom)
            .sort((a, b) => a.top - b.top)
          return (
            rows.length > 0 &&
            rows.every((row, index) => !index || Math.abs(row.top - rows[index - 1].bottom) < 1)
          )
        }),
      )
      .toBe(true)
    await pane.evaluate((el) => {
      el.scrollTop = el.scrollHeight
    })
    if (mobile) await page.getByRole('button', { name: 'Search notes', exact: true }).click()
    await page
      .getByRole('textbox', { name: mobile ? 'Search notes' : 'Filter this view', exact: true })
      .fill('Synthetic 00000')
    await expect(rows).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Synthetic 00000', exact: true })).toBeVisible()
    expect(await pane.evaluate((el) => el.scrollTop)).toBe(0)
  })
}

test('mobile: a preceding sub-notebook keeps its space above the virtual note window', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?mobile=1')
  const pane = page.locator('.mobile-list')
  await expect(pane).toBeVisible()
  await fixture(page)
  await page.evaluate(async () => {
    const url = performance
      .getEntriesByType('resource')
      .find((entry) => new URL(entry.name).pathname === '/src/storage/useLibrary.ts')!.name
    const { library } = await import(/* @vite-ignore */ url)
    library.setNotebooks([
      { id: 'work', name: 'Work', icon: 'book', color: '#888888' },
      { id: 'child', name: 'Child notebook', parentId: 'work', icon: 'book', color: '#888888' },
    ])
  })
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click()
  await page.locator('.mobile-drawer .mobile-book-label').filter({ hasText: 'Work' }).click()
  await expect(page.locator('.mobile-subnotebooks')).toBeVisible()
  const first = page.getByRole('button', { name: 'Synthetic 00000', exact: true })
  await expect(first).toBeVisible()
  const child = await page.locator('.mobile-subnotebooks').boundingBox()
  const note = await first.boundingBox()
  expect(note!.y).toBeGreaterThanOrEqual(child!.y + child!.height)
  await pane.evaluate((el) => {
    el.scrollTop = 9000
  })
  await expect(pane.locator('.mobile-note-row').first()).toBeAttached()
  expect(await pane.locator('.mobile-note-row').count()).toBeLessThan(50)
  await pane.evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
  await expect(page.getByRole('button', { name: 'Synthetic 09999', exact: true })).toBeVisible()
})

test('desktop: drag across virtual windows, commit once, suppress opening and cancel without changing order', async ({
  page,
}) => {
  await page.goto('/')
  const pane = page.locator('.note-rows')
  await expect(pane).toBeVisible()
  await fixture(page)
  const first = page.getByRole('button', { name: 'Synthetic 00001', exact: true })
  const begin = await first.boundingBox()
  const area = await pane.boundingBox()
  const x = begin!.x + begin!.width / 2
  await page.mouse.move(x, begin!.y + begin!.height / 2)
  await page.mouse.down()
  // This is the existing drag hold threshold, not a wait for rendering.
  await page.waitForTimeout(20)
  await page.mouse.move(x, area!.y + area!.height - 3)
  await expect(page.locator('.note-drag-ghost')).toBeVisible()
  await expect.poll(() => pane.evaluate((el) => el.scrollTop)).toBeGreaterThan(1200)
  expect(await pane.locator('.note-row').count()).toBeLessThan(50)
  await page.mouse.up()
  await expect(page.locator('.note-drag-ghost')).toHaveCount(0)
  const readOrder = () =>
    page.evaluate(async () => {
      const url = performance
        .getEntriesByType('resource')
        .find((entry) => new URL(entry.name).pathname === '/src/storage/useLibrary.ts')!.name
      const { library } = await import(/* @vite-ignore */ url)
      return {
        order: library.getSnapshot().workspace.noteLists.all.order,
        tabs: library.getSnapshot().workspace.tabs,
      }
    })
  const saved = await readOrder()
  expect(saved.order.indexOf('virtual-1')).toBeGreaterThan(20)
  expect(saved.order[0]).toBe('virtual-0')
  expect(saved.tabs).toHaveLength(0)

  await pane.evaluate((el) => {
    el.scrollTop = 0
  })
  const source = page.getByRole('button', { name: 'Synthetic 00002', exact: true })
  const point = await source.boundingBox()
  await page.mouse.move(x, point!.y + point!.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(20)
  await page.mouse.move(x, area!.y + area!.height - 3)
  await expect(page.locator('.note-drag-ghost')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(page.locator('.note-drag-ghost')).toHaveCount(0)
  expect((await readOrder()).order).toEqual(saved.order)
})
