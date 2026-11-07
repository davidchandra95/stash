import { invoke, isTauri } from '@tauri-apps/api/core'
import { open as pickFolder, save as pickFile } from '@tauri-apps/plugin-dialog'
import type { Note, Notebook } from '../model'
import { today } from '../projects/model'
import { fileName, noteHtml, noteMarkdown, uniqueNames } from './exportDocument'

/**
 * Exports notes as files. A single note is saved where the person chooses, as Markdown (with its
 * images in a folder beside it) or as one self-contained HTML file. A notebook or the whole
 * library is written as Markdown into a new folder: notebooks become folders, images go in an
 * `images` folder, and links between exported notes point at each other's files.
 */
export type ExportFile = { path: string; text?: string; base64?: string }
export type ExportResult = { location: string; count: number; failed: string[] }
type ReadNote = (id: string) => Promise<Note>

const native = isTauri()
const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/')

/** Collects embedded images as files, naming each by its content so repeats are written once. */
function imageFiles(folder: string) {
  const byData = new Map<string, string>()
  const files: ExportFile[] = []
  return {
    files,
    /** The image's path relative to the export root, or the source when it isn't embedded. */
    add(src: string): string | null {
      const match = /^data:image\/([a-z0-9.+-]+);base64,(.+)$/i.exec(src)
      if (!match) return null
      const known = byData.get(src)
      if (known) return known
      const ext = { jpeg: 'jpg', 'svg+xml': 'svg' }[match[1]!.toLowerCase()] ?? match[1]!.toLowerCase()
      let hash = 2166136261
      for (let i = 0; i < src.length; i += 7) hash = Math.imul(hash ^ src.charCodeAt(i), 16777619) >>> 0
      let path = `${folder}/${hash.toString(36)}.${ext}`
      for (let n = 2; files.some((f) => f.path === path); n++) path = `${folder}/${hash.toString(36)}-${n}.${ext}`
      byData.set(src, path)
      files.push({ path, base64: match[2] })
      return path
    },
  }
}

/** A path from one exported file's folder to another file, for Markdown links. */
export function relativePath(fromFile: string, toFile: string) {
  const from = fromFile.split('/').slice(0, -1)
  const to = toFile.split('/')
  let shared = 0
  while (shared < from.length && shared < to.length - 1 && from[shared] === to[shared]) shared++
  return [...from.slice(shared).map(() => '..'), ...to.slice(shared)].join('/')
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = Object.assign(document.createElement('a'), { href: url, download: name })
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const parentOf = (path: string) => path.replace(/[\\/][^\\/]*$/, '') || '/'
const baseOf = (path: string) => path.split(/[\\/]/).pop()!

/** Exports one note. Returns null when the person cancels the save dialog. */
export async function exportNote(note: Note, format: 'markdown' | 'html', read: ReadNote): Promise<ExportResult | null> {
  const full = await read(note.id)
  const title = full.title || 'Untitled'
  const extension = format === 'markdown' ? 'md' : 'html'
  const suggested = `${fileName(title)}.${extension}`
  if (!native) {
    // The browser preview has no file system; images stay embedded.
    if (format === 'html') download(suggested, noteHtml(title, full.content), 'text/html')
    else download(suggested, noteMarkdown(title, full.content), 'text/markdown')
    return { location: suggested, count: 1, failed: [] }
  }
  const target = await pickFile({
    defaultPath: suggested,
    filters: [format === 'markdown' ? { name: 'Markdown', extensions: ['md'] } : { name: 'HTML', extensions: ['html'] }],
  })
  if (!target) return null
  const name = baseOf(target)
  const files: ExportFile[] = []
  if (format === 'html') files.push({ path: name, text: noteHtml(title, full.content) })
  else {
    const images = imageFiles(`${name.replace(/\.[^.]*$/, '')} images`)
    const text = noteMarkdown(title, full.content, (src) => {
      const path = images.add(src)
      return path ? encodePath(path) : src
    })
    files.push({ path: name, text }, ...images.files)
  }
  // The save dialog has already confirmed replacing an existing file.
  await invoke<string>('export_files', { directory: parentOf(target), folder: null, files, overwrite: true })
  return { location: target, count: 1, failed: [] }
}

/**
 * Exports every live note in a notebook and its sub-notebooks, or in the whole library. A note in
 * several exported notebooks is written once, in the first of them. Returns null on cancel.
 */
export async function exportNotes(
  scope: { notebook: Notebook } | { all: true },
  notes: Note[],
  notebooks: Notebook[],
  read: ReadNote,
): Promise<ExportResult | null> {
  if (!native) throw Error('Exporting to a folder needs the Stash app.')
  const directory = await pickFolder({ directory: true, multiple: false, title: 'Choose where to export' })
  if (!directory || Array.isArray(directory)) return null

  const children = new Map<string | null, Notebook[]>()
  for (const book of notebooks) children.set(book.parentId ?? null, [...(children.get(book.parentId ?? null) ?? []), book])
  const folders = new Map<string, string>()
  const namesIn = new Map<string, (name: string, ext?: string) => string>()
  const unique = (folder: string) => {
    if (!namesIn.has(folder)) namesIn.set(folder, uniqueNames())
    return namesIn.get(folder)!
  }
  const visit = (book: Notebook, folder: string) => {
    folders.set(book.id, folder)
    for (const child of children.get(book.id) ?? []) {
      const name = unique(folder)(fileName(child.name))
      visit(child, folder ? `${folder}/${name}` : name)
    }
  }
  // `images` at the top is reserved for embedded images.
  unique('')('images')
  if ('notebook' in scope) visit(scope.notebook, '')
  else
    for (const book of children.get(null) ?? []) {
      const name = unique('')(fileName(book.name))
      visit(book, name)
    }

  const placed = notes
    .filter((note) => !note.trashed)
    .map((note) => {
      const book = note.notebookIds.find((id) => folders.has(id))
      return book ? { note, folder: folders.get(book)! } : 'all' in scope ? { note, folder: '' } : null
    })
    .filter((entry) => entry !== null)
  const pathOf = new Map(
    placed.map(({ note, folder }) => {
      const name = unique(folder)(fileName(note.title || 'Untitled'), '.md')
      return [note.id, folder ? `${folder}/${name}` : name]
    }),
  )

  const images = imageFiles('images')
  const files: ExportFile[] = []
  const failed: string[] = []
  for (const { note } of placed) {
    const path = pathOf.get(note.id)!
    try {
      const full = await read(note.id)
      let text = noteMarkdown(full.title || 'Untitled', full.content, (src) => {
        const image = images.add(src)
        return image ? encodePath(relativePath(path, image)) : src
      })
      // Links to other exported notes point at their files.
      text = text.replace(/upnote2:\/\/note\/([A-Za-z0-9_-]+)(#[^)\s]*)?/g, (link, id: string, fragment = '') => {
        const target = pathOf.get(id)
        return target ? encodePath(relativePath(path, target)) + fragment : link
      })
      files.push({ path, text })
    } catch (error) {
      failed.push(`${note.title || 'Untitled'}: ${String(error)}`)
    }
  }
  if (!files.length) throw Error(failed[0] ?? 'There are no notes to export.')
  const folder = 'notebook' in scope ? fileName(scope.notebook.name) : `Stash export ${today()}`
  const location = await invoke<string>('export_files', {
    directory,
    folder,
    files: [...files, ...images.files],
    overwrite: false,
  })
  return { location, count: files.length, failed }
}
