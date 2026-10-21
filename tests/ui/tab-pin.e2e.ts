import { expect, test } from '@playwright/test'

for (const colorMode of ['light', 'dark'] as const)
  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 900, height: 650 },
  ]) {
    test(`pins tabs, protects closing, and constrains order ${colorMode} ${viewport.width}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport)
      await page.goto('/')
      await page.locator('.note-row').first().waitFor()
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      await page
        .getByRole('radiogroup', { name: 'Appearance', exact: true })
        .getByRole('radio', { name: colorMode === 'dark' ? 'Dark' : 'Light', exact: true })
        .click()
      await page.getByLabel('Close settings').click()
      await expect(page.locator('html')).toHaveAttribute('data-theme', colorMode)
      for (let i = 0; i < 3; i++)
        await page
          .locator('.note-row')
          .nth(i)
          .click({ modifiers: ['Meta'] })
      const strip = page.getByRole('tablist', { name: 'Open documents', exact: true })
      const items = strip.locator('[data-tab-id]')
      const id = await items.nth(1).getAttribute('data-tab-id')
      const tab = strip.locator(`[data-tab-id="${id}"]`)
      const active = await strip.locator('.is-active').getAttribute('data-tab-id')
      await tab.click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Pin tab', exact: true }).click()
      await expect(items.first()).toHaveAttribute('data-tab-id', id!)
      await expect(tab).toHaveClass(/is-pinned/)
      expect(await strip.locator('.is-active').getAttribute('data-tab-id')).toBe(active)
      await expect(tab.getByRole('button', { name: /^Unpin / })).toHaveCSS('opacity', '1')
      await tab.getByRole('tab').click()
      await page.keyboard.press('Control+w')
      await expect(tab).toBeVisible()
      await tab.getByRole('tab').press('Control+Shift+ArrowRight')
      await expect(items.first()).toHaveAttribute('data-tab-id', id!)
      // Dragging the only pinned tab cannot cross into the unpinned group.
      const box = await tab.getByRole('tab').boundingBox()
      await page.mouse.move(box!.x + 30, box!.y + 16)
      await page.mouse.down()
      await page.mouse.move(box!.x + 280, box!.y + 16, { steps: 12 })
      await expect(tab).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)')
      await page.mouse.up()
      await expect(items.first()).toHaveAttribute('data-tab-id', id!)
      await page.screenshot({
        path: test.info().outputPath(`tab-pin-${colorMode}-${viewport.width}.png`),
      })
      await tab.getByRole('button', { name: /^Unpin / }).click()
      await expect(tab).not.toHaveClass(/is-pinned/)
      await expect(tab.getByRole('button', { name: /^Close / })).toBeVisible()
      await tab.getByRole('tab').focus()
      await page.keyboard.press('Shift+F10')
      await page.getByRole('menuitem', { name: 'Pin tab', exact: true }).click()
      await expect(tab.getByRole('tab')).toBeFocused()
      await tab.click({ button: 'right' })
      await expect(page.getByRole('menuitem', { name: 'Unpin tab', exact: true })).toBeVisible()
      await page.getByRole('menuitem', { name: 'Close', exact: true }).click()
      await expect(tab).toHaveCount(0)
      await expect(strip.locator('.is-active [role="tab"]')).toBeFocused()
    })
  }
