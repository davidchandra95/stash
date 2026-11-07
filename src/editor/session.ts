import { platform } from '../platform'
import { Editor, type JSONContent } from '@tiptap/core'
import { writingExtensions } from './extensions'
import { markdownExtensions } from './markdown'
import { undoDepth, redoDepth } from '@tiptap/pm/history'
import { Selection, type Transaction } from '@tiptap/pm/state'
import { Step } from '@tiptap/pm/transform'
import type { Mark } from '@tiptap/pm/model'
import { findKey, revealKey } from './noteTools'
import { registerEditorLifetime, retainEditorOperation } from './lifecycle'
import { pendingFragments } from './fileNavigation'
import { HeadingFolds } from './headingFolds'

// Views are bounded; edited documents and their session undo stay authoritative.
// History-free editors can be reconstructed from the caller's note model.
export const noteScrollPositions = new Map<string, number>()
/** Scroll positions in the split editor group, which can show the same note elsewhere. */
export const splitScrollPositions = new Map<string, number>()
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
/** Second editors for notes shown in the split group. They live only while mounted. */
type SplitView = {
  editor: Editor
  source: Editor
  consumers: number
  operations: number
  dispose: () => void
}
const splitViews = new Map<string, SplitView>()
const viewSync = 'noteViewSync'
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
function sweepSplitViews() {
  for (const [id, split] of splitViews)
    if (!split.consumers && !split.operations && !split.editor.view.dom.isConnected)
      disposeSplitView(id)
}
function disposeSplitView(id: string) {
  const split = splitViews.get(id)
  if (!split) return
  splitViews.delete(id)
  split.dispose()
}
export function trimEditorSessions() {
  sweepSplitViews()
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
function createEditor(
  id: string,
  content: JSONContent,
  markdown: boolean,
  onUpdate: (props: { editor: Editor }) => void = () => {},
) {
  return new Editor({
    extensions: (markdown ? markdownExtensions : writingExtensions)
      .filter((extension) => !platform.mobile || !mobileExcludedExtensions.has(extension.name))
      .map((extension) =>
        extension.name === HeadingFolds.name ? HeadingFolds.configure({ noteId: id }) : extension,
      ),
    coreExtensionOptions: { clipboardTextSerializer: { blockSeparator: '\n' } },
    content,
    onUpdate,
    editorProps: { attributes: { 'aria-label': 'Note content', spellcheck: 'true' } },
  })
}
/** Applies another view's changes without entering this view's undo history. */
function syncDocument(source: Editor, target: Editor, transactions: readonly Transaction[]) {
  if (target.isDestroyed) return
  const replaceAll = () =>
    target.state.tr.replaceWith(
      0,
      target.state.doc.content.size,
      target.schema.nodeFromJSON(source.state.doc.toJSON()).content,
    )
  let tr = target.state.tr
  try {
    // Each editor owns its schema, so steps have to be rebuilt against the target's.
    for (const transaction of transactions)
      for (const step of transaction.steps) tr.step(Step.fromJSON(target.schema, step.toJSON()))
  } catch {
    tr = replaceAll()
  }
  const mark = (change: Transaction) =>
    change.setMeta(viewSync, true).setMeta('addToHistory', false).setMeta('skipTrailingNode', true)
  target.view.dispatch(mark(tr))
  // Plugins may react differently in each view. The editing view's document always wins.
  if (target.state.doc.content.size !== source.state.doc.content.size)
    target.view.dispatch(mark(replaceAll()))
}
function linkViews(source: Editor, target: Editor) {
  const forward = ({
    transaction,
    appendedTransactions,
  }: {
    transaction: Transaction
    appendedTransactions: Transaction[]
  }) => {
    if (transaction.getMeta(viewSync)) return
    const changes = [transaction, ...appendedTransactions].filter((change) => change.docChanged)
    if (changes.length) syncDocument(source, target, changes)
  }
  source.on('transaction', forward)
  return () => source.off('transaction', forward)
}
/**
 * The split group's own editor for a note. It shares the document with the main session but
 * has its own view, selection and undo history. Saving still goes through the main session.
 */
export function getSplitEditor(
  id: string,
  content: JSONContent,
  onChange?: Change,
  markdown = false,
) {
  const source = getEditor(id, content, onChange, markdown)
  const current = splitViews.get(id)
  if (current?.source === source && !current.editor.isDestroyed) return current.editor
  disposeSplitView(id)
  const editor = createEditor(id, source.getJSON(), markdown)
  const release = retainEditorOperation(source)
  const unlink = [linkViews(source, editor), linkViews(editor, source)]
  const split: SplitView = {
    editor,
    source,
    consumers: 0,
    operations: 0,
    dispose: () => {
      unlink.forEach((remove) => remove())
      unregister()
      editor.destroy()
      release()
    },
  }
  const retainSplit = (kind: 'consumers' | 'operations') => () => {
    split[kind]++
    let released = false
    return () => {
      if (released) return
      released = true
      split[kind]--
      scheduleTrim()
    }
  }
  const unregister = registerEditorLifetime(editor, {
    view: retainSplit('consumers'),
    operation: retainSplit('operations'),
  })
  splitViews.set(id, split)
  scheduleTrim()
  return editor
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
    const editor = createEditor(id, content, markdown, ({ editor: current }) => {
      currentSession.changed = true
      currentSession.onChange?.(current.getJSON(), current.getText())
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
  disposeSplitView(id)
  const session = sessions.get(id)
  session?.editor?.destroy()
  session?.unregister?.()
  if (session) live.delete(session)
  sessions.delete(id)
}
export function clearSessions() {
  noteScrollPositions.clear()
  splitScrollPositions.clear()
  for (const id of sessions.keys()) resetSession(id)
}
export function pruneEditorSessions(noteIds: ReadonlySet<string>) {
  for (const id of sessions.keys()) if (!noteIds.has(id)) resetSession(id)
  for (const id of noteScrollPositions.keys()) if (!noteIds.has(id)) noteScrollPositions.delete(id)
  for (const id of splitScrollPositions.keys())
    if (!noteIds.has(id)) splitScrollPositions.delete(id)
  for (const id of pendingFragments.keys()) if (!noteIds.has(id)) pendingFragments.delete(id)
}
if (import.meta.hot) import.meta.hot.dispose(clearSessions)

/** Read the mounted editor without creating or changing a session. */
export function peekEditor(id: string, split = false) {
  return (split ? splitViews.get(id)?.editor : undefined) ?? sessions.get(id)?.editor ?? undefined
}
