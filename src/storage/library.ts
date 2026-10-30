import { normalizeAppearance } from '../appearance'
import { normalizeNoteListMode, type NoteListMode } from '../noteListPresentation'
import { pdfCitationHref } from '../pdf/citations'
import { copyDrawingIds, replaceDrawingPreview, type DrawingData } from '../drawing/model'
import type { PdfDocument } from '../pdf/model'
import type { NoteListPreferences } from '../noteOrder'
import { convertMarkdownNote } from '../editor/notebookConversion'
import { normalizeOverrides } from '../shortcuts'
import { fileReferences } from '../editor/fileNavigation'
import {
  documentSignature,
  parseMarkdown,
  serializeMarkdown,
  markdownExtensions,
} from '../editor/markdown'
import { evictSession, pruneEditorSessions, resetSession, subscribeSessionRetention } from '../editor/session'
import type { FileSource, LinkedRoot, View } from '../model'
import { normalizePdfNotes, normalizeRecentNotes, type WorkspacePreferences } from '../workspace'
import type { JSONContent } from '@tiptap/core'
import { getSchema } from '@tiptap/core'
import { writingExtensions } from '../editor/extensions'
import { defaultCursorSettings } from '../editor/cursor'
import { initialNotes, initialNotebooks, type Appearance, type Note, type Notebook } from '../model'
import { notebookDeleteScope } from '../notebooks'
import { normalizePaneWidths, type PaneWidths } from '../paneLayout'
import { normalizeContentsWidth } from '../contentsWidth'
import { SaveQueue, type SaveStatus } from './saveQueue'
import { tagsFromContent } from '../tags'
import { defaultHeadingStyles, normalizeHeadingStyles } from '../headingStyles'
import { documentSchema } from '../editor/documentSchema'
import { defaultNotebookColor } from '../notebookColors'

// Documents are immutable snapshots. Metadata edits can reuse their confirmed tags.
const bodyTagCache = new WeakMap<JSONContent, string[]>()
function withBodyTags(note: Note): Note {
  let tags = bodyTagCache.get(note.content)
  if (!tags) {
    tags = tagsFromContent(note.content)
    bodyTagCache.set(note.content, tags)
  }
  return tags.length === note.tags.length && tags.every((tag, index) => tag === note.tags[index])
    ? note
    : { ...note, tags: [...tags] }
}
function withoutMarkdown(source: FileSource): FileSource {
  const { markdown: _, ...summary } = source
  return summary
}

function normalizeWorkspacePreferences(
  workspace: WorkspacePreferences | null | undefined,
): WorkspacePreferences | null {
  if (!workspace) return null
  const paneWidths = normalizePaneWidths(workspace.paneWidths)
  const contentsWidth = normalizeContentsWidth(workspace.contentsWidth)
  const { paneWidths: _, contentsWidth: __, ...legacyWorkspace } = workspace
  return {
    ...legacyWorkspace,
    ...(workspace.noteListMode !== undefined
      ? { noteListMode: normalizeNoteListMode(workspace.noteListMode) }
      : {}),
    ...(workspace.pdfNotes ? { pdfNotes: normalizePdfNotes(workspace.pdfNotes) } : {}),
    recentNoteIds: normalizeRecentNotes(workspace.recentNoteIds),
    ...(paneWidths ? { paneWidths } : {}),
    ...(contentsWidth ? { contentsWidth } : {}),
  }
}

