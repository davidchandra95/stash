import { expect, test } from '@playwright/test'

test('keeps earlier versions of a note and restores one with undo', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-07T09:00:00') })
  await page.goto('/')
  await page.getByRole('button', { name: 'A little room to think', exact: true }).click()
  const editor = page.locator('.editor-body .tiptap').first()
  await expect(editor).toContainText('Make yourself at home')

  // The first change keeps the body from before it.
  await editor.click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type(' First edit.')
  // Later changes within ten minutes keep nothing more; after that, one more version.
  await page.keyboard.type(' Still first.')
  await page.clock.fastForward('11:00')
  await page.keyboard.type(' Second edit.')
  await expect(editor).toContainText('Second edit.')

  await page.getByRole('button', { name: 'A little room to think', exact: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Version history…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Version history' })
  const versions = dialog.getByRole('listbox', { name: 'Versions' }).getByRole('option')
  await expect(versions).toHaveCount(3)
  await expect(versions.first()).toContainText('Current version')
  const preview = dialog.getByRole('document', { name: 'Version preview' })
  await expect(preview).toContainText('Second edit.')
  await expect(dialog.getByRole('button', { name: 'Restore this version' })).toBeDisabled()

  // The newest kept version has the first edits; the oldest has none.
  await versions.nth(1).click()
  await expect(preview).toContainText('Still first.')
  await expect(preview).not.toContainText('Second edit.')
  await versions.nth(2).click()
  await expect(preview).not.toContainText('First edit.')
  await dialog.getByRole('button', { name: 'Restore this version' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(editor).not.toContainText('First edit.')
  await expect(editor).toContainText('Make yourself at home')

  // Restoring kept the replaced body, and Undo brings it back.
  await page.getByRole('button', { name: 'A little room to think', exact: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Version history…' }).click()
  await versions.nth(1).click()
  await expect(preview).toContainText('Second edit.')
  await dialog.getByRole('button', { name: 'Close' }).click()
  await editor.click()
  await page.keyboard.press('ControlOrMeta+z')
  await expect(editor).toContainText('Second edit.')
})
