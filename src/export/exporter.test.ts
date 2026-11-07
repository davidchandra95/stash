import { beforeEach, expect, it, vi } from 'vitest'
import type { Note, Notebook } from '../model'

const calls: { directory: string; folder: string | null; files: { path: string; text?: string; base64?: string }[]; overwrite: boolean }[] = []
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: vi.fn(async (_command: string, args: (typeof calls)[number]) => {
    calls.push(args)
    return `${args.directory}/${args.folder ?? ''}`
  }),
}))
const dialogs = { folder: '/Users/me/Exports' as string | null, file: '/Users/me/Desktop/Trip plan.md' as string | null }
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(async () => dialogs.folder),
  save: vi.fn(async () => dialogs.file),
}))
beforeEach(() => {
  calls.length = 0
  dialogs.folder = '/Users/me/Exports'
  dialogs.file = '/Users/me/Desktop/Trip plan.md'
})

const png = 'data:image/png;base64,iVBORw=='
const note = (id: string, title: string, notebookIds: string[], content: unknown[] = [], trashed = false) =>
  ({ id, title, notebookIds, trashed, content: { type: 'doc', content } }) as unknown as Note
const book = (id: string, name: string, parentId: string | null = null) => ({ id, name, parentId }) as Notebook
const p = (...content: unknown[]) => ({ type: 'paragraph', content })

it('exports one note as Markdown with its images beside it', async () => {
  const { exportNote } = await import('./exporter')
  const trip = note('t', 'Trip plan', [], [p({ type: 'text', text: 'Pack' }), p({ type: 'image', attrs: { src: png, alt: 'map' } })])
  const result = await exportNote(trip, 'markdown', async () => trip)
  expect(result?.location).toBe('/Users/me/Desktop/Trip plan.md')
  const [call] = calls
  expect(call).toMatchObject({ directory: '/Users/me/Desktop', folder: null, overwrite: true })
  expect(call!.files[0]!.path).toBe('Trip plan.md')
  expect(call!.files[0]!.text).toMatch(/!\[map\]\(Trip%20plan%20images\/[a-z0-9]+\.png\)/)
  expect(call!.files[1]).toMatchObject({ path: expect.stringMatching(/^Trip plan images\/[a-z0-9]+\.png$/), base64: 'iVBORw==' })

  dialogs.file = null
  expect(await exportNote(trip, 'html', async () => trip)).toBeNull()
  expect(calls).toHaveLength(1)
})

it('exports the library as folders with shared images and working links', async () => {
  const { exportNotes } = await import('./exporter')
  const notebooks = [book('w', 'Work'), book('p', 'Projects', 'w'), book('i', 'images')]
  const notes = [
    note('a', 'Plan', ['p'], [p({ type: 'noteReference', attrs: { noteId: 'b', fallbackTitle: 'Ideas' } }), p({ type: 'image', attrs: { src: png } })]),
    note('b', 'Ideas', [], [p({ type: 'image', attrs: { src: png } })]),
    note('c', 'Plan', ['p', 'w']),
    note('d', 'Gone', [], [], true),
    note('e', 'Broken', []),
  ]
  const read = async (id: string) => {
    if (id === 'e') throw Error('unreadable')
    return notes.find((n) => n.id === id)!
  }
  const result = await exportNotes({ all: true }, notes, notebooks, read)
  expect(result).toMatchObject({ count: 3, failed: ['Broken: Error: unreadable'] })
  const [call] = calls
  expect(call).toMatchObject({ directory: '/Users/me/Exports', folder: expect.stringMatching(/^Stash export \d{4}-\d{2}-\d{2}$/), overwrite: false })
  const paths = call!.files.map((f) => f.path)
  // A notebook named "images" can't take the images folder; duplicate titles get a number.
  expect(paths).toEqual(
    expect.arrayContaining(['Work/Projects/Plan.md', 'Work/Projects/Plan 2.md', 'Ideas.md', expect.stringMatching(/^images\/[a-z0-9]+\.png$/)]),
  )
  expect(paths.filter((path) => path.startsWith('images/'))).toHaveLength(1)
  expect(paths).not.toContain('Gone.md')
  const plan = call!.files.find((f) => f.path === 'Work/Projects/Plan.md')!.text!
  expect(plan).toContain('[Ideas](../../Ideas.md)')
  expect(plan).toMatch(/\]\(\.\.\/\.\.\/images\/[a-z0-9]+\.png\)/)
})

it('exports a notebook with its sub-notebooks into a folder named after it', async () => {
  const { exportNotes, relativePath } = await import('./exporter')
  const notebooks = [book('w', 'Work'), book('p', 'Projects', 'w'), book('o', 'Other')]
  const notes = [note('a', 'Plan', ['p']), note('b', 'Top', ['w']), note('c', 'Elsewhere', ['o'])]
  await exportNotes({ notebook: notebooks[0]! }, notes, notebooks, async (id) => notes.find((n) => n.id === id)!)
  expect(calls[0]).toMatchObject({ folder: 'Work' })
  expect(calls[0]!.files.map((f) => f.path).sort()).toEqual(['Projects/Plan.md', 'Top.md'])
  dialogs.folder = null
  expect(await exportNotes({ all: true }, notes, notebooks, async (id) => notes.find((n) => n.id === id)!)).toBeNull()
  expect(relativePath('a/b/x.md', 'a/c/y.md')).toBe('../c/y.md')
  expect(relativePath('x.md', 'a/y.md')).toBe('a/y.md')
})