export const defaultAppearance: Appearance = {
  animationsEnabled: true,
  colorMode: 'system',
  accent: 'system',
  translucentSidebar: true,
  layout: 'standard',
  sidebarCounts: true,
  titleFont: 'system',
  noteFont: 'system',
  codeFont: 'sf-mono',
  headingStyles: defaultHeadingStyles(),
  size: 15,
  width: 80,
  // Keep normal-text carets close to the font's visual height. Native carets
  // follow the line box, so the previous 1.8× default looked oversized.
  lineSpacing: 1.6,
  paragraphSpacing: 0,
  listItemSpacing: 0,
  editorBottomSpace: 112,
  showFormattingToolbar: false,
  defaultNotebookId: '',
  newNoteTitle: 'field',
  spellcheck: true,
  autoSyncMinutes: 0,
  ...defaultCursorSettings,
}
export type SavedNote = Omit<Note, 'content'> & {
  content?: JSONContent
  revision: number
  documentVersion: number
}
export type LibraryData = {
  notes: SavedNote[]
  notebooks: Notebook[]
  workspace?: WorkspacePreferences | null
  appearance: Partial<Appearance> | null
  preferencesRevision: number
  path: string
  roots?: LinkedRoot[]
  conflicts?: { draft: Record<string, unknown> & { id: string }; error: string }[]
}
export type Receipt = { revision: number; updated: number; note?: SavedNote }
export type NotebookDeletionResult = { removedIds: string[]; parentId: string | null }
export type NotebookMetadata = Pick<Notebook, 'name' | 'icon' | 'color'>
export interface Transport {
  open(): Promise<LibraryData>
  load(id: string): Promise<SavedNote>
  saveNote(input: Record<string, unknown>): Promise<Receipt>
  savePreferences(input: Record<string, unknown>): Promise<Receipt>
  command?<T>(name: string, args: Record<string, unknown>): Promise<T>
  quit(): Promise<void>
}
export type SyncStatus = {
  url: string
  configured: boolean
  lastSuccess: number | null
  pending: number
  warnings: string[]
}
export type LibraryState = {
  converting: boolean
  conversionProgress: string
  syncing: boolean
  syncGeneration: number
  syncStatus?: SyncStatus
  syncError: string
  syncProgress: string
  notes: Note[]
  notebooks: Notebook[]
  appearance: Appearance
  workspace: WorkspacePreferences | null
  ready: boolean
  startupError: string
  noteErrors: Record<string, string>
  loaded: ReadonlySet<string>
  status: SaveStatus
  error: string
  path: string
  quitting: boolean
  quitFailed: boolean
  preview: boolean
  roots: LinkedRoot[]
  conflicts: Record<string, string>
}
export class LibraryStore {
  private bodyCache = new Map<string, number>()
  private latestBody: string | undefined
  private cacheTrim?: ReturnType<typeof setTimeout>
  private unsubscribeSessionRetention?: () => void
  private quitAfterConversion = false
  private folderWork?: Promise<LibraryData>
  private resolutions = new Map<string, { key: string; input: Record<string, unknown> }>()
  private pendingNotes = new Set<string>()
  private fileBases = new Map<string, { source: FileSource; signature: string }>()
  private listeners = new Set<() => void>()
  private revisions = new Map<string, number>()
  private preferencesRevision = 0
  private loading = new Map<string, Promise<void>>()
  private searchNoteMaps = new WeakMap<Note[], ReadonlyMap<string, Note>>()
  private opening: Promise<void> | undefined
  private queue: SaveQueue
  private state: LibraryState
  constructor(
    private transport: Transport | null,
    private cacheLimits = { maximumNotes: 32, maximumBytes: 32 * 1024 * 1024 },
  ) {
    this.state = {
      notes: transport ? [] : initialNotes,
      notebooks: transport ? [] : initialNotebooks,
      appearance: defaultAppearance,
      workspace: null,
      ready: !transport,
      startupError: '',
      noteErrors: {},
      loaded: new Set(transport ? [] : initialNotes.map((n) => n.id)),
      status: 'saved',
      error: '',
      path: '',
      quitting: false,
      quitFailed: false,
      preview: !transport,
      syncing: false,
      converting: false,
      conversionProgress: '',
      syncGeneration: 0,
      syncError: '',
      syncProgress: '',
      roots: [],
      conflicts: {},
    }
    this.queue = new SaveQueue(() =>
      this.publish({ status: this.queue.status, error: this.queue.error }),
    )
  }
  useImmediateSaves = () => this.queue.useImmediateScheduling()
  refreshSyncStatus = async () => {
    if (!this.transport?.command) return
    try {
      this.publish({ syncStatus: await this.command<SyncStatus>('sync_status', {}) })
    } catch (error) {
      this.publish({ syncError: String(error) })
    }
  }
  configureSync = async (url: string, token: string) => {
    if (this.state.syncing || this.state.converting)
      throw Error('Wait for the current operation to finish.')
    const syncStatus = await this.command<SyncStatus>('configure_sync', { url, token })
    this.publish({ syncStatus, syncError: '' })
  }
  setSyncProgress = (syncProgress: string) => {
    if (this.state.syncing) this.publish({ syncProgress })
  }
  sync = async () => {
    if (this.state.syncing || this.state.converting || this.state.quitting || !this.transport)
      return
    this.publish({ syncing: true, syncError: '', syncProgress: 'Saving local changes…' })
    try {
      await Promise.all(this.loading.values())
      await this.flush()
      const result = await this.command<{ library: LibraryData; status: SyncStatus }>(
        'sync_library',
        {},
      )
      const data = result.library
      const loaded = new Set(this.state.loaded)
      // sync_library has already committed the remote result. Reconcile its revisions before
      // reloading bodies so a failed reload cannot leave later saves using stale revisions.
      this.revisions.clear()
      data.notes.forEach((note) => this.revisions.set(note.id, note.revision))
      this.preferencesRevision = data.preferencesRevision
      const reloads = await Promise.allSettled(
        data.notes.map(async (n) =>
          n.source
            ? { ...n, content: loaded.has(n.id) ? this.state.notes.find((old) => old.id === n.id)?.content : undefined }
            : loaded.has(n.id)
              ? await this.transport!.load(n.id)
              : n,
        ),
      )
      const noteErrors = { ...this.state.noteErrors }
      const reloadFailures: string[] = []
      const fullNotes = data.notes.map((note, index) => {
        const reload = reloads[index]!
        if (note.source || !loaded.has(note.id))
          return reload.status === 'fulfilled' ? reload.value : note
        if (reload.status === 'fulfilled') {
          delete noteErrors[note.id]
          return reload.value
        }
        noteErrors[note.id] = String(reload.reason)
        reloadFailures.push(note.id)
        return note
      })
      for (const n of this.state.notes) if (!n.source) resetSession(n.id)
      this.publish({
        notes: fullNotes.map((n) => ({
          ...n,
          content: n.content ?? { type: 'doc', content: [{ type: 'paragraph' }] },
        })),
        notebooks: data.notebooks,
        roots: data.roots ?? [],
        loaded: new Set(fullNotes.filter((n) => n.content).map((n) => n.id)),
        noteErrors,
        syncStatus: result.status,
        syncGeneration: this.state.syncGeneration + 1,
      })
      this.reconcileBodyCache()
      if (reloadFailures.length)
        throw Error(
          `Sync completed, but ${reloadFailures.length === 1 ? 'one note could' : `${reloadFailures.length} notes could`} not be reloaded. Retry the note before editing.`,
        )
    } catch (error) {
      this.publish({ syncError: String(error) })
    } finally {
      this.publish({ syncing: false, syncProgress: '' })
    }
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    if (this.listeners.size === 1 && this.transport)
      this.unsubscribeSessionRetention = subscribeSessionRetention(this.scheduleCacheTrim)
    return () => {
      this.listeners.delete(listener)
      if (!this.listeners.size) {
        this.unsubscribeSessionRetention?.()
        this.unsubscribeSessionRetention = undefined
      }
    }
  }
  getSnapshot = () => this.state
  private publish(patch: Partial<LibraryState>) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((f) => f())
    if (patch.syncing === false || patch.converting === false || patch.quitting === false)
      this.scheduleCacheTrim()
  }
  private scheduleCacheTrim = () => {
    if (!this.transport || this.cacheTrim !== undefined) return
    this.cacheTrim = setTimeout(() => {
      this.cacheTrim = undefined
      this.trimBodyCache()
    }, 0)
  }
  private rememberBody(note: Pick<Note, 'id' | 'content' | 'source'>) {
    if (!this.transport) return
    // Estimate at load/save boundaries, never on each keystroke.
    const bytes = 2 * (JSON.stringify(note.content).length +
      (note.source?.markdown?.length ?? 0) + (this.fileBases.get(note.id)?.signature.length ?? 0))
    this.bodyCache.delete(note.id)
    this.bodyCache.set(note.id, bytes)
    this.scheduleCacheTrim()
  }
  private reconcileBodyCache() {
    if (!this.transport) return
    const notes = new Map(this.state.notes.map((note) => [note.id, note]))
    const order = new Set([...this.bodyCache.keys(), ...this.state.loaded])
    this.bodyCache.clear()
    for (const id of order) {
      const note = notes.get(id)
      if (note && this.state.loaded.has(id)) this.rememberBody(note)
      else this.fileBases.delete(id)
    }
    pruneEditorSessions(new Set(notes.keys()))
    if (this.latestBody && !notes.has(this.latestBody)) this.latestBody = undefined
  }
  private trimBodyCache() {
    if (this.state.syncing || this.state.converting || this.state.quitting || this.folderWork) return
    let bytes = [...this.bodyCache.values()].reduce((sum, size) => sum + size, 0)
    if (this.bodyCache.size <= this.cacheLimits.maximumNotes && bytes <= this.cacheLimits.maximumBytes) return
    const notes = new Map(this.state.notes.map((note) => [note.id, note]))
    const removed = new Set<string>()
    for (const [id, size] of this.bodyCache) {
      if (this.bodyCache.size <= this.cacheLimits.maximumNotes && bytes <= this.cacheLimits.maximumBytes) break
      const note = notes.get(id)
      if (id === this.latestBody || this.pendingNotes.has(id) || this.loading.has(id) ||
        this.state.conflicts[id] || this.resolutions.has(id) || this.state.noteErrors[id] ||
        note?.source?.unavailable) continue
      if (note && !evictSession(id, note.content)) continue
      removed.add(id)
      this.bodyCache.delete(id)
      this.fileBases.delete(id)
      bytes -= size
    }
    if (!removed.size) return
    const loaded = new Set(this.state.loaded)
    removed.forEach((id) => loaded.delete(id))
    this.publish({
      loaded,
      notes: this.state.notes.map((note) => {
        if (!removed.has(note.id)) return note
        return { ...note, content: { type: 'doc', content: [{ type: 'paragraph' }] },
          ...(note.source ? { source: withoutMarkdown(note.source) } : {}) }
      }),
    })
  }
  failStartup = (error: unknown) => this.publish({ startupError: String(error) })
  open = (): Promise<void> => {
    if (!this.transport || this.state.ready) return Promise.resolve()
    if (this.opening) return this.opening
    this.publish({ startupError: '' })
    this.opening = this.transport
      .open()
      .then((data) => {
        this.preferencesRevision = data.preferencesRevision
        data.notes.forEach((n) => this.revisions.set(n.id, n.revision))
        this.publish({
          notes: data.notes.map((n) => ({
            ...n,
            content: { type: 'doc', content: [{ type: 'paragraph' }] },
          })),
          notebooks: data.notebooks,
          roots: data.roots ?? [],
          appearance: {
            ...normalizeAppearance(data.appearance, defaultAppearance),
            // Older libraries used the body font for titles. Keep that appearance until the
            // user picks a dedicated title font.
            titleFont:
              data.appearance?.titleFont ??
              data.appearance?.noteFont ??
              defaultAppearance.titleFont,
            headingStyles: normalizeHeadingStyles(data.appearance?.headingStyles),
            ...(data.appearance?.shortcuts
              ? { shortcuts: normalizeOverrides(data.appearance.shortcuts) }
              : {}),
          },
          workspace: normalizeWorkspacePreferences(data.workspace),
          path: data.path,
          ready: true,
        })
        for (const { draft, error } of data.conflicts ?? []) {
          let note = this.state.notes.find((n) => n.id === draft.id)
          if (!note) {
            const notebookIds = (draft.notebookIds as string[] | undefined) ?? []
            const book = data.notebooks.find((b) => b.rootId && notebookIds.includes(b.id))
            note = {
              id: draft.id,
              title: String(draft.title ?? 'Untitled'),
              notebookIds,
              quickAccess: false,
              tags: [],
              pinned: false,
              trashed: false,
              text: String(draft.text ?? ''),
              updated: Date.now(),
              content: { type: 'doc', content: [{ type: 'paragraph' }] },
              source: book
                ? {
                    rootId: book.rootId!,
                    relativePath: [book.relativePath, `${draft.title ?? 'Untitled'}.md`]
                      .filter(Boolean)
                      .join('/'),
                    fingerprint: '',
                  }
                : undefined,
            }
            this.publish({ notes: [...this.state.notes, note] })
          }
          this.publish({
            notes: this.state.notes.map((n) =>
              n.id === draft.id
                ? {
                    ...n,
                    ...draft,
                    content:
                      (draft.content as JSONContent | undefined) ??
                      parseMarkdown(String(draft.markdown ?? n.source?.markdown ?? '')),
                  }
                : n,
            ),
            loaded: new Set([...this.state.loaded, draft.id]),
            conflicts: { ...this.state.conflicts, [draft.id]: error },
          })
        }
        if (!data.appearance) this.savePreferences()
        this.reconcileBodyCache()
      })
      .catch((error) => {
        this.publish({ startupError: String(error) })
      })
      .finally(() => {
        this.opening = undefined
      })
    return this.opening
  }
  load = (id: string, force = false): Promise<void> => {
    this.latestBody = id
    const cachedSize = this.bodyCache.get(id)
    if (cachedSize !== undefined) {
      this.bodyCache.delete(id)
      this.bodyCache.set(id, cachedSize)
      this.scheduleCacheTrim()
    }
    const existing = this.state.notes.find((n) => n.id === id)
    if (existing && this.state.loaded.has(id) && cachedSize === undefined) this.rememberBody(existing)
    if (
      !this.transport ||
      (this.state.loaded.has(id) && !force) ||
      this.pendingNotes.has(id) ||
      this.state.conflicts[id]
    )
      return Promise.resolve()
    if (this.loading.has(id)) return this.loading.get(id)!
    const revision = this.revisions.get(id)
    const generation = this.state.syncGeneration
    const isCurrent = () => {
      const current = this.state.notes.find((note) => note.id === id)
      return !!current && current.content === existing?.content &&
        current.source?.fingerprint === existing?.source?.fingerprint &&
        this.revisions.get(id) === revision && this.state.syncGeneration === generation
    }
    let invalidated = false
    const request = this.transport
      .load(id)
      .then((note) => {
        // A folder refresh or conversion can finish while this disk read is pending.
        if (!isCurrent()) { invalidated = true; return }
        const content =
          note.source?.markdown !== undefined ? parseMarkdown(note.source.markdown) : note.content
        if (!content || note.documentVersion !== 1)
          throw Error(
            'This note uses an unsupported document format. Its saved content has not been changed.',
          )
        getSchema(note.source ? markdownExtensions : writingExtensions)
          .nodeFromJSON(content)
          .check()
        if (this.pendingNotes.has(id) || this.state.conflicts[id]) return
        if (note.source) {
          const changed =
            !existing?.source || existing.source.fingerprint !== note.source.fingerprint
          if (changed) resetSession(id)
          this.revisions.set(id, note.revision)
          this.fileBases.set(id, { source: note.source, signature: documentSignature(content!) })
        }
        const errors = { ...this.state.noteErrors }
        delete errors[id]
        this.publish({
          notes: this.state.notes.map((n) =>
            n.id === id
              ? withBodyTags(note.source ? { ...n, ...note, content } : { ...note, ...n, content })
              : n,
          ),
          loaded: new Set([...this.state.loaded, id]),
          noteErrors: errors,
        })
        this.rememberBody({ ...note, content })
      })
      .catch((error) => {
        if (!isCurrent()) { invalidated = true; return }
        this.publish({ noteErrors: { ...this.state.noteErrors, [id]: String(error) } })
      })
      .finally(() => {
        this.loading.delete(id)
        if (invalidated && this.state.notes.some((note) => note.id === id)) return this.load(id)
      })
    this.loading.set(id, request)
    return request
  }
  private searchNote(id: string): Note | undefined {
    const notes = this.state.notes
    let lookup = this.searchNoteMaps.get(notes)
    if (!lookup) {
      lookup = new Map(notes.map((note) => [note.id, note]))
      this.searchNoteMaps.set(notes, lookup)
    }
    return lookup.get(id)
  }
  // Search reads do not mount editors or activate notes. Unsaved/loaded content
  // stays authoritative, and external Markdown is parsed using the editor schema.
  readSearchNote = async (id: string): Promise<Note> => {
    const current = this.searchNote(id)
    if (!current || current.trashed) throw Error('This note is no longer available.')
    if (
      this.state.loaded.has(id) ||
      this.pendingNotes.has(id) ||
      this.state.conflicts[id]
    )
      return current
    if (current.source?.unavailable) throw Error(current.source.unavailable)
    if (!this.transport) return current
    let saved: SavedNote
    try {
      saved = await this.transport.load(id)
    } catch (error) {
      const latest = this.searchNote(id)
      if (
        latest &&
        !latest.trashed &&
        (this.state.loaded.has(id) || this.pendingNotes.has(id) || this.state.conflicts[id])
      )
        return latest
      throw error
    }
    const latest = this.searchNote(id)
    if (!latest || latest.trashed) throw Error('This note is no longer available.')
    // An edit or recovery draft created while the read was in flight wins over
    // the disk response, including its unavailable/unsupported content state.
    if (this.state.loaded.has(id) || this.pendingNotes.has(id) || this.state.conflicts[id])
      return latest
    if (saved.source?.unavailable) throw Error(saved.source.unavailable)
    if (latest.source?.unavailable) throw Error(latest.source.unavailable)
    if (saved.documentVersion !== 1) throw Error('Unsupported document format.')
    const content =
      saved.source?.markdown !== undefined ? parseMarkdown(saved.source.markdown) : saved.content
    if (!content) throw Error('This note could not be read.')
    documentSchema(!!saved.source).nodeFromJSON(content).check()
    if (
      latest.text !== current.text ||
      latest.updated !== current.updated ||
      latest.source?.fingerprint !== current.source?.fingerprint
    )
      throw Error('This note changed while searching. Search again.')
    return { ...latest, content, source: saved.source ?? latest.source }
  }
  activate = async (id: string) => {
    if (this.state.converting) return
    await this.queue.flush().catch(() => {})
    await this.load(id, !!this.state.notes.find((n) => n.id === id)?.source)
  }
  private mergeLibrary(data: LibraryData) {
    const loaded = new Set(this.state.loaded)
    const notes = data.notes.map((note) => {
      const current = this.state.notes.find((n) => n.id === note.id)
      if (this.pendingNotes.has(note.id) || this.state.conflicts[note.id])
        return current ?? { ...note, content: { type: 'doc', content: [{ type: 'paragraph' }] } }
      this.revisions.set(note.id, note.revision)
      if (current?.source && note.source?.fingerprint !== current.source.fingerprint) {
        loaded.delete(note.id)
        resetSession(note.id)
        this.fileBases.delete(note.id)
      }
      return {
        ...note,
        content: current?.content ?? { type: 'doc', content: [{ type: 'paragraph' }] },
      }
    })
    for (const note of this.state.notes)
      if (!notes.some((n) => n.id === note.id) && this.pendingNotes.has(note.id)) notes.push(note)
    this.preferencesRevision = data.preferencesRevision
    this.publish({ notes, notebooks: data.notebooks, roots: data.roots ?? [], loaded })
    this.reconcileBodyCache()
  }
  command = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
    if (!this.transport?.command) throw Error('This operation requires the Stash desktop app.')
    return this.transport.command<T>(name, args)
  }
  folderAction = async (name: string, args: Record<string, unknown>) => {
    if (this.state.syncing || this.state.converting)
      throw Error('Wait for the current operation to finish.')
    const work = (async () => {
      await this.queue.flush()
      const data = await this.command<LibraryData>(name, args)
      this.mergeLibrary(data)
      return data
    })()
    this.folderWork = work
    try {
      return await work
    } finally {
      if (this.folderWork === work) this.folderWork = undefined
      this.scheduleCacheTrim()
    }
  }
  convertNotebook = async (id: string) => {
    if (this.state.converting || this.state.syncing || this.state.quitting)
      throw Error('Wait for the current operation to finish.')
    if (!this.transport) throw Error('Conversion requires the Stash desktop app.')
    this.publish({ converting: true, conversionProgress: 'Saving pending changes…' })
    try {
      await this.folderWork
      await Promise.all(this.loading.values())
      await this.flush()
      this.publish({ conversionProgress: 'Reading the linked folder…' })
      const prepared = await this.command<{
        token: string
        library: LibraryData
        notes: SavedNote[]
      }>('prepare_notebook_conversion', { id })
      this.mergeLibrary(prepared.library)
      const allNotes = prepared.library.notes as Note[]
      const documents: Awaited<ReturnType<typeof convertMarkdownNote>>[] = []
      for (const [index, note] of prepared.notes.entries()) {
        this.publish({
          conversionProgress: `Converting ${index + 1} of ${prepared.notes.length}: ${note.title}`,
        })
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        try {
          documents.push(
            await convertMarkdownNote(
              note as Note,
              allNotes,
              prepared.library.roots ?? [],
              (href) =>
                this.command<string>('read_conversion_image', {
                  token: prepared.token,
                  id: note.id,
                  href,
                }),
            ),
          )
        } catch (error) {
          throw Error(`${note.source?.relativePath ?? note.title}: ${String(error)}`)
        }
      }
      this.publish({ conversionProgress: 'Verifying files and saving native notes…' })
      let data: LibraryData
      try {
        data = await this.command<LibraryData>('commit_notebook_conversion', {
          token: prepared.token,
          documents,
        })
      } catch (error) {
        // A lost response does not mean the transaction failed. Reopen before
        // deciding whether to offer retry; never run conversion twice blindly.
        let current: LibraryData
        try {
          current = await this.transport.open()
        } catch {
          this.publish({
            ready: false,
            startupError:
              'The conversion result could not be loaded. Restart Stash before editing; the saved library will recover automatically.',
          })
          throw Error('Could not confirm the conversion result. Restart Stash before editing.')
        }
        if (!current.notebooks.some((b) => b.id === id && !b.rootId)) {
          this.mergeLibrary(current)
          throw error
        }
        data = current
      }
      const ids = new Set(documents.map((d) => d.id))
      const full = data.notes.map((n) => {
        const document = documents.find((d) => d.id === n.id)
        return document ? { ...n, content: n.content ?? document.content } : n
      })
      for (const noteId of ids) {
        resetSession(noteId)
        this.fileBases.delete(noteId)
      }
      this.mergeLibrary({ ...data, notes: full })
      this.publish({
        notes: this.state.notes.map((n) => {
          const saved = full.find((f) => f.id === n.id)
          return ids.has(n.id) && saved?.content ? { ...saved, content: saved.content } : n
        }),
        loaded: new Set([...this.state.loaded, ...ids]),
        noteErrors: Object.fromEntries(
          Object.entries(this.state.noteErrors).filter(([key]) => !ids.has(key)),
        ),
        syncGeneration: this.state.syncGeneration + 1,
      })
      this.reconcileBodyCache()
      await this.refreshSyncStatus()
    } finally {
      this.publish({ converting: false, conversionProgress: '' })
      if (this.quitAfterConversion) {
        this.quitAfterConversion = false
        await this.requestQuit()
      }
    }
  }
  deleteNotebook = async (
    id: string,
    includeChildren: boolean,
    deleteNotes: boolean,
  ): Promise<NotebookDeletionResult> => {
    if (this.state.syncing || this.state.converting || this.state.quitting)
      throw Error('Stash is saving before quitting.')
    const target = this.state.notebooks.find((book) => book.id === id)
    if (!target) return { removedIds: [id], parentId: null }
    const scope = notebookDeleteScope(id, this.state.notebooks, includeChildren)
    if (target.rootId) throw Error('Folder-linked notebooks cannot be deleted from Stash.')
    if (scope.some((book) => book.rootId))
      throw Error('A subtree containing a folder-linked notebook cannot be deleted.')
    const removedIds = scope.map((book) => book.id)
    const parentId = target.parentId ?? null
    await this.queue.flush()
    if (this.transport?.command) {
      await this.command<LibraryData>('delete_notebook', {
        input: {
          id,
          includeChildren,
          deleteNotes,
          operationId: crypto.randomUUID(),
        },
      }).then((data) => this.mergeLibrary(data))
      this.removeListPreferences(removedIds)
      return { removedIds, parentId }
    }

    const removed = new Set(removedIds)
    const timestamp = Date.now()
    const notes = this.state.notes.map((note) => {
      if (!note.notebookIds.some((bookId) => removed.has(bookId))) return note
      return {
        ...note,
        notebookIds: note.notebookIds.filter((bookId) => !removed.has(bookId)),
        ...(deleteNotes ? { trashed: true } : {}),
        updated: timestamp,
      }
    })
    const notebooks = this.state.notebooks
      .filter((book) => !removed.has(book.id))
      .map((book) => (!includeChildren && book.parentId === id ? { ...book, parentId } : book))
    this.publish({ notebooks, notes })
    this.removeListPreferences(removedIds)
    return { removedIds, parentId }
  }
  updateNotebook = async (id: string, patch: NotebookMetadata) => {
    if (this.state.syncing || this.state.converting || this.state.quitting)
      throw Error('Stash is saving before quitting.')
    const current = this.state.notebooks.find((book) => book.id === id)
    if (!current) throw Error('This notebook is no longer available.')
    const name = patch.name.trim()
    if (!name) throw Error('Enter a notebook name.')
    if (name.length > 80) throw Error('Notebook names can be up to 80 characters.')
    const next = this.state.notebooks.map((book) =>
      book.id === id ? { ...book, name, icon: patch.icon, color: patch.color } : book,
    )
    if (!this.transport) {
      this.publish({ notebooks: next })
      return
    }
    await this.queue.flush()
    this.publish({ notebooks: next })
    this.savePreferences()
    await this.queue.flush()
  }
  createNotebook = async (name: string, parent?: string, path?: string) => {
    if (path) {
      const before = new Set(this.state.notebooks.map((b) => b.id))
      const data = await this.folderAction('link_folder', { name, path, parent: parent ?? null })
      return data.notebooks.find((b) => b.rootId === b.id && !before.has(b.id))?.id
    }
    if (parent && this.transport) {
      const before = new Set(this.state.notebooks.map((b) => b.id))
      const data = await this.folderAction('create_child_notebook', { parent, name })
      return data.notebooks.find((b) => !before.has(b.id))?.id
    }
    const id = crypto.randomUUID()
    this.setNotebooks((old) => [
      ...old,
      { id, name, color: defaultNotebookColor, icon: 'notebook', parentId: parent ?? null },
    ])
    return id
  }
  resolveConflict = async (
    id: string,
    choice: 'disk' | 'copy' | 'overwrite',
    filename?: string,
  ) => {
    await this.queue.flush()
    const local = this.state.notes.find((n) => n.id === id)
    if (!local) return
    const disk = await this.command<SavedNote | null>('resolve_file_conflict', { id })
    if (disk?.source?.unavailable && choice !== 'copy') throw Error(disk.source.unavailable)
    if (!disk && choice === 'overwrite')
      throw Error('There is no saved file to overwrite. Save your edits as a copy.')
    const diskContent = disk?.source ? parseMarkdown(disk.source.markdown ?? '') : disk?.content
    let saved: SavedNote | undefined
    if (choice !== 'disk') {
      const key = JSON.stringify([choice, filename])
      let attempt = this.resolutions.get(id)
      if (!attempt || attempt.key !== key) {
        const copy = choice === 'copy'
        const input = {
          id: copy ? crypto.randomUUID() : id,
          title: filename ?? (copy ? `${local.title || 'Untitled'} conflict copy` : local.title),
          notebookIds: local.notebookIds,
          quickAccess: local.quickAccess,
          tags: local.tags,
          pinned: local.pinned,
          trashed: copy ? false : local.trashed,
          content: local.content,
          text: local.text,
          markdown: serializeMarkdown(
            fileReferences(local.content, local, this.state.notes, this.state.roots),
            disk?.source?.markdown,
          ),
          expectedFingerprint: copy ? undefined : disk?.source?.fingerprint,
          expectedRevision: copy ? 0 : disk!.revision,
          operationId: crypto.randomUUID(),
        }
        attempt = { key, input }
        this.resolutions.set(id, attempt)
      }
      try {
        const receipt = await this.transport!.saveNote(attempt.input)
        saved = receipt.note ?? (await this.transport!.load(String(attempt.input.id)))
      } catch (error) {
        if (/FILE_CONFLICT:|NAME_COLLISION:/.test(String(error))) this.resolutions.delete(id)
        throw error
      }
    }
    // Keep the original draft and conflict visible until all required work is acknowledged.
    await this.command('clear_file_conflict', { id })
    if (saved && saved.id !== id) await this.command('clear_file_conflict', { id: saved.id })
    const replacement = choice === 'overwrite' && saved ? saved : disk
    const content = replacement?.source
      ? parseMarkdown(replacement.source.markdown ?? '')
      : diskContent
    const conflicts = { ...this.state.conflicts }
    delete conflicts[id]
    this.pendingNotes.delete(id)
    if (replacement) this.revisions.set(id, replacement.revision)
    if (replacement?.source)
      this.fileBases.set(id, { source: replacement.source, signature: documentSignature(content!) })
    resetSession(id)
    const notes = this.state.notes.flatMap((n) =>
      n.id === id ? (replacement ? [{ ...replacement, content: content! }] : []) : [n],
    )
    const loaded = new Set([...this.state.loaded, id])
    if (choice === 'copy' && saved) {
      const content = saved.source ? parseMarkdown(saved.source.markdown ?? '') : saved.content!
      notes.push({ ...saved, content })
      loaded.add(saved.id)
      this.revisions.set(saved.id, saved.revision)
      if (saved.source)
        this.fileBases.set(saved.id, {
          source: saved.source,
          signature: documentSignature(content!),
        })
    }
    this.resolutions.delete(id)
    this.publish({ conflicts, notes, loaded })
    this.reconcileBodyCache()
  }

  private companionWork = new Map<string, Promise<string>>()
  private previewCompanions: Record<string, string> = {}
  listPdfCompanions = async (): Promise<Record<string, string>> =>
    this.transport ? this.command('list_pdf_companions', {}) : { ...this.previewCompanions }
  ensurePdfCompanion = (document: PdfDocument): Promise<string> => {
    const pending = this.companionWork.get(document.id)
    if (pending) return pending
    const work = this.createPdfCompanion(document).finally(() =>
      this.companionWork.delete(document.id),
    )
    this.companionWork.set(document.id, work)
    return work
  }
  private async createPdfCompanion(document: PdfDocument): Promise<string> {
    if (this.state.syncing || this.state.converting || this.state.quitting)
      throw Error('Wait for the current operation to finish before taking notes.')
    await this.flush()
    if (this.state.syncing || this.state.converting || this.state.quitting)
      throw Error('Wait for the current operation to finish before taking notes.')
    if (!this.transport) {
      const existing = this.previewCompanions[document.id]
      if (existing && this.state.notes.some((n) => n.id === existing)) return existing
      const id = crypto.randomUUID()
      const note: Note = {
        id,
        title: `${document.name.replace(/\.pdf$/i, '')} - Notes`,
        notebookIds: [],
        tags: [],
        quickAccess: false,
        pinned: false,
        trashed: false,
        updated: Date.now(),
        text: document.name,
        content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: document.name,
                  marks: [
                    {
                      type: 'link',
                      attrs: {
                        href: pdfCitationHref({
                          documentId: document.id,
                          fingerprint: document.fingerprint,
                          page: 1,
                        }),
                      },
                    },
                  ],
                },
              ],
            },
            { type: 'paragraph' },
          ],
        },
      }
      this.setNotes((notes) => [note, ...notes])
      this.previewCompanions[document.id] = id
      return id
    }
    const saved = await this.command<SavedNote>('ensure_pdf_companion', { documentId: document.id })
    // A delayed receipt must never replace newer local edits or another load.
    if (!this.state.notes.some((n) => n.id === saved.id)) {
      this.revisions.set(saved.id, saved.revision)
      const content = saved.source ? parseMarkdown(saved.source.markdown ?? '') : saved.content!
      this.publish({
        notes: [{ ...saved, content }, ...this.state.notes],
        loaded: new Set([...this.state.loaded, saved.id]),
      })
    }
    await this.load(saved.id)
    return saved.id
  }

  duplicate = async (id: string): Promise<string | undefined> => {
    if (this.state.syncing || this.state.converting || this.state.quitting) return undefined
    await this.load(id)
    if (!this.state.loaded.has(id))
      throw new Error(this.state.noteErrors[id] || 'Could not load this note. Try again.')
    const source = this.state.notes.find((note) => note.id === id)
    if (!source || source.trashed || this.state.quitting) return undefined
    const copyId = crypto.randomUUID()
    this.setNotes((old) => [
      {
        ...structuredClone(source),
        content: copyDrawingIds(structuredClone(source.content)),
        id: copyId,
        title: `${source.title || 'Untitled note'} copy`,
        source: undefined,
        pinned: false,
        quickAccess: false,
        updated: Date.now(),
      },
      ...old,
    ])
    return copyId
  }
  setNotes = (change: Note[] | ((old: Note[]) => Note[])) => {
    if (this.state.syncing || this.state.converting || this.state.quitting) return
    this.applyNotes(change)
  }
  patchNote = (id: string, patch: Partial<Omit<Note, 'id'>>) => {
    if (this.state.syncing || this.state.converting || this.state.quitting) return
    const index = this.state.notes.findIndex((note) => note.id === id)
    if (index < 0) return
    const previous = this.applyNotePatch(index, patch)
    if (previous.source && ['title', 'trashed', 'notebookIds'].some((key) => key in patch))
      void this.flush().catch(() => {})
  }
  private applyNotePatch(index: number, patch: Partial<Omit<Note, 'id'>>) {
    const previous = this.state.notes[index]!
    const note = this.normalizeNote({ ...previous, ...patch, id: previous.id }, previous)
    const notes = this.state.notes.slice()
    notes[index] = note
    this.publish({ notes })
    this.enqueueNote(note, !!previous.source)
    return previous
  }
  // Flush participants may finish a derived preview after user editing is frozen.
  // This path cannot change scene content or apply to a different scene revision.
  saveDrawingPreview = (noteId: string, drawingId: string, data: DrawingData) => {
    const index = this.state.notes.findIndex((note) => note.id === noteId)
    const note = this.state.notes[index]
    if (!note || note.source || !this.state.loaded.has(noteId)) return
    const content = replaceDrawingPreview(note.content, drawingId, data)
    if (content === note.content) return
    this.applyNotePatch(index, { content })
  }
  private normalizeNote(note: Note, previous?: Note): Note {
    if (previous === note) return note
    const hasContent = this.state.loaded.has(note.id) || !previous
    if (note.source) return hasContent ? withBodyTags(note) : note
    const folder = this.state.notebooks.find((b) => b.rootId && note.notebookIds.includes(b.id))
    const sourceAware = folder
      ? {
          ...note,
          source: {
            rootId: folder.rootId!,
            relativePath: [folder.relativePath, `${note.title || 'Untitled'}.md`]
              .filter(Boolean)
              .join('/'),
            fingerprint: '',
          },
        }
      : note
    return hasContent ? withBodyTags(sourceAware) : sourceAware
  }
  private applyNotes = (change: Note[] | ((old: Note[]) => Note[])) => {
    const old = this.state.notes,
      previous = new Map(old.map((note) => [note.id, note])),
      next = (typeof change === 'function' ? change(old) : change).map((note) =>
        this.normalizeNote(note, previous.get(note.id)),
      )
    let added: Set<string> | undefined
    for (const note of next) {
      if (!previous.has(note.id) && !this.state.loaded.has(note.id)) {
        added ??= new Set(this.state.loaded)
        added.add(note.id)
      }
    }
    this.publish({ notes: next, loaded: added ?? this.state.loaded })
    for (const note of next) {
      const previousNote = previous.get(note.id)
      if (previousNote !== note) this.enqueueNote(note, !!previousNote?.source)
    }
  }
  private enqueueNote(note: Note, hadSource: boolean) {
    if (!this.transport) return
    this.pendingNotes.add(note.id)
    const operationId = crypto.randomUUID()
    let input: Record<string, unknown> | undefined
    // Capture immutable content now, but obtain the revision when the job runs.
    const snapshot = {
      id: note.id,
      title: note.title,
      notebookIds: [...note.notebookIds],
      quickAccess: note.quickAccess,
      tags: [...note.tags],
      content: this.state.loaded.has(note.id) ? note.content : undefined,
      text: note.text,
      pinned: note.pinned,
      trashed: note.trashed,
    }
    this.queue.enqueue(note.id, async () => {
      if (this.state.conflicts[note.id]) {
        await this.command('preserve_file_conflict', {
          input: { ...snapshot, expectedRevision: this.revisions.get(note.id) ?? 0, operationId },
          error: this.state.conflicts[note.id],
        })
        return
      }
      try {
        const folder = this.state.notebooks.find(
          (b) => b.rootId && snapshot.notebookIds.includes(b.id),
        )
        if (folder) {
          const base = this.fileBases.get(note.id)
          const changed =
            !base || documentSignature(snapshot.content ?? { type: 'doc' }) !== base.signature
          input ??= {
            ...snapshot,
            markdown:
              changed && snapshot.content
                ? serializeMarkdown(
                    fileReferences(snapshot.content, note, this.state.notes, this.state.roots),
                    base?.source.markdown,
                  )
                : undefined,
            expectedFingerprint: base?.source.fingerprint ?? note.source?.fingerprint,
            expectedRevision: this.revisions.get(note.id) ?? 0,
            operationId,
          }
        } else
          input ??= {
            ...snapshot,
            expectedRevision: this.revisions.get(note.id) ?? 0,
            operationId,
          }
        const saved = await this.transport!.saveNote(input)
        this.revisions.set(note.id, saved.revision)
        if (saved.note?.source) {
          const source = saved.note.source
          const bodyLoaded = this.state.loaded.has(note.id)
          const canonical =
            source.markdown !== undefined ? parseMarkdown(source.markdown) : snapshot.content!
          const current = this.state.notes.find((n) => n.id === note.id)
          const structural =
            !hadSource ||
            source.relativePath !== note.source?.relativePath ||
            source.rootId !== note.source?.rootId
          const replaceContent = structural && current?.content === snapshot.content
          if (replaceContent) resetSession(note.id)
          this.fileBases.set(note.id, {
            source,
            signature: documentSignature(
              replaceContent ? canonical : (snapshot.content ?? canonical),
            ),
          })
          if (!bodyLoaded) this.fileBases.delete(note.id)
          this.publish({
            notes: this.state.notes.map((n) =>
              n.id === note.id
                ? {
                    ...n,
                    source: bodyLoaded ? source : withoutMarkdown(source),
                    ...(replaceContent ? { content: canonical } : {}),
                    title: n.title === snapshot.title ? saved.note!.title : n.title,
                  }
                : n,
            ),
          })
          if (replaceContent) this.pendingNotes.delete(note.id)
        }
        if (this.state.notes.find((n) => n.id === note.id)?.content === note.content) {
          this.pendingNotes.delete(note.id)
        }
        if (!this.pendingNotes.has(note.id) && this.state.loaded.has(note.id))
          this.rememberBody(this.state.notes.find((n) => n.id === note.id)!)
      } catch (error) {
        const message = String(error)
        if (message.includes('FILE_CONFLICT:') || message.includes('NAME_COLLISION:')) {
          this.publish({ conflicts: { ...this.state.conflicts, [note.id]: message } })
          return
        }
        throw error
      }
    })
  }
  private savePreferences() {
    if (!this.transport) return
    const snapshot = {
        appearance: this.state.appearance,
        notebooks: this.state.notebooks,
        workspace: this.state.workspace,
      },
      operationId = crypto.randomUUID()
    let input: Record<string, unknown> | undefined
    this.queue.enqueue('preferences', async () => {
      input ??= { ...snapshot, expectedRevision: this.preferencesRevision, operationId }
      const saved = await this.transport!.savePreferences(input)
      this.preferencesRevision = saved.revision
    })
  }
  private removeListPreferences(ids: string[]) {
    if (!this.state.workspace?.noteLists) return
    const noteLists = { ...this.state.workspace.noteLists }
    ids.forEach((id) => delete noteLists[`book:${id}`])
    this.setWorkspace({ ...this.state.workspace, noteLists })
  }
  setNoteListMode = (noteListMode: NoteListMode) => {
    this.setWorkspace({
      ...(this.state.workspace ?? { tabs: [], activeTabId: null }),
      noteListMode: normalizeNoteListMode(noteListMode),
    })
  }
  setNoteList = (view: string, preferences: NoteListPreferences) => {
    this.setWorkspace({
      ...(this.state.workspace ?? { tabs: [], activeTabId: null }),
      noteLists: { ...this.state.workspace?.noteLists, [view]: preferences },
    })
  }
  setPaneWidths = (paneWidths: PaneWidths) => {
    const normalized = normalizePaneWidths(paneWidths)
    if (!normalized) return
    this.setWorkspace({
      ...(this.state.workspace ?? { tabs: [], activeTabId: null }),
      paneWidths: normalized,
    })
  }
  setContentsWidth = (value: number) => {
    const contentsWidth = normalizeContentsWidth(value)
    if (!contentsWidth) return
    this.setWorkspace({
      ...(this.state.workspace ?? { tabs: [], activeTabId: null }),
      contentsWidth,
    })
  }
  setRecentNotes = (ids: string[]) => {
    const recentNoteIds = normalizeRecentNotes(ids, this.state.notes)
    this.setWorkspace({
      ...(this.state.workspace ?? { tabs: [], activeTabId: null }),
      recentNoteIds,
    })
  }
  setSidebarView = (sidebarView: View) => {
    this.setWorkspace({
      ...(this.state.workspace ?? { tabs: [], activeTabId: null }),
      sidebarView,
    })
  }
  setProjectView = (projectView: string | null) => {
    if ((this.state.workspace?.projectView ?? null) === projectView) return
    this.setWorkspace({
      ...(this.state.workspace ?? { tabs: [], activeTabId: null }),
      projectView,
    })
  }
  setWorkspace = (workspace: WorkspacePreferences) => {
    const noteListMode = workspace.noteListMode ?? this.state.workspace?.noteListMode
    if (noteListMode !== undefined)
      workspace = { ...workspace, noteListMode: normalizeNoteListMode(noteListMode) }
    if (workspace.sidebarView === undefined && this.state.workspace?.sidebarView !== undefined)
      workspace = { ...workspace, sidebarView: this.state.workspace.sidebarView }
    if (workspace.projectView === undefined && this.state.workspace?.projectView)
      workspace = { ...workspace, projectView: this.state.workspace.projectView }
    if (this.state.workspace?.pdfNotes && !workspace.pdfNotes)
      workspace = { ...workspace, pdfNotes: this.state.workspace.pdfNotes }

    if (workspace.recentNoteIds === undefined)
      workspace = { ...workspace, recentNoteIds: this.state.workspace?.recentNoteIds ?? [] }
    workspace = {
      ...workspace,
      recentNoteIds: normalizeRecentNotes(workspace.recentNoteIds, this.state.notes),
    }
    if (this.state.workspace?.noteLists && !workspace.noteLists)
      workspace = { ...workspace, noteLists: this.state.workspace.noteLists }
    if (this.state.workspace?.paneWidths && !workspace.paneWidths)
      workspace = { ...workspace, paneWidths: this.state.workspace.paneWidths }
    if (this.state.workspace?.contentsWidth && !workspace.contentsWidth)
      workspace = { ...workspace, contentsWidth: this.state.workspace.contentsWidth }
    if (
      this.state.syncing ||
      this.state.converting ||
      this.state.quitting ||
      JSON.stringify(workspace) === JSON.stringify(this.state.workspace)
    )
      return
    this.publish({ workspace })
    this.savePreferences()
  }
  setAppearance = (appearance: Appearance) => {
    if (this.state.syncing || this.state.converting || this.state.quitting) return
    this.publish({ appearance })
    this.savePreferences()
  }
  setNotebooks = (change: Notebook[] | ((old: Notebook[]) => Notebook[])) => {
    if (this.state.syncing || this.state.converting || this.state.quitting) return
    this.publish({
      notebooks: typeof change === 'function' ? change(this.state.notebooks) : change,
    })
    this.savePreferences()
  }
  addSamples = () => {
    if (this.state.notes.length || this.state.quitting) return
    const books = new Map(initialNotebooks.map((b) => [b.id, crypto.randomUUID()]))
    this.setNotebooks((old) => [
      ...old,
      ...initialNotebooks.map((b) => ({ ...b, id: books.get(b.id)! })),
    ])
    this.setNotes(
      initialNotes.map((n) => ({
        ...n,
        id: crypto.randomUUID(),
        notebookIds: n.notebookIds.map((id) => books.get(id)!).filter(Boolean),
        updated: Date.now(),
      })),
    )
    void this.flush().catch(() => {})
  }
  private flushParticipants = new Set<() => Promise<void>>()
  registerFlush = (flush: () => Promise<void>) => {
    this.flushParticipants.add(flush)
    return () => {
      this.flushParticipants.delete(flush)
    }
  }
  flush = async () => {
    await Promise.all([...this.flushParticipants].map((flush) => flush()))
    await this.queue.flush()
    if (Object.keys(this.state.conflicts).length)
      throw Error('Resolve the conflicting notes before quitting.')
  }
  requestQuit = async () => {
    if (this.state.converting) {
      this.quitAfterConversion = true
      return
    }
    if (this.state.syncing || this.state.converting || this.state.quitting) return
    this.publish({ quitting: true, quitFailed: false })
    try {
      await this.flush()
      await this.transport?.quit()
    } catch {
      this.publish({ quitting: false, quitFailed: true })
    }
  }
  keepEditing = () => this.publish({ quitFailed: false })
}
