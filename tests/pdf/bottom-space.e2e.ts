import { expect, test } from '@playwright/test'
import { fileURLToPath } from 'node:url'

test('PDF companion retains scroll room and position across hide, show and narrow-pane switching', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(String(error)))
  await page.goto('/')
  await page
    .locator('input[type=file][accept="application/pdf,.pdf"]')
    .setInputFiles(fileURLToPath(new URL('./fixtures/text.pdf', import.meta.url)))
  await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Take notes', exact: true }).click()
  const pane = page.locator('.note-scroll[data-note-id]')
  const editor = pane.locator('.tiptap')
  await expect(editor).toBeVisible()
  const state = await pane.evaluate(async (el) => {
    const url = performance
      .getEntriesByType('resource')
      .find((entry) => new URL(entry.name).pathname === '/src/editor/session.ts')!.name
    const { getEditor } = await import(/* @vite-ignore */ url)
    const editor = getEditor((el as HTMLElement).dataset.noteId, {})
    editor.commands.setContent('<p>Writing beside the PDF.</p>'.repeat(60))
    return { content: editor.getJSON(), undo: editor.can().undo() }
  })
  const checkRoom = async () => {
    await expect
      .poll(() =>
        pane.evaluate((el) =>
          Math.abs(
            parseFloat(getComputedStyle(el, '::after').height) - (el.clientHeight / 2 + 112),
          ),
        ),
      )
      .toBeLessThan(1)
    await pane.evaluate((el) => {
      el.scrollTop = el.scrollHeight
    })
    expect(
      await pane.evaluate(
        (el) =>
          el.querySelector('.tiptap > :last-child')!.getBoundingClientRect().bottom -
          el.getBoundingClientRect().top,
      ),
    ).toBeLessThan(await pane.evaluate((el) => el.clientHeight / 2))
  }
  await checkRoom()
  const saved = await pane.evaluate((el) => el.scrollTop)
  await page.getByRole('button', { name: 'Hide notes', exact: true }).click()
  await page.getByRole('button', { name: 'Show notes', exact: true }).click()
  await expect.poll(() => pane.evaluate((el) => el.scrollTop)).toBe(saved)
  await page.setViewportSize({ width: 900, height: 650 })
  await page.getByRole('button', { name: 'Notes', exact: true }).click()
  await checkRoom()
  const narrowPosition = await pane.evaluate((el) => el.scrollTop)
  await page.getByRole('button', { name: 'PDF', exact: true }).click()
  await expect(editor).toBeHidden()
  await page.getByRole('button', { name: 'Notes', exact: true }).click()
  await expect(editor).toBeVisible()
  await expect.poll(() => pane.evaluate((el) => el.scrollTop)).toBe(narrowPosition)
  expect(
    await pane.evaluate(async (el) => {
      const url = performance
        .getEntriesByType('resource')
        .find((entry) => new URL(entry.name).pathname === '/src/editor/session.ts')!.name
      const { getEditor } = await import(/* @vite-ignore */ url)
      const editor = getEditor((el as HTMLElement).dataset.noteId, {})
      return { content: editor.getJSON(), undo: editor.can().undo() }
    }),
  ).toEqual(state)
  await page.screenshot({ path: test.info().outputPath('companion-bottom-room.png') })
  expect(errors).toEqual([])
})
