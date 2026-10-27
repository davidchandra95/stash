// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JSONContent } from '@tiptap/core'
import { library } from './storage/useLibrary'
import { defaultAppearance } from './storage/library'
import { normalizeAppearance } from './appearance'
import { useNoteActions } from './useNoteActions'
import { followsFirstLine, titleFromFirstLine } from './noteTitles'
import { startAutoSync } from './autoSync'
import { tagFooterContent } from './tags'

const paragraph = (text: string): JSONContent => ({
  type: 'paragraph',
  content: text ? [{ type: 'text', text }] : undefined,
})
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content })

beforeEach(() => {
  library.setNotes([])
  library.setNotebooks([
    { id: 'work', name: 'Work', color: '#abc', icon: 'briefcase' },
    { id: 'folder', name: 'Folder', color: '#def', icon: 'folder', rootId: 'root' },
  ])
  library.setAppearance(defaultAppearance)
})

describe('default notebook', () => {
  const create = (view: Parameters<ReturnType<typeof useNoteActions>['create']>[0]) =>
    useNoteActions().create(view)!

  it('leaves new notes uncategorized by default', () => {
    expect(create('all').notebookIds).toEqual([])
  })
  it('files notes created outside a notebook view in the default notebook', () => {
    library.setAppearance({ ...defaultAppearance, defaultNotebookId: 'work' })
    expect(create('all').notebookIds).toEqual(['work'])
    expect(create('tag:idea').notebookIds).toEqual(['work'])
  })
  it('keeps the current notebook view and the Uncategorized view', () => {
    library.setAppearance({ ...defaultAppearance, defaultNotebookId: 'work' })
    library.setNotebooks((old) => [
      ...old,
      { id: 'home', name: 'Home', color: '#123', icon: 'home' },
    ])
    expect(create('book:home').notebookIds).toEqual(['home'])
    expect(create('uncategorized').notebookIds).toEqual([])
  })
  it('ignores a default notebook that no longer exists', () => {
    library.setAppearance({ ...defaultAppearance, defaultNotebookId: 'gone' })
    expect(create('all').notebookIds).toEqual([])
  })
})

describe('first line titles', () => {
  it('titles a new note from its first line until the title is edited', () => {
    library.setAppearance({ ...defaultAppearance, newNoteTitle: 'firstLine' })
    const actions = useNoteActions()
    const { id } = actions.create('all')!
    expect(followsFirstLine(id)).toBe(true)
    actions.update(id, { content: doc(paragraph(''), paragraph('  Groceries  ')), text: '' })
    expect(library.getSnapshot().notes[0]!.title).toBe('Groceries')
    actions.update(id, { title: 'Shopping' })
    actions.update(id, { content: doc(paragraph('Milk')), text: 'Milk' })
    expect(library.getSnapshot().notes[0]!.title).toBe('Shopping')
    expect(followsFirstLine(id)).toBe(false)
  })
  it('keeps the title field for the default mode, linked folders and named notes', () => {
    const actions = useNoteActions()
    expect(followsFirstLine(actions.create('all')!.id)).toBe(false)
    library.setAppearance({ ...defaultAppearance, newNoteTitle: 'firstLine' })
    expect(followsFirstLine(actions.create('book:folder')!.id)).toBe(false)
    expect(followsFirstLine(actions.create('all', undefined, 'Linked')!.id)).toBe(false)
  })
  it('reads the first text line, skipping empty blocks and tag footers', () => {
    expect(titleFromFirstLine(doc(tagFooterContent(['a']), paragraph('Body')))).toBe('Body')
    expect(
      titleFromFirstLine(
        doc({ type: 'bulletList', content: [{ type: 'listItem', content: [paragraph('Item')] }] }),
      ),
    ).toBe('Item')
    expect(
      titleFromFirstLine(
        doc({
          type: 'paragraph',
          content: [{ type: 'hardBreak' }, { type: 'text', text: 'One' }, { type: 'hardBreak' }],
        }),
      ),
    ).toBe('One')
    expect(titleFromFirstLine(doc(paragraph('x'.repeat(150))))).toHaveLength(100)
    expect(titleFromFirstLine(doc(paragraph('')))).toBe('')
  })
})

describe('normalizeAppearance', () => {
  it('fills and validates the new preferences', () => {
    expect(normalizeAppearance({}, defaultAppearance)).toMatchObject({
      defaultNotebookId: '',
      newNoteTitle: 'field',
      spellcheck: true,
      autoSyncMinutes: 0,
    })
    expect(
      normalizeAppearance(
        { newNoteTitle: 'bogus' as never, autoSyncMinutes: 7, spellcheck: 'no' as never },
        defaultAppearance,
      ),
    ).toMatchObject({ newNoteTitle: 'field', autoSyncMinutes: 0, spellcheck: true })
    expect(
      normalizeAppearance(
        { newNoteTitle: 'firstLine', autoSyncMinutes: 15, spellcheck: false },
        defaultAppearance,
      ),
    ).toMatchObject({ newNoteTitle: 'firstLine', autoSyncMinutes: 15, spellcheck: false })
  })
})

describe('startAutoSync', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('syncs each interval once the user has been idle', () => {
    const sync = vi.fn()
    const stop = startAutoSync(60_000, sync, 30_000)
    vi.advanceTimersByTime(59_000)
    expect(sync).not.toHaveBeenCalled()
    window.dispatchEvent(new KeyboardEvent('keydown'))
    vi.advanceTimersByTime(15_000)
    expect(sync).not.toHaveBeenCalled()
    vi.advanceTimersByTime(30_000)
    expect(sync).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(60_000)
    expect(sync).toHaveBeenCalledTimes(2)
    stop()
    vi.advanceTimersByTime(600_000)
    expect(sync).toHaveBeenCalledTimes(2)
  })
})
