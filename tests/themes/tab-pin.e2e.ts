import { expect, test } from '@playwright/test'

for (const dark of [false, true])
  for (const style of ['default', 'cards']) {
    test(`pins tabs, protects closing, and constrains order ${dark ? 'dark' : 'light'} ${style}`, async ({
      page,
    }) => {
      await page.setViewportSize({
        width: style === 'cards' ? 900 : 1280,
        height: style === 'cards' ? 650 : 800,
      })
      await page.goto('/')
      await page.locator('.note-row').first().waitFor()
      await page.locator('.account-trigger').click()
      await page.getByRole('menuitem', { name: 'Settings', exact: true }).click()
      await page.getByRole('button', { name: dark ? 'Dark' : 'Light', exact: true }).click()
      await page.locator(`input[name="app-style"][value="${style}"]`).check()
      await page.getByLabel('Close settings').click()
      for (let i = 0; i < 3; i++)
        await page
          .locator('.note-row')
          .nth(i)
          .click({ modifiers: ['Meta'] })
      const strip = page.locator('.note-tabs')
      const items = strip.locator('[data-tab-id]')
      const id = await items.nth(1).getAttribute('data-tab-id')
      const tab = strip.locator(`[data-tab-id="${id}"]`)
      const active = await strip.locator('.active').getAttribute('data-tab-id')
      await tab.click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Pin tab', exact: true }).click()
      await expect(items.first()).toHaveAttribute('data-tab-id', id!)
      await expect(tab).toHaveClass(/pinned/)
      expect(await strip.locator('.active').getAttribute('data-tab-id')).toBe(active)
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
        path: `.artifact-work/tab-pin-${dark ? 'dark' : 'light'}-${style}.png`,
      })
      await tab.getByRole('button', { name: /^Unpin / }).click()
      await expect(tab).not.toHaveClass(/pinned/)
      await expect(tab.getByRole('button', { name: /^Close / })).toBeVisible()
      await tab.getByRole('tab').focus()
      await page.keyboard.press('Shift+F10')
      await page.getByRole('menuitem', { name: 'Pin tab', exact: true }).click()
      await expect(tab.getByRole('tab')).toBeFocused()
      await tab.click({ button: 'right' })
      await expect(page.getByRole('menuitem', { name: 'Unpin tab', exact: true })).toBeVisible()
      await page.getByRole('menuitem', { name: 'Close', exact: true }).click()
      await expect(tab).toHaveCount(0)
      await expect(strip.locator('.active [role="tab"]')).toBeFocused()
    })
  }
