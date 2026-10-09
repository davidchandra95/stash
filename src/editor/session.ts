import { platform } from '../platform'
import { Editor, type JSONContent } from '@tiptap/core'
import { writingExtensions } from './extensions'
import { markdownExtensions } from './markdown'
import { undoDepth, redoDepth } from '@tiptap/pm/history'
import { Selection } from '@tiptap/pm/state'
import type { Mark } from '@tiptap/pm/model'
import { findKey, revealKey } from './noteTools'
import { registerEditorLifetime } from './lifecycle'
import { pendingFragments } from './fileNavigation'

// Views are bounded; edited documents and their session undo stay authoritative.
// History-free editors can be reconstructed from the caller's note model.
export const noteScrollPositions = new Map<string, number>()
type Change = (content: JSONContent, text: string) => void
type ColdState = {
  selection: ReturnType<Selection['toJSON']>
  marks: ReturnType<Mark['toJSON']>[] | null
  find: { query: string; active: number }
  reveals: number[]
}
type Session = {
  editor: Editor | null
  suspended: boolean
  markdown: boolean
  changed: boolean
  consumers: number
  operations: number
  onChange?: Change
  cold?: ColdState
  unregister?: () => void
}
const sessions = new Map<string, Session>()
const live = new Set<Session>()
const retentionListeners = new Set<() => void>()
const maximumLiveViews = 4
let trimScheduled = false
const mobileExcludedExtensions = new Set(['writingCursorLayer', 'selectionHighlight'])

function scheduleTrim() {
  if (trimScheduled) return
  trimScheduled = true
  // React must finish detaching EditorContent and cleaning up its consumers first.
  queueMicrotask(() => {
    trimScheduled = false
    trimEditorSessions()
  })
}
function retain(session: Session, kind: 'consumers' | 'operations') {
  if (!session.editor || session.editor.isDestroyed) return () => {}
  session[kind]++
  let released = false
  return () => {
    if (released) return
    released = true
    session[kind]--
    scheduleTrim()
  }
}
function protectedView(session: Session) {
  return (
    session.consumers > 0 ||
    session.operations > 0 ||
    (!session.suspended &&
      !!session.editor &&
      !session.editor.isDestroyed &&
      session.editor.view.dom.isConnected)
  )
}
function hasHistory(editor: Editor) {
  return undoDepth(editor.state) > 0 || redoDepth(editor.state) > 0
}
function captureColdState(editor: Editor): ColdState {
  const state = editor.state
  const find = findKey.getState(state)
  return {
    selection: state.selection.toJSON(),
    marks: state.storedMarks?.map((mark) => mark.toJSON()) ?? null,
    find: { query: find?.query ?? '', active: find?.active ?? -1 },
    reveals: [...(revealKey.getState(state) ?? [])],
  }
}
function makeCold(session: Session) {
  session.cold = captureColdState(session.editor!)
  session.editor!.destroy()
  session.unregister?.()
  session.unregister = undefined
  session.editor = null
  session.suspended = false
  session.onChange = undefined
  live.delete(session)
}
export function trimEditorSessions() {
  for (const session of live) {
    if (session.editor!.isDestroyed) {
      live.delete(session)
      continue
    }
    if (live.size <= maximumLiveViews) break
    if (protectedView(session)) continue
    if (!session.changed && !hasHistory(session.editor!)) makeCold(session)
    else {
      session.editor!.unmount()
      session.suspended = true
      live.delete(session)
    }
  }
  retentionListeners.forEach((listener) => listener())
}
export function subscribeSessionRetention(listener: () => void) {
  retentionListeners.add(listener)
  return () => {
    retentionListeners.delete(listener)
  }
}
/** Call only with the authoritative saved model, after pending saves and conflicts are checked. */
export function evictSession(id: string, savedContent: JSONContent) {
  const session = sessions.get(id)
  if (!session?.editor) return true
  if (protectedView(session) || hasHistory(session.editor)) return false
  if (!session.editor.state.doc.eq(session.editor.schema.nodeFromJSON(savedContent))) return false
  makeCold(session)
  return true
}
export function getSessionStats() {
  const records = [...sessions.values()]
  return {
    sessions: records.length,
    retainedEditors: records.filter((session) => session.editor).length,
    liveViews: live.size,
    suspendedEditors: records.filter((session) => session.suspended).length,
    visibleConsumers: records.reduce((sum, session) => sum + session.consumers, 0),
    pendingOperations: records.reduce((sum, session) => sum + session.operations, 0),
  }
}
export function getEditor(id: string, content: JSONContent, onChange?: Change, markdown = false) {
  let session = sessions.get(id)
  if (
    session &&
    (session.markdown !== markdown || (session.editor?.isDestroyed && !session.suspended))
  ) {
    resetSession(id)
    session = undefined
  }
  if (!session) {
    session = {
      editor: null,
      suspended: false,
      markdown,
      changed: false,
      consumers: 0,
      operations: 0,
    }
    sessions.set(id, session)
  }
  const currentSession = session
  if (onChange) session.onChange = onChange
  if (!session.editor) {
    const editor = new Editor({
      extensions: (markdown ? markdownExtensions : writingExtensions).filter(
        (extension) => !platform.mobile || !mobileExcludedExtensions.has(extension.name),
      ),
      coreExtensionOptions: { clipboardTextSerializer: { blockSeparator: '\n' } },
      content,
      onUpdate: ({ editor: current }) => {
        currentSession.changed = true
        currentSession.onChange?.(current.getJSON(), current.getText())
      },
      editorProps: { attributes: { 'aria-label': 'Note content', spellcheck: 'true' } },
    })
    session.editor = editor
    session.changed = false
    session.unregister = registerEditorLifetime(editor, {
      view: () => retain(currentSession, 'consumers'),
      operation: () => retain(currentSession, 'operations'),
    })
    if (session.cold) {
      const cold = session.cold
      const tr = editor.state.tr
        .setMeta(findKey, cold.find)
        .setMeta(revealKey, { reveal: cold.reveals })
        .setMeta('addToHistory', false)
        .setMeta('skipTrailingNode', true)
      // An externally replaced document may no longer fit the old selection.
      try {
        tr.setSelection(Selection.fromJSON(tr.doc, cold.selection))
      } catch {
        /* use initial selection */
      }
      tr.setStoredMarks(cold.marks?.map((mark) => editor.schema.markFromJSON(mark)) ?? null)
      editor.view.dispatch(tr)
      session.cold = undefined
    }
  } else if (session.suspended) {
    session.editor.mount(document.createElement('div'))
    session.suspended = false
  }
  live.delete(session)
  live.add(session)
  scheduleTrim()
  return session.editor
}
export function resetSession(id: string) {
  const session = sessions.get(id)
  session?.editor?.destroy()
  session?.unregister?.()
  if (session) live.delete(session)
  sessions.delete(id)
}
export function clearSessions() {
  noteScrollPositions.clear()
  for (const id of sessions.keys()) resetSession(id)
}
export function pruneEditorSessions(noteIds: ReadonlySet<string>) {
  for (const id of sessions.keys()) if (!noteIds.has(id)) resetSession(id)
  for (const id of noteScrollPositions.keys()) if (!noteIds.has(id)) noteScrollPositions.delete(id)
  for (const id of pendingFragments.keys()) if (!noteIds.has(id)) pendingFragments.delete(id)
}
if (import.meta.hot) import.meta.hot.dispose(clearSessions)
