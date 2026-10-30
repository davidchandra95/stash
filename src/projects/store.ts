import { invoke, isTauri } from '@tauri-apps/api/core'
import { useEffect, useSyncExternalStore } from 'react'
import { previewProjectData } from './fixtures'
import type { Project, ProjectData, Task } from './model'

/**
 * Projects and tasks. Edits apply to the snapshot at once, then save in order through one
 * queue; each save sends the last revision the store confirmed, so quick successive edits to
 * the same record don't conflict with each other. A failed save reloads the stored state and
 * shows the error.
 */
const native = isTauri()
type Snapshot = ProjectData & { ready: boolean; error: string; saveError: string }
let snapshot: Snapshot = { projects: [], tasks: [], ready: false, error: '', saveError: '' }
const listeners = new Set<() => void>()
const publish = (patch: Partial<Snapshot>) => {
  snapshot = { ...snapshot, ...patch }
  listeners.forEach((listener) => listener())
}
const confirmed = { projects: new Map<string, number>(), tasks: new Map<string, number>() }
const remember = (data: Partial<ProjectData>) => {
  data.projects?.forEach((p) => confirmed.projects.set(p.id, p.revision))
  data.tasks?.forEach((t) => confirmed.tasks.set(t.id, t.revision))
}
const merge = <T extends { id: string }>(list: T[], changed: T[] = []) => {
  if (!changed.length) return list
  const byId = new Map(changed.map((item) => [item.id, item]))
  const next = list.map((item) => byId.get(item.id) ?? item)
  for (const item of changed) if (!list.some((old) => old.id === item.id)) next.push(item)
  return next
}

type Changes = { projects?: Project[]; tasks?: Task[] }
let queue: Promise<void> = Promise.resolve()
let opening: Promise<void> | undefined

function saveRequest(changes: Changes) {
  return {
    projects: (changes.projects ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      status: p.status,
      startDate: p.startDate,
      endDate: p.endDate,
      notebookId: p.notebookId,
      color: p.color,
      sort: p.sort,
      deleted: p.deletedAt !== null,
      expectedRevision: confirmed.projects.get(p.id) ?? 0,
    })),
    tasks: (changes.tasks ?? []).map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      status: t.status,
      projectId: t.projectId,
      priority: t.priority,
      startDate: t.startDate,
      dueDate: t.dueDate,
      sort: t.sort,
      deleted: t.deletedAt !== null,
      expectedRevision: confirmed.tasks.get(t.id) ?? 0,
    })),
  }
}

/** What the native store does to a saved record, for the browser preview. */
function previewSave(changes: Changes): ProjectData {
  const at = Date.now()
  const stamp = <T extends Project | Task>(record: T, kind: 'projects' | 'tasks'): T => {
    const revision = confirmed[kind].get(record.id) ?? 0
    const done = record.status === 'done'
    return {
      ...record,
      completedAt: done ? (record.completedAt ?? at) : null,
      deletedAt: record.deletedAt === null ? null : record.deletedAt || at,
      created: revision ? record.created : at,
      updated: at,
      revision: revision + 1,
    }
  }
  return {
    projects: (changes.projects ?? []).map((p) => stamp(p, 'projects')),
    tasks: (changes.tasks ?? []).map((t) => stamp(t, 'tasks')),
  }
}

async function load() {
  const data = native ? await invoke<ProjectData>('list_projects') : previewProjectData()
  confirmed.projects.clear()
  confirmed.tasks.clear()
  remember(data)
  publish({ ...data, ready: true, error: '' })
}

export const projectStore = {
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  getSnapshot: () => snapshot,
  async open() {
    if (snapshot.ready) return
    opening ??= load()
      .catch((error) => publish({ error: String(error) }))
      .finally(() => {
        opening = undefined
      })
    await opening
  },
  /** Saves full records. Missing ones are created; `deletedAt` marks deletion. */
  save(changes: Changes): Promise<void> {
    publish({
      projects: merge(snapshot.projects, changes.projects),
      tasks: merge(snapshot.tasks, changes.tasks),
      saveError: '',
    })
    const run = async () => {
      try {
        const saved = native
          ? await invoke<ProjectData>('save_projects', { changes: saveRequest(changes) })
          : previewSave(changes)
        remember(saved)
        // A record edited again while this save ran keeps its newer local value.
        const unchanged = <T extends { id: string }>(list: T[], sent: T[] = []) =>
          (record: T) => {
            const local = list.find((old) => old.id === record.id)
            return !local || sent.includes(local)
          }
        publish({
          projects: merge(
            snapshot.projects,
            saved.projects.filter(unchanged(snapshot.projects, changes.projects)),
          ),
          tasks: merge(snapshot.tasks, saved.tasks.filter(unchanged(snapshot.tasks, changes.tasks))),
        })
      } catch (error) {
        publish({ saveError: String(error) })
        await load().catch((reload) => publish({ error: String(reload) }))
        throw error
      }
    }
    const result = queue.then(run)
    queue = result.catch(() => {})
    return result
  },
  /** Waits for queued saves, for quit. */
  flush: () => queue,
  clearSaveError: () => publish({ saveError: '' }),
}

export function useProjects(enabled: boolean) {
  const value = useSyncExternalStore(projectStore.subscribe, projectStore.getSnapshot)
  useEffect(() => {
    if (enabled) void projectStore.open()
  }, [enabled])
  return value
}

export const newId = () => crypto.randomUUID()
