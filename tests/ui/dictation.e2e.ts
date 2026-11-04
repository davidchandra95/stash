import { test, expect, type Page } from '@playwright/test'

async function setup(page: Page) {
  await page.goto('/')
  await expect(
    page.getByRole('button', { name: 'Search notes and projects', exact: true }),
  ).toBeVisible()
  await page.evaluate(async () => {
    const find = (path: string) =>
      performance.getEntriesByType('resource').find((e) => new URL(e.name).pathname === path)!.name
    const { library } = await import(/* @vite-ignore */ find('/src/storage/useLibrary.ts'))
    const { platform } = await import(/* @vite-ignore */ find('/src/platform.ts'))
    const mocksUrl = '/node_modules/@tauri-apps/api/mocks.js'
    const { mockIPC, mockWindows } = await import(/* @vite-ignore */ mocksUrl)
    const models = [
      { id: 'small', bytes: 487601967, installed: false },
      { id: 'base', bytes: 147951465, installed: false },
    ]
    let progress = {
      sessionId: '',
      phase: 'idle',
      seconds: 0,
      downloaded: 0,
      total: 0,
      transcript: null as string | null,
      error: null as string | null,
    }
    mockIPC(
      (cmd: string, args: Record<string, string>) => {
        if (cmd === 'dictation_status') return { supported: true, models, progress }
        if (cmd === 'dictation_download') {
          progress = {
            ...progress,
            sessionId: args.sessionId,
            phase: 'downloading',
            total: 487601967,
          }
          setTimeout(() => {
            models.find((m) => m.id === args.modelId)!.installed = true
            progress = { ...progress, phase: 'idle', downloaded: 487601967 }
          }, 200)
        }
        if (cmd === 'dictation_start')
          Object.assign(globalThis, { dictationSession: args.sessionId })
        if (cmd === 'dictation_start')
          progress = {
            ...progress,
            sessionId: args.sessionId,
            phase: localStorage.getItem('dictation-test-deny') ? 'error' : 'recording',
            seconds: 12,
            error: localStorage.getItem('dictation-test-deny')
              ? 'Microphone permission denied. Check System Settings > Privacy & Security > Microphone.'
              : null,
          }
        if (cmd === 'dictation_stop') {
          progress = { ...progress, phase: 'transcribing' }
          setTimeout(() => {
            progress = {
              ...progress,
              phase: 'review',
              transcript: 'Hello. Hari ini saya menulis catatan.',
            }
          }, 150)
        }
        if (cmd === 'dictation_cancel')
          progress = { ...progress, phase: 'cancelled', transcript: null }
        if (cmd === 'dictation_delete_model')
          models.find((m) => m.id === args.modelId)!.installed = false
        if (cmd === 'installed_fonts') return []
        return null
      },
      { shouldMockEvents: true },
    )
    mockWindows('main')
    Object.assign(globalThis, { isTauri: true })
    platform.platform = 'macos'
    library.setAppearance({ ...library.getSnapshot().appearance, animationsEnabled: false })
  })
  await page.locator('.note-row').first().click()
  await expect(page.getByRole('button', { name: 'Dictate note', exact: true })).toBeEnabled()
}
// Recording starts by itself once the model is on disk, with no model or language choices.
async function record(page: Page) {
  await page.getByRole('button', { name: 'Dictate note', exact: true }).click()
  await page.getByRole('button', { name: 'Download model', exact: true }).click()
  await expect(page.getByRole('timer')).toHaveText('0:12')
  await expect(page.getByRole('combobox', { name: 'Speech model' })).toHaveCount(0)
}
async function review(page: Page) {
  await record(page)
  await page.getByRole('button', { name: 'Stop and review' }).click()
  await expect(page.getByRole('textbox', { name: 'Dictated text' })).toHaveValue(
    'Hello. Hari ini saya menulis catatan.',
  )
}
const composer = (page: Page) => page.getByRole('region', { name: 'Dictation' })
// Feeds the waveform the way the native worker does.
async function speak(page: Page) {
  await page.evaluate(async () => {
    const { emit } = await import(/* @vite-ignore */ '/node_modules/@tauri-apps/api/event.js')
    const sessionId = (globalThis as unknown as { dictationSession: string }).dictationSession
    for (let i = 0; i < 60; i++)
      await emit('dictation-level', {
        sessionId,
        level: i % 24 < 12 ? 0.02 + 0.1 * Math.abs(Math.sin(i)) : 0.002,
      })
  })
}

test('download, record, edit, insert, undo and redo in the original note', async ({ page }) => {
  await setup(page)
  const editor = page.locator('.note-scroll .tiptap').first()
  await editor.click()
  const before = await editor.innerText()
  await review(page)
  await page.getByRole('textbox', { name: 'Dictated text' }).fill('Halo **literal** <b>text</b>.')
  await page.getByRole('button', { name: 'Insert into note' }).click()
  await expect(composer(page)).toHaveCount(0)
  await expect(editor).toContainText('Halo **literal** <b>text</b>.')
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => editor.innerText()).toBe(before)
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect(editor).toContainText('Halo **literal** <b>text</b>.')
})

test('sending while recording inserts straight into the note', async ({ page }) => {
  await setup(page)
  const editor = page.locator('.note-scroll .tiptap').first()
  await editor.click()
  await record(page)
  await page.getByRole('button', { name: 'Insert into note' }).click()
  await expect(composer(page)).toHaveCount(0)
  await expect(editor).toContainText('Hello. Hari ini saya menulis catatan.')
})

