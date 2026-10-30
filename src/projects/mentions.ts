import { invoke, isTauri } from '@tauri-apps/api/core'
import type { JSONContent } from '@tiptap/react'
import type { Note } from '../model'
import { library } from '../storage/useLibrary'

const mentions = (node: JSONContent | undefined, taskId: string): boolean =>
  !!node &&
  ((node.type === 'taskReference' && node.attrs?.taskId === taskId) ||
    (node.content ?? []).some((child) => mentions(child, taskId)))

/** Whether a note's body mentions the task (a mention node, or a link in linked Markdown). */
export function noteMentionsTask(
  note: Pick<Note, 'content' | 'source'>,
  taskId: string,
): boolean {
  const markdown = note.source?.markdown
  if (markdown !== undefined)
    return new RegExp(`stash://task/${taskId}(?![A-Za-z0-9_-])`).test(markdown)
  return mentions(note.content, taskId)
}

/** IDs of notes outside Trash that mention the task, newest first. */
export async function findTaskMentions(taskId: string): Promise<string[]> {
  if (isTauri()) return invoke<string[]>('task_mentions', { taskId })
  // The browser preview holds every note in memory.
  return library
    .getSnapshot()
    .notes
    .filter((note) => !note.trashed && noteMentionsTask(note, taskId))
    .sort((a, b) => b.updated - a.updated)
    .map((note) => note.id)
}
