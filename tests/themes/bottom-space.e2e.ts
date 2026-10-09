import { expect, test, type Page } from '@playwright/test'

async function fixtures(page: Page, appStyle: 'default' | 'cards') {
  await page.goto('/')
  await expect(page.locator('.note-scroll .tiptap')).toBeVisible()
  await page.evaluate(async (appStyle) => {
    const url = performance
      .getEntriesByType('resource')
      .find((entry) => new URL(entry.name).pathname === '/src/storage/useLibrary.ts')!.name
    const { library } = await import(/* @vite-ignore */ url)
    library.setAppearance({
      ...library.getSnapshot().appearance,
      appStyle,
      animationsEnabled: false,
    })
    const paragraphs = Array.from({ length: 60 }, (_, i) => ({
      type: 'paragraph',
      content: [{ type: 'text', text: `Writing line ${i + 1}.` }],
    }))
    const base = {
      notebookIds: [],
      tags: [],
      quickAccess: false,
      pinned: false,
      trashed: false,
      updated: Date.now(),
    }
    library.setNotes([
      {
        ...base,
        id: 'room-long',
        title: 'Long room test',
        text: 'Writing lines',
        content: { type: 'doc', content: paragraphs },
      },
      {
        ...base,
        id: 'room-short',
        title: 'Short room test',
        text: 'Short note',
        content: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Short note' }] }],
        },
      },
      {
        ...base,
        id: 'room-empty',
        title: 'Empty room test',
        text: '',
        content: { type: 'doc', content: [{ type: 'paragraph' }] },
      },
      {
        ...base,
        id: 'room-markdown',
        title: 'Markdown room test',
        text: 'Writing lines',
        content: { type: 'doc', content: paragraphs },
        source: { rootId: 'room-root', relativePath: 'room.md', fingerprint: '' },
      },
    ])
  }, appStyle)
  await page.locator('.note-row[data-note-id="room-long"]').click()
}

async function setExtra(page: Page, editorBottomSpace: number) {
  await page.evaluate(async (editorBottomSpace) => {
    const url = performance
      .getEntriesByType('resource')
      .find((entry) => new URL(entry.name).pathname === '/src/storage/useLibrary.ts')!.name
    const { library } = await import(/* @vite-ignore */ url)
    library.setAppearance({ ...library.getSnapshot().appearance, editorBottomSpace })
  }, editorBottomSpace)
}

async function checkRoom(page: Page, extra: number, long = true) {
  const pane = page.locator('.note-scroll[data-note-id]')
  await expect
    .poll(() =>
      pane.evaluate((el) => {
        const padding = parseFloat(getComputedStyle(el, '::after').height)
        const extra = parseFloat(getComputedStyle(el).getPropertyValue('--editor-bottom-space'))
        return Math.abs(padding - Math.max(112, el.clientHeight / 2 + extra))
      }),
    )
    .toBeLessThan(1)
  expect(
    await pane.evaluate((el) =>
      parseFloat(getComputedStyle(el).getPropertyValue('--editor-bottom-space')),
    ),
  ).toBe(extra)
  await pane.evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
  if (long) {
    const geometry = await pane.evaluate((el) => ({
      midpoint: el.getBoundingClientRect().top + el.clientHeight / 2,
      lastLine: el.querySelector('.tiptap > :last-child')!.getBoundingClientRect().bottom,
      toolbar: document.querySelector('.writing-dock')!.getBoundingClientRect().top,
    }))
    expect(geometry.lastLine).toBeLessThanOrEqual(geometry.midpoint + 2)
    expect(geometry.lastLine).toBeLessThan(geometry.toolbar)
  }
}

async function documentState(page: Page) {
  return page.locator('.note-scroll[data-note-id]').evaluate(async (pane) => {
    const url = performance
      .getEntriesByType('resource')
      .find((entry) => new URL(entry.name).pathname === '/src/editor/session.ts')!.name
    const { getEditor } = await import(/* @vite-ignore */ url)
    const editor = getEditor((pane as HTMLElement).dataset.noteId, {})
    return { content: editor.getJSON(), undo: editor.can().undo(), redo: editor.can().redo() }
  })
}

