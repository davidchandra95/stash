import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

// The browser preview downloads a single note's export; folder exports need the native app.
test('exports a note as Markdown and as HTML from its context menu', async ({ page }) => {
  await page.goto('/')
  const row = page.getByRole('button', { name: 'A garden journal', exact: true })
  await expect(row).toBeVisible()

  await row.click({ button: 'right' })
  const markdown = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: 'Export as Markdown…' }).click()
  const md = await markdown
  expect(md.suggestedFilename()).toBe('A garden journal.md')
  const text = await readFile((await md.path())!, 'utf8')
  expect(text.startsWith('# A garden journal\n')).toBe(true)
  expect(text).toContain('Garden journal')
  await expect(page.getByRole('status').filter({ hasText: 'Exported “A garden journal”.' })).toBeVisible()

  await row.click({ button: 'right' })
  const html = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: 'Export as HTML…' }).click()
  const file = await html
  expect(file.suggestedFilename()).toBe('A garden journal.html')
  const page2 = await readFile((await file.path())!, 'utf8')
  expect(page2).toContain('<title>A garden journal</title>')
  expect(page2).not.toContain('<script')

  // Folder exports aren't offered in the browser preview.
  await page.getByRole('button', { name: /Search notes/ }).click()
  await page.keyboard.type('Export all')
  await expect(page.getByRole('option', { name: 'Export all notes…' })).toHaveCount(0)
})
