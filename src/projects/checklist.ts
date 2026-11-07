/**
 * Subtasks: one-line checklist items inside a task, in display order. They complete on their own
 * and never complete the task. The native store, the sync server and `validateChecklist` share
 * the limits below.
 */
export interface ChecklistItem {
  id: string
  title: string
  done: boolean
}
export const maxChecklistItems = 100
export const maxChecklistTitle = 500

/** One line, trimmed, and at most 500 characters (counted as code points, as the server does). */
export const checklistTitle = (value: string) =>
  [...value.replace(/\s*[\r\n]+\s*/g, ' ').trim()].slice(0, maxChecklistTitle).join('')

export function validateChecklist(list: ChecklistItem[] | null | undefined) {
  if (!list) return
  const ids = new Set(list.map((item) => item.id))
  const valid =
    Array.isArray(list) &&
    list.length <= maxChecklistItems &&
    ids.size === list.length &&
    list.every(
      (item) =>
        /^[A-Za-z0-9_-]{1,128}$/.test(item.id) &&
        typeof item.done === 'boolean' &&
        typeof item.title === 'string' &&
        item.title.trim() !== '' &&
        [...item.title].length <= maxChecklistTitle &&
        !/[\r\n]/.test(item.title),
    )
  if (!valid) throw Error('A task can have up to 100 subtasks, each one line of up to 500 characters.')
}

export function checklistProgress(task: { checklist?: ChecklistItem[] }) {
  const list = task.checklist ?? []
  return { done: list.filter((item) => item.done).length, total: list.length }
}

/** Inserts an item at `index` (the end by default). Blank titles and a full list change nothing. */
export function insertItem(list: ChecklistItem[], item: ChecklistItem, index = list.length) {
  const title = checklistTitle(item.title)
  if (!title || list.length >= maxChecklistItems) return list
  const next = [...list]
  next.splice(Math.max(0, Math.min(index, list.length)), 0, { ...item, title })
  return next
}

export const updateItem = (list: ChecklistItem[], id: string, patch: Partial<Omit<ChecklistItem, 'id'>>) =>
  list.map((item) =>
    item.id === id
      ? { ...item, ...patch, ...(patch.title !== undefined ? { title: checklistTitle(patch.title) } : {}) }
      : item,
  )

export const removeItem = (list: ChecklistItem[], id: string) => list.filter((item) => item.id !== id)

/** Moves an item one place up (-1) or down (+1); the ends stay put. */
export function moveItem(list: ChecklistItem[], id: string, delta: -1 | 1) {
  const from = list.findIndex((item) => item.id === id)
  const to = from + delta
  if (from < 0 || to < 0 || to >= list.length) return list
  const next = [...list]
  ;[next[from], next[to]] = [next[to], next[from]]
  return next
}

/** The next occurrence of a repeating task starts with every subtask open again. */
export const reopenChecklist = (list: ChecklistItem[] | undefined) =>
  list?.length ? list.map((item) => (item.done ? { ...item, done: false } : item)) : list