for (const appStyle of ['default', 'cards'] as const) {
  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 900, height: 650 },
  ]) {
    test(`${appStyle} ${viewport.width}: scroll past the note, restore and resize without document changes`, async ({
      page,
    }) => {
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(String(error)))
      await page.setViewportSize(viewport)
      await fixtures(page, appStyle)
      const before = await documentState(page)
      for (const extra of [0, 112, 400]) {
        await setExtra(page, extra)
        await checkRoom(page, extra)
      }
      await setExtra(page, 112)
      const previousSpacing = await page.addStyleTag({
        content:
          ':root[data-platform="desktop"] .note-scroll[data-note-id] { padding-bottom: var(--editor-bottom-space); } :root[data-platform="desktop"] .note-scroll[data-note-id]::after { display: none; }',
      })
      await page.locator('.note-scroll[data-note-id]').evaluate((el) => {
        el.scrollTop = el.scrollHeight
      })
      expect(
        await page
          .locator('.note-scroll[data-note-id]')
          .evaluate(
            (el) =>
              el.getBoundingClientRect().bottom -
              el.querySelector('.tiptap > :last-child')!.getBoundingClientRect().bottom,
          ),
      ).toBeCloseTo(112, 0)
      await page.screenshot({ path: test.info().outputPath('bottom-room-before.png') })
      await previousSpacing.evaluate((el) => el.remove())
      await checkRoom(page, 112)
      await page.screenshot({ path: test.info().outputPath('bottom-room.png') })
      const pane = page.locator('.note-scroll[data-note-id]')
      const position = await pane.evaluate((el) => el.scrollTop)
      await page.locator('.note-row[data-note-id="room-short"]').click()
      await checkRoom(page, 112, false)
      await page.locator('.note-row[data-note-id="room-long"]').click()
      await expect.poll(() => pane.evaluate((el) => el.scrollTop)).toBe(position)
      await page.getByRole('button', { name: 'Focus mode', exact: true }).click()
      await checkRoom(page, 112)
      await page.getByRole('button', { name: 'Table of contents', exact: true }).click()
      await expect(page.locator('.note-outline')).toBeVisible()
      await checkRoom(page, 112)
      await page.getByRole('button', { name: 'Close table of contents', exact: true }).click()
      await page.setViewportSize({ width: viewport.width, height: viewport.height - 64 })
      await checkRoom(page, 112)
      expect(await pane.evaluate((el) => el.getBoundingClientRect().bottom)).toBeLessThanOrEqual(
        viewport.height - 64,
      )
      expect(await documentState(page)).toEqual(before)
      await page.getByRole('button', { name: 'Exit focus mode', exact: true }).click()
      for (const id of ['room-short', 'room-empty', 'room-markdown']) {
        await page.locator(`.note-row[data-note-id="${id}"]`).click()
        const state = await documentState(page)
        for (const extra of [0, 112, 400]) {
          await setExtra(page, extra)
          await checkRoom(page, extra, id === 'room-markdown')
        }
        expect(await documentState(page)).toEqual(state)
      }
      expect(await page.evaluate(() => window.scrollY)).toBe(0)
      expect(errors).toEqual([])
    })
  }
}

test('desktop bottom-space setting explains automatic room and preserves its range', async ({
  page,
}) => {
  await page.goto('/')
  await page.locator('.account-trigger').click()
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click()
  await page
    .getByRole('navigation', { name: 'Settings categories' })
    .getByRole('button', { name: 'Editor', exact: true })
    .click()
  const slider = page.getByRole('slider', { name: 'Extra space below the note', exact: true })
  await expect(slider).toHaveValue('112')
  await expect(slider).toHaveAttribute('min', '0')
  await expect(slider).toHaveAttribute('max', '400')
  await expect(slider).toHaveAttribute('step', '8')
  await expect(
    page.getByText('112 px extra. Half the editor height is already included for scrolling.'),
  ).toBeVisible()
  await slider.press('End')
  await expect(slider).toHaveValue('400')
  await page.getByLabel('Close settings').click()
  await checkRoom(page, 400, false)
})

test('mobile keeps existing bottom padding in portrait and landscape', async ({ page }) => {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport)
    await page.goto('/?mobile=1')
    await expect(page.locator('.mobile-app')).toBeVisible()
    await page.getByText('A garden journal', { exact: true }).click()
    const pane = page.locator('.mobile-note-scroll')
    await expect(pane.locator('.tiptap')).toBeVisible()
    for (const extra of [0, 112, 400]) {
      await setExtra(page, extra)
      await expect
        .poll(() =>
          pane
            .locator('.note-article')
            .evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom)),
        )
        .toBe(Math.max(112, extra) + 88)
      expect(await pane.evaluate((el) => el.style.getPropertyValue('--editor-scroll-room'))).toBe(
        '',
      )
    }
  }
})
