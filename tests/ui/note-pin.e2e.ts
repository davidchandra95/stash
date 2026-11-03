import { expect, test, type Page } from '@playwright/test'

async function fixture(page: Page, animationsEnabled = true) {
  await page.evaluate(async (animationsEnabled) => {
    const moduleUrl = performance
      .getEntriesByType('resource')
      .find((entry) => new URL(entry.name).pathname === '/src/storage/useLibrary.ts')!.name
    const { library } = await import(/* @vite-ignore */ moduleUrl)
    library.setNotes(
      Array.from({ length: 40 }, (_, i) => ({
        id: `pin-${i}`,
        title: `Pin test ${String(i).padStart(2, '0')}`,
        text: 'A note for checking pin movement.',
        content: { type: 'doc', content: [{ type: 'paragraph' }] },
        notebookIds: [],
        tags: [],
        pinned: false,
        trashed: false,
        quickAccess: false,
        updated: 1760000000000 - i,
      })),
    )
    library.setWorkspace({
      tabs: [],
      activeTabId: null,
      sidebarView: 'all',
      noteListMode: 'compact',
    })
    library.setNoteList('all', { mode: 'title', order: [] })
    library.setAppearance({ ...library.getSnapshot().appearance, animationsEnabled })
  }, animationsEnabled)
}

for (const mobile of [false, true]) {
  test(`${mobile ? 'mobile' : 'desktop'}: pin moves stay local and respect motion preferences`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 })
    await page.goto(mobile ? '/?mobile=1' : '/')
    const rows = page.locator(mobile ? '.mobile-list' : '.note-rows')
    await expect(rows).toBeVisible()
    await fixture(page)
    if (mobile) {
      await page.getByRole('button', { name: 'Page actions', exact: true }).click()
      await page.getByRole('button', { name: 'Sort by title', exact: true }).click()
    }
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'on')
    await page.evaluate(() => {
      type Entry = { id: string; frames: Keyframe[]; result: string }
      const records: Entry[] = []
      Object.assign(window, { pinMotions: records, capturePin: true })
      const original = Element.prototype.animate
      Element.prototype.animate = function (frames, options) {
        const animation = original.call(this, frames, options)
        const id = (this as HTMLElement).dataset.noteId
        if (id) {
          if ((window as unknown as { capturePin: boolean }).capturePin) {
            animation.pause()
            animation.currentTime = 45
          }
          const record = { id, frames: frames as Keyframe[], result: 'running' }
          records.push(record)
          animation.finished.then(
            () => {
              record.result = 'finished'
            },
            () => {
              record.result = 'canceled'
            },
          )
        }
        return animation
      }
    })
    const motions = () =>
      page.evaluate(
        () => (window as unknown as { pinMotions: { id: string; result: string }[] }).pinMotions,
      )
    const clear = () =>
      page.evaluate(() => {
        ;(window as unknown as { pinMotions: unknown[] }).pinMotions.length = 0
      })
    const pin = async (index: number, unpin = false) => {
      const title = `Pin test ${String(index).padStart(2, '0')}`
      if (mobile) {
        await page.getByRole('button', { name: `Actions for ${title}`, exact: true }).click()
        await page
          .getByRole('button', { name: unpin ? 'Unpin' : 'Pin to top', exact: true })
          .click()
      } else {
        await page.getByRole('button', { name: title, exact: true }).press('Shift+F10')
        await page
          .getByRole('menuitem', { name: unpin ? 'Unpin' : 'Pin to top', exact: true })
          .click()
      }
    }
    await pin(2)
    await expect(rows.locator('.is-pin-moving')).toHaveCount(1)
    await page.screenshot({ path: test.info().outputPath('pin-moving.png') })
    await page.evaluate(() => {
      Object.assign(window, { capturePin: false })
      document.getAnimations().forEach((animation) => {
        if (animation.playState === 'paused') animation.play()
      })
    })
    await expect
      .poll(async () => (await motions()).filter((entry) => entry.result === 'finished').length)
      .toBe(3)
    await expect(rows.locator('[data-note-slot-id]').first()).toHaveAttribute(
      'data-note-slot-id',
      'pin-2',
    )
    await clear()
    await pin(2, true)
    await expect
      .poll(async () => (await motions()).filter((entry) => entry.result === 'finished').length)
      .toBe(3)
    await expect(rows.locator('[data-note-slot-id]').first()).toHaveAttribute(
      'data-note-slot-id',
      'pin-0',
    )
    await page.screenshot({ path: test.info().outputPath('pin-settled.png') })
    // Both positions fit, but crossing most of the list is deliberately immediate.
    await clear()
    await pin(6)
    expect(await motions()).toHaveLength(0)
    // A retained or overscan row does not count as a visible destination.
    await rows.evaluate((element) => {
      element.scrollTop = 700
    })
    await clear()
    await pin(15)
    expect(await motions()).toHaveLength(0)
    if (mobile) await page.getByRole('button', { name: 'Open navigation', exact: true }).click()
    await page.getByRole('button', { name: /^Pinned notes/ }).click()
    await clear()
    await pin(15, true)
    expect(await motions()).toHaveLength(0)
    await expect(rows.locator('[data-note-id="pin-15"]')).toHaveCount(0)
    if (mobile) await page.getByRole('button', { name: 'Open navigation', exact: true }).click()
    await page.getByRole('button', { name: /^All notes/ }).click()
    await page.setViewportSize(mobile ? { width: 844, height: 390 } : { width: 900, height: 650 })
    await page.evaluate(async () => {
      const moduleUrl = performance
        .getEntriesByType('resource')
        .find((entry) => new URL(entry.name).pathname === '/src/storage/useLibrary.ts')!.name
      const { library } = await import(/* @vite-ignore */ moduleUrl)
      library.setAppearance({
        ...library.getSnapshot().appearance,
        interfaceTheme: 'workspace',
        colorMode: 'dark',
        accent: 'green',
      })
    })
    await page.screenshot({ path: test.info().outputPath('pin-narrow-dark.png') })
    await fixture(page, false)
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'off')
    await clear()
    await pin(2)
    expect(await motions()).toHaveLength(0)
    await fixture(page)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'off')
    await clear()
    await pin(2)
    expect(await motions()).toHaveLength(0)
  })
}
