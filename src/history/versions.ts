import { invoke, isTauri } from '@tauri-apps/api/core'
import type { JSONContent } from '@tiptap/core'
import { peekEditor } from '../editor/session'
import type { Note } from '../model'
import { library } from '../storage/useLibrary'

/**
 * Note version history. The native store keeps a note's previous body when it changes, at most
 * once every ten minutes, plus the body a sync or restore replaces (see `storage/versions.rs`).
 * The browser preview keeps the same history in memory for the session.
 */
export interface VersionSummary {
  id: number
  title: string
  /** When this body was saved. */
  saved: number
  size: number
  preview: string
}
export interface NoteVersion {
  id: number
  noteId: string
  title: string
  saved: number
  content: JSONContent
  text: string
}

export const versionInterval = 10 * 60 * 1000
const maxVersions = 50
const native = isTauri()

/** Session-only history for the browser preview, following the native rules. */
const preview = (() => {
  const versions = new Map<string, (NoteVersion & { captured: number; body: string })[]>()
  let nextId = 1
  let seen = new Map<string, Note>()
  const keep = (note: Note, force: boolean) => {
    if (note.source) return
    const body = JSON.stringify(note.content)
    const list = versions.get(note.id) ?? []
    const last = list[0]
    if (last && (last.body === body || (!force && Date.now() - last.captured < versionInterval))) return
    list.unshift({ id: nextId++, noteId: note.id, title: note.title, saved: note.updated, content: note.content, text: note.text, captured: Date.now(), body })
    versions.set(note.id, list.slice(0, maxVersions))
  }
  let started = false
  const start = () => {
    if (started || native) return
    started = true
    seen = new Map(library.getSnapshot().notes.map((n) => [n.id, n]))
    library.subscribe(() => {
      const { notes, loaded } = library.getSnapshot()
      for (const note of notes) {
        const before = seen.get(note.id)
        if (before && loaded.has(note.id) && before.content !== note.content && JSON.stringify(before.content) !== JSON.stringify(note.content))
          keep(before, false)
      }
      seen = new Map(notes.map((n) => [n.id, n]))
    })
  }
  return {
    start,
    list: async (noteId: string): Promise<VersionSummary[]> =>
      (versions.get(noteId) ?? []).map(({ id, title, saved, body, text }) => ({ id, title, saved, size: body.length, preview: text.slice(0, 200) })),
    get: async (id: number): Promise<NoteVersion> => {
      for (const list of versions.values()) {
        const found = list.find((v) => v.id === id)
        if (found) return found
      }
      throw Error('This version is no longer available.')
    },
    keep: async (noteId: string) => {
      const note = library.getSnapshot().notes.find((n) => n.id === noteId)
      if (note) keep(note, true)
    },
  }
})()

/** Starts recording history in the browser preview; the native store needs nothing. */
export const startVersionHistory = () => preview.start()

export const listVersions = (noteId: string) =>
  native ? invoke<VersionSummary[]>('note_versions', { noteId }) : preview.list(noteId)
export const readVersion = (id: number) =>
  native ? invoke<NoteVersion>('note_version', { id }) : preview.get(id)

/**
 * Restores a version. Pending edits save first and the current body is kept as a version, so a
 * restore can be restored away again. An open editor takes the version as an ordinary edit,
 * which Undo reverses.
 */
export async function restoreVersion(version: NoteVersion) {
  await library.flush()
  if (native) await invoke('keep_note_version', { noteId: version.noteId })
  else await preview.keep(version.noteId)
  const note = library.getSnapshot().notes.find((n) => n.id === version.noteId)
  if (!note || note.trashed) throw Error('This note is no longer available.')
  if (!library.getSnapshot().loaded.has(note.id)) await library.activate(note.id)
  const editor = peekEditor(note.id)
  if (editor && !editor.isDestroyed) editor.commands.setContent(version.content, { emitUpdate: true })
  else library.patchNote(note.id, { content: version.content, text: version.text })
  if (note.title !== version.title) library.patchNote(note.id, { title: version.title })
  await library.flush()
}
