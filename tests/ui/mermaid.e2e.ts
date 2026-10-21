import { expect, test, type Page } from '@playwright/test'

async function setSource(page: Page, source: string, language = 'mermaid') {
  return page.locator('.tiptap').evaluate(
    async (_dom, { source, language }) => {
      const url = performance
        .getEntriesByType('resource')
        .find((entry) => new URL(entry.name).pathname === '/src/editor/session.ts')!.name
      const { getEditor } = await import(/* @vite-ignore */ url)
      const editor = getEditor('writing-lab', {})
      editor.commands.setContent({
        type: 'doc',
        content: [
          {
            type: 'codeBlock',
            attrs: { language },
            content: source ? [{ type: 'text', text: source }] : [],
          },
          { type: 'paragraph', content: [{ type: 'text', text: 'After diagram' }] },
        ],
      })
      editor.commands.setTextSelection(1)
      return editor.getJSON()
    },
    { source, language },
  )
}

const flowchart = 'flowchart LR\nA[Write notes] --> B[Save locally] --> C[Find later]'

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 900, height: 650 },
]) {
  test(`${viewport.width}: Mermaid source editing, language changes and syntax recovery`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport)
    await page.goto('/')
    await page.locator('.note-row[data-note-id="writing-lab"]').click()
    await page.screenshot({ path: test.info().outputPath('before.png') })
    const before = await setSource(page, flowchart)
    const preview = page.locator('.mermaid-preview')
    await expect(preview.locator('svg')).toBeVisible()
    await expect(preview).toContainText('Write notes')
    expect(
      await page.locator('.tiptap').evaluate(async () => {
        const url = performance
          .getEntriesByType('resource')
          .find((entry) => new URL(entry.name).pathname === '/src/editor/session.ts')!.name
        return (await import(/* @vite-ignore */ url)).getEditor('writing-lab', {}).getJSON()
      }),
    ).toEqual(before)
    await page.screenshot({ path: test.info().outputPath('rendered.png') })
    await page.getByLabel('Code language', { exact: true }).selectOption('plaintext')
    await expect(preview).toHaveCount(0)
    await page.getByLabel('Code language', { exact: true }).selectOption('mermaid')
    await expect(preview.locator('svg')).toBeVisible()
    await setSource(page, 'flowchart LR\nA[unfinished')
    await expect(preview).toContainText('Unable to render diagram.')
    await expect(page.locator('body > div[id^="dstash-mermaid"]')).toHaveCount(0)
    await setSource(page, 'sequenceDiagram\nAlice->>Bob: Hello\nBob-->>Alice: Hi')
    await expect(preview.locator('svg')).toBeVisible()
    await expect(preview).toContainText('Hello')
    await page.locator('.tiptap pre code').click()
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter')
    await expect(page.getByLabel('Code language', { exact: true })).toHaveCount(0)
    await expect(preview.locator('svg')).toBeVisible()
  })
}

test('Mermaid follows light and dark color modes without saving preview data', async ({ page }) => {
  test.setTimeout(120000)
  await page.goto('/')
  await page.locator('.note-row[data-note-id="writing-lab"]').click()
  const before = await setSource(page, flowchart)
  await expect(page.locator('.mermaid-preview svg')).toBeVisible()
  for (const colorMode of ['dark', 'light'] as const) {
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page
      .getByRole('radiogroup', { name: 'Appearance', exact: true })
      .getByRole('radio', { name: colorMode === 'dark' ? 'Dark' : 'Light', exact: true })
      .click()
    await page.getByLabel('Close settings').click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', colorMode)
    const preview = page.locator('.mermaid-preview')
    await expect(preview).toHaveAttribute('aria-busy', 'false')
    await expect(preview.locator('svg')).toBeVisible()
    await expect(preview).toContainText('Save locally')
    const colors = () =>
      preview.evaluate((element) => {
        const ctx = document.createElement('canvas').getContext('2d')!
        const style = getComputedStyle(element)
        // Text tokens can be translucent; diagrams draw them over the opaque content surface.
        const rgb = (color: string) => {
          ctx.fillStyle = style.getPropertyValue('--bg-content')
          ctx.fillRect(0, 0, 1, 1)
          ctx.fillStyle = color
          ctx.fillRect(0, 0, 1, 1)
          return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3)
        }
        return {
          expected: rgb(style.getPropertyValue('--text')),
          actual: rgb(getComputedStyle(element.querySelector('text')!).fill),
        }
      })
    await expect
      .poll(
        async () => {
          const { expected, actual } = await colors()
          return actual.join() === expected.join()
        },
        { message: colorMode },
      )
      .toBe(true)
  }
  expect(
    await page.locator('.tiptap').evaluate(async () => {
      const url = performance
        .getEntriesByType('resource')
        .find((entry) => new URL(entry.name).pathname === '/src/editor/session.ts')!.name
      return (await import(/* @vite-ignore */ url)).getEditor('writing-lab', {}).getJSON()
    }),
  ).toEqual(before)
})