test('the note stays editable while dictating and text goes in at the cursor', async ({ page }) => {
  await setup(page)
  const editor = page.locator('.note-scroll .tiptap').first()
  await editor.click()
  await review(page)
  await editor.click()
  await page.keyboard.type('Typed meanwhile. ')
  await page.getByRole('button', { name: 'Insert into note' }).click()
  await expect(editor).toContainText('Typed meanwhile. Hello. Hari ini')
})

test('a read-only note keeps the text but refuses insertion', async ({ page }) => {
  await setup(page)
  await review(page)
  await page.evaluate(async () => {
    const url = performance
      .getEntriesByType('resource')
      .find((e) => new URL(e.name).pathname === '/src/editor/session.ts')!.name
    const { peekEditor } = await import(/* @vite-ignore */ url)
    const id = document.querySelector<HTMLElement>('.note-scroll[data-note-id]')!.dataset.noteId
    peekEditor(id).setEditable(false)
  })
  await expect(page.getByRole('button', { name: 'Insert into note' })).toBeDisabled()
  await expect(page.getByRole('textbox', { name: 'Dictated text' })).toHaveValue(
    'Hello. Hari ini saya menulis catatan.',
  )
  await expect(page.getByRole('button', { name: 'Copy text' })).toBeVisible()
  await page.getByRole('button', { name: 'Discard' }).click()
})

test('dictating more appends, and cancelling that take keeps the text', async ({ page }) => {
  await setup(page)
  await review(page)
  const text = page.getByRole('textbox', { name: 'Dictated text' })
  await page.getByRole('button', { name: 'Dictate more' }).click()
  await expect(page.getByRole('timer')).toBeVisible()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(text).toHaveValue('Hello. Hari ini saya menulis catatan.')
  await page.getByRole('button', { name: 'Dictate more' }).click()
  await page.getByRole('button', { name: 'Stop and review' }).click()
  await expect(text).toHaveValue(
    'Hello. Hari ini saya menulis catatan. Hello. Hari ini saya menulis catatan.',
  )
})

test('the dictate button and Escape control a recording', async ({ page }) => {
  await setup(page)
  await record(page)
  await page.getByRole('button', { name: 'Dictate note', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Dictated text' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(composer(page)).toHaveCount(0)
})

test('Settings owns the model and language choices', async ({ page }, info) => {
  await setup(page)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Editor', exact: true }).click()
  await page.getByRole('combobox', { name: 'Speech model' }).scrollIntoViewIfNeeded()
  await page.getByRole('combobox', { name: 'Speech model' }).selectOption('base')
  await expect(page.getByRole('combobox', { name: 'Dictation language' })).toBeVisible()
  await page.screenshot({ path: info.outputPath('settings.png') })
  await page.getByRole('button', { name: 'Download', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Remove', exact: true })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('stash.dictation.v1'))).toContain('base')
})

test('the toolbar microphone uses the shared icon size', async ({ page }) => {
  await setup(page)
  const size = await page
    .getByRole('button', { name: 'Dictate note', exact: true })
    .locator('svg')
    .evaluate((icon) => getComputedStyle(icon).width)
  expect(size).toBe('17px')
})

test('permission denial is visible and cancelling a recording leaves the note unchanged', async ({
  page,
}) => {
  await setup(page)
  const editor = page.locator('.note-scroll .tiptap').first()
  const before = await editor.innerText()
  await page.evaluate(() => localStorage.setItem('dictation-test-deny', '1'))
  await page.getByRole('button', { name: 'Dictate note', exact: true }).click()
  await page.getByRole('button', { name: 'Download model', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Microphone permission denied')
  await page.evaluate(() => localStorage.removeItem('dictation-test-deny'))
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(page.getByRole('timer')).toHaveText('0:12')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(composer(page)).toHaveCount(0)
  await expect.poll(() => editor.innerText()).toBe(before)
})

for (const theme of ['native', 'workspace']) {
  for (const mode of ['light', 'dark']) {
    test(`recording and review surfaces ${theme} ${mode}`, async ({ page }, info) => {
      await setup(page)
      await page.evaluate(
        async ({ theme, mode }) => {
          const url = performance
            .getEntriesByType('resource')
            .find((e) => new URL(e.name).pathname === '/src/storage/useLibrary.ts')!.name
          const { library } = await import(/* @vite-ignore */ url)
          library.setAppearance({
            ...library.getSnapshot().appearance,
            interfaceTheme: theme,
            colorMode: mode,
            accent: mode === 'light' ? 'blue' : 'purple',
          })
        },
        { theme, mode },
      )
      const capture = async (state: string) => {
        for (const [width, height] of [
          [1280, 800],
          [900, 650],
        ]) {
          await page.setViewportSize({ width, height })
          await expect(async () => {
            const box = await composer(page).boundingBox()
            expect(box!.x).toBeGreaterThanOrEqual(0)
            expect(box!.x + box!.width).toBeLessThanOrEqual(width)
            expect(box!.y + box!.height).toBeLessThanOrEqual(height)
            for (const button of await composer(page).getByRole('button').all()) {
              const inner = await button.boundingBox()
              expect(inner!.x + inner!.width).toBeLessThanOrEqual(box!.x + box!.width)
            }
          }).toPass()
          await page.screenshot({ path: info.outputPath(`${theme}-${mode}-${state}-${width}.png`) })
        }
      }
      await record(page)
      await speak(page)
      await capture('recording')
      await page.getByRole('button', { name: 'Stop and review' }).click()
      await expect(page.getByRole('textbox', { name: 'Dictated text' })).toBeVisible()
      await capture('review')
      await page.setViewportSize({ width: 1280, height: 800 })
      await expect
        .poll(() =>
          page
            .getByRole('textbox', { name: 'Dictated text' })
            .evaluate((box) => box.getBoundingClientRect().height),
        )
        .toBe(28)
    })
  }
}
