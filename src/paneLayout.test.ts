import { expect, it } from 'vitest'
import {
  effectivePaneWidths,
  normalizePaneWidths,
  paneBounds,
  type PaneLayoutContext,
} from './paneLayout'

const context = (overrides: Partial<PaneLayoutContext> = {}): PaneLayoutContext => ({
  appWidth: 1320,
  sidebarVisible: true,
  noteListVisible: true,
  contentsOpen: false,
  sidebarWidth: 208,
  noteListWidth: 272,
  ...overrides,
})

it('accepts valid saved pane widths and drops malformed legacy values', () => {
  expect(normalizePaneWidths({ sidebar: 248, noteList: 336 })).toEqual({
    sidebar: 248,
    noteList: 336,
  })
  expect(normalizePaneWidths({ sidebar: 143, noteList: 336 })).toBeUndefined()
  expect(normalizePaneWidths({ sidebar: 248, noteList: 199 })).toBeUndefined()
  expect(normalizePaneWidths({ sidebar: 248.5, noteList: 336 })).toBeUndefined()
})

it('temporarily clamps saved targets in narrow windows without changing the targets', () => {
  const saved = { sidebar: 420, noteList: 340 }
  const compact = effectivePaneWidths(
    saved,
    context({ appWidth: 900, sidebarWidth: saved.sidebar, noteListWidth: saved.noteList }),
  )

  expect(compact).toEqual({ sidebar: 200, noteList: 340 })
  expect(saved).toEqual({ sidebar: 420, noteList: 340 })

  const withContents = effectivePaneWidths(
    saved,
    context({
      appWidth: 900,
      contentsOpen: true,
      sidebarWidth: saved.sidebar,
      noteListWidth: saved.noteList,
    }),
  )
  expect(withContents).toEqual({ sidebar: 144, noteList: 216 })
})

it('gives the Notes pane the released sidebar space when navigation is hidden', () => {
  const bounds = paneBounds(
    context({ appWidth: 900, sidebarVisible: false, sidebarWidth: 208, noteListWidth: 272 }),
  )

  expect(bounds.noteList).toEqual({ min: 200, max: 540 })
})

it('reserves the chosen contents width when limiting the other panes', () => {
  const bounds = paneBounds(context({ appWidth: 1200, contentsOpen: true, contentsWidth: 400 }))
  expect(bounds.noteList.max).toBe(312)
})

it('releases Notes space without changing hidden restore targets', () => {
  const saved = { sidebar: 420, noteList: 340 }
  const hidden = context({
    appWidth: 900,
    noteListVisible: false,
    sidebarWidth: 420,
    noteListWidth: 340,
  })
  expect(paneBounds(hidden).sidebar).toEqual({ min: 144, max: 540 })
  expect(effectivePaneWidths(saved, hidden)).toEqual(saved)
  expect(effectivePaneWidths(saved, { ...hidden, appWidth: 600 })).toEqual({
    sidebar: 240,
    noteList: 340,
  })
  expect(effectivePaneWidths(saved, { ...hidden, noteListVisible: true })).toEqual({
    sidebar: 200,
    noteList: 340,
  })
  expect(saved).toEqual({ sidebar: 420, noteList: 340 })
})

it('keeps both hidden pane targets intact even in narrow windows', () => {
  const saved = { sidebar: 420, noteList: 340 }
  expect(
    effectivePaneWidths(
      saved,
      context({ appWidth: 600, sidebarVisible: false, noteListVisible: false }),
    ),
  ).toEqual(saved)
})