test('diagram directives and labels cannot add executable content, links or remote images', async ({
  page,
}) => {
  await page.goto('/')
  await page.locator('.note-row[data-note-id="writing-lab"]').click()
  await setSource(
    page,
    '%%{init: {"securityLevel": "loose", "htmlLabels": true}}%%\nflowchart LR\nA["<img src=https://example.com/tracker onerror=alert(1)>"] --> B[Safe]\nclick B "https://example.com"',
  )
  const preview = page.locator('.mermaid-preview')
  await expect(preview.locator('svg')).toBeVisible()
  await expect(
    preview.locator('script, foreignObject, a, image, img, [onclick], [onerror]'),
  ).toHaveCount(0)
  await expect(preview).toContainText('Safe')
})

test('linked Markdown renders in read-only mode and preserves its source on save', async ({
  page,
}) => {
  await page.goto('/')
  await page.locator('.note-row[data-note-id="writing-lab"]').click()
  const source = '```mermaid\r\ngraph TD\r\nA-->B\r\n```\r\n'
  const saved = await page.locator('.tiptap').evaluate(async (dom, source) => {
    const url = performance
      .getEntriesByType('resource')
      .find((entry) => new URL(entry.name).pathname === '/src/editor/session.ts')!.name
    const { getEditor } = await import(/* @vite-ignore */ url)
    const { parseMarkdown, serializeMarkdown } = await import(
      /* @vite-ignore */ new URL('./markdown.ts', url).href
    )
    const linked = getEditor('linked-mermaid-test', parseMarkdown(source), undefined, true)
    linked.setEditable(false, false)
    const host = document.createElement('div')
    host.className = 'linked-mermaid-test'
    dom.parentElement!.append(host)
    host.append(linked.view.dom)
    return serializeMarkdown(linked.getJSON(), source)
  }, source)
  expect(saved).toBe(source)
  await expect(page.locator('.linked-mermaid-test .mermaid-preview svg')).toBeVisible()
  const edited = await page.locator('.linked-mermaid-test').evaluate(async () => {
    const url = performance
      .getEntriesByType('resource')
      .find((entry) => new URL(entry.name).pathname === '/src/editor/session.ts')!.name
    const { getEditor } = await import(/* @vite-ignore */ url)
    const { serializeMarkdown } = await import(
      /* @vite-ignore */ new URL('./markdown.ts', url).href
    )
    // Reuse the Markdown session; a rich-text request would replace it with an empty editor.
    const linked = getEditor('linked-mermaid-test', {}, undefined, true)
    linked.setEditable(true, false)
    linked.commands.setTextSelection(1)
    linked.commands.insertContent('%% edited\n')
    return serializeMarkdown(linked.getJSON())
  })
  expect(edited).toContain('```mermaid\n%% edited\n')
  expect(edited).not.toContain('<svg')
})

for (const viewport of [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
]) {
  test(`mobile ${viewport.width}: diagrams stay inside the note width`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/?mobile=1')
    await page.getByText('A garden journal', { exact: true }).click()
    await setSource(page, flowchart)
    const preview = page.locator('.mermaid-preview')
    await expect(preview.locator('svg')).toBeVisible()
    const bounds = await preview.boundingBox()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      viewport.width,
    )
    await page.screenshot({ path: test.info().outputPath('mobile-rendered.png') })
  })
}
