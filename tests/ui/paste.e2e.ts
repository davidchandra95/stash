import { expect, test } from '@playwright/test'

for (const scenario of [
  { width: 1280, height: 800, theme: 'light', mobile: false },
  { width: 900, height: 650, theme: 'dark', mobile: false },
  { width: 390, height: 844, theme: 'light', mobile: true },
  { width: 844, height: 390, theme: 'dark', mobile: true },
]) {
  test(`${scenario.width} ${scenario.theme}: Markdown paste renders through a plain HTML wrapper`, async ({
    page,
  }) => {
    await page.setViewportSize(scenario)
    await page.goto(scenario.mobile ? '/?mobile=1' : '/')
    if (scenario.mobile) await page.getByText('A garden journal', { exact: true }).click()
    else await page.locator('.note-row[data-note-id="writing-lab"]').click()
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme
    }, scenario.theme)
    const editor = page.locator('.tiptap[aria-label="Note content"]')
    await editor.click()
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a')
    await editor.evaluate((dom) => {
      const data = new DataTransfer()
      const lines = [
        '### 6-Week Roadmap: Fintech & Crypto Backend Engineering',
        '',
        '**Bold text**',
        '',
        '| Topic | Priority | Target knowledge |',
        '| --- | --- | --- |',
        '| Financial ledger and accounting | Critical | Double-entry, debit/credit, immutable records |',
        '',
        '* [TigerBeetle: Financial Accounting](https://docs.tigerbeetle.com/coding/financial-accounting/)',
      ]
      data.setData('text/plain', lines.join('\n'))
      data.setData(
        'text/html',
        lines
          .map(
            (line, index) =>
              `<p ${index === 0 ? 'data-pm-slice="0 0 []"' : ''} style="color: rgb(255, 255, 255); font-weight: 400; text-align: start">${line || '<br>'}</p>`,
          )
          .join(''),
      )
      dom.dispatchEvent(
        new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }),
      )
    })
    await expect(editor.locator('h3')).toHaveText(
      '6-Week Roadmap: Fintech & Crypto Backend Engineering',
    )
    await expect(editor.locator('strong')).toHaveText('Bold text')
    await expect(editor.locator('table')).toHaveCount(1)
    await expect(editor.locator('tr')).toHaveCount(2)
    await expect(editor.locator('a')).toHaveText('TigerBeetle: Financial Accounting')
    await page.screenshot({ path: test.info().outputPath('rendered-paste.png') })
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
    await expect(editor.locator('h3', { hasText: '6-Week Roadmap' })).toHaveCount(0)
  })
}

for (const mobile of [false, true]) {
  test(`linked Markdown ${mobile ? 'mobile' : 'desktop'}: list links render on open and paste`, async ({
    page,
  }) => {
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 })
    await page.goto(mobile ? '/?mobile=1' : '/')
    if (mobile) await page.getByText('A garden journal', { exact: true }).click()
    else await page.locator('.note-row[data-note-id="writing-lab"]').click()
    const source =
      '- [Guide](https://example.com/guide) and **bold**\n  - *[Nested](https://example.com/nested)*\n'
    const saved = await page.locator('.tiptap').evaluate(async (dom, source) => {
      const url = performance
        .getEntriesByType('resource')
        .find((entry) => new URL(entry.name).pathname === '/src/editor/session.ts')!.name
      const { getEditor } = await import(/* @vite-ignore */ url)
      const { parseMarkdown, serializeMarkdown } = await import(
        /* @vite-ignore */ new URL('./markdown.ts', url).href
      )
      const editor = getEditor('linked-markdown-paste', parseMarkdown(source), undefined, true)
      const host = document.createElement('div')
      host.className = 'linked-markdown-test'
      dom.parentElement!.append(host)
      host.append(editor.view.dom)
      editor.commands.selectAll()
      editor.view.focus()
      return serializeMarkdown(editor.getJSON(), source)
    }, source)
    expect(saved).toBe(source)
    const linked = page.locator('.linked-markdown-test .tiptap')
    await expect(linked.locator('li a')).toHaveText(['Guide', 'Nested'])
    await expect(linked.locator('li strong')).toHaveText('bold')
    await expect(linked.locator('li li em')).toHaveText('Nested')
    await linked.evaluate((dom) => {
      const data = new DataTransfer()
      data.setData('text/plain', '* [Pasted guide](https://example.com/pasted)')
      data.setData(
        'text/html',
        '<p data-pm-slice="0 0 []" style="color: white">* [Pasted guide](https://example.com/pasted)</p>',
      )
      dom.dispatchEvent(
        new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }),
      )
    })
    await expect(linked.locator('li a')).toHaveText('Pasted guide')
    await expect(linked.locator('li a')).toHaveAttribute('href', 'https://example.com/pasted')
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
    await expect(linked.locator('li a')).toHaveText(['Guide', 'Nested'])
  })
}
