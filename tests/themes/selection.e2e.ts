import { expect, test, type Page } from '@playwright/test'

async function editorAction(page: Page, action: 'setup' | 'select' | 'caret' | 'clear', text = '') {
  return page.locator('.tiptap').evaluate(
    async (_dom, { action, text }) => {
      const url = performance
        .getEntriesByType('resource')
        .find((entry) => new URL(entry.name).pathname === '/src/editor/session.ts')!.name
      const { getEditor } = await import(/* @vite-ignore */ url)
      const editor = getEditor('writing-lab', {})
      if (action === 'setup') {
        editor.commands.setContent(
          '<ol><li><p><strong>First heading</strong></p><ul>' +
            '<li><p>Observation: a wrapped paragraph with <strong>formatted text</strong> and enough words to fill several lines in a narrow writing pane.</p></li>' +
            '<li><p>Root cause: another paragraph beside the selected text.</p></li>' +
            '</ul></li><li><p><strong>Second heading</strong></p><ul>' +
            '<li><p>First selected row</p></li><li><p>Second selected row</p></li>' +
            '<li><p>Third selected row</p></li></ul></li></ol><p>After list</p>',
        )
        editor.commands.setTextSelection(3)
        editor.view.focus()
      } else if (action === 'select' || action === 'caret') {
        editor.state.doc.descendants((node: { isText: boolean; text?: string }, pos: number) => {
          if (node.isText && node.text === text)
            editor.commands.setTextSelection({
              from: action === 'caret' ? pos + text.length : pos,
              to: pos + text.length,
            })
        })
        editor.view.focus()
      } else {
        // Reproduce the orphaned highlight: the browser drops its range after
        // copying, while the editor still has the previous text selection.
        document.getSelection()!.removeAllRanges()
        document.dispatchEvent(new Event('selectionchange'))
      }
      return editor.getJSON()
    },
    { action, text },
  )
}

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 900, height: 650 },
]) {
  test(`${viewport.width}: copied list selections clear without stale paint or saved changes`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport)
    await page.goto('/')
    await page.locator('.note-row[data-note-id="writing-lab"]').click()
    const before = await editorAction(page, 'setup')
    // Compare list pixels without caret blinking affecting the result.
    await page.addStyleTag({ content: '.writing-cursor-layer { visibility: hidden !important; }' })
    const list = page.locator('.tiptap > ul')
    await page.locator('.tiptap').evaluate((dom) => {
      dom.addEventListener('copy', () => dom.setAttribute('data-test-copied', 'true'))
    })

    for (const [index, text] of [
      'formatted text',
      'First selected row',
      'Third selected row',
    ].entries()) {
      await editorAction(page, 'caret', text)
      const baseline = await list.screenshot({ caret: 'hide', animations: 'disabled' })
      await editorAction(page, 'select', text)
      await expect(page.locator('.selection-highlight')).toHaveText(text)
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+c' : 'Control+c')
      await expect(page.locator('.tiptap')).toHaveAttribute('data-test-copied', 'true')
      expect(await editorAction(page, 'clear')).toEqual(before)
      await expect(page.locator('.selection-highlight')).toHaveCount(0)
      expect(await page.evaluate(() => document.getSelection()!.toString())).toBe('')
      expect(
        baseline.equals(
          await list.screenshot({
            path: test.info().outputPath('selection-after-clear.png'),
            caret: 'hide',
            animations: 'disabled',
          }),
        ),
        'Cleared list pixels must match the unselected list',
      ).toBe(true)

      // Also exercise the normal pointer path from the reported symptom.
      await editorAction(page, 'select', text)
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+c' : 'Control+c')
      // Iterations run under 500ms apart. Move each click more than 10px from
      // the last so ProseMirror does not count them as a double or triple click,
      // which would select the paragraph.
      await page.locator('.tiptap > p').click({ position: { x: 8 + 24 * index, y: 8 } })
      await expect(page.locator('.selection-highlight')).toHaveCount(0)
      expect(await page.evaluate(() => document.getSelection()!.toString())).toBe('')
    }

    await editorAction(page, 'select', 'Second selected row')
    await page.keyboard.press('Escape')
    await expect(page.locator('.selection-highlight')).toHaveCount(0)
    expect(await page.evaluate(() => document.getSelection()!.toString())).toBe('')
    await page.screenshot({ path: test.info().outputPath('selection-cleared.png') })
  })
}

test('desktop suppresses native block paint between selections and during copy focus changes', async ({
  page,
}) => {
  await page.goto('/')
  await page.locator('.note-row[data-note-id="writing-lab"]').click()
  await editorAction(page, 'setup')
  // Make the browser's fallback highlight explicit so the check can distinguish
  // it from the editor's transparent native paint, including when no text is selected.
  await page.addStyleTag({ content: '::selection { background-color: rgb(255, 0, 255); }' })
  const nativePaint = () =>
    page
      .locator('.tiptap li p')
      .first()
      .evaluate((p) => getComputedStyle(p, '::selection').backgroundColor)
  expect(await nativePaint()).toBe('rgba(0, 0, 0, 0)')
  await editorAction(page, 'select', 'formatted text')
  expect(await nativePaint()).toBe('rgba(0, 0, 0, 0)')
  await page.locator('.tiptap').evaluate((dom: HTMLElement) => dom.blur())
  expect(await nativePaint()).toBe('rgba(0, 0, 0, 0)')
  // Read-only notes still use native painting.
  await page.locator('.tiptap').evaluate(async () => {
    const url = performance
      .getEntriesByType('resource')
      .find((entry) => new URL(entry.name).pathname === '/src/editor/session.ts')!.name
    const { getEditor } = await import(/* @vite-ignore */ url)
    getEditor('writing-lab', {}).setEditable(false, false)
  })
  expect(await nativePaint()).toBe('rgb(255, 0, 255)')
})
