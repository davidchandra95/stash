import type { View } from '../model'
import type { PdfNavigation } from '../pdf/model'
import type { TaskGroup } from '../projects/model'
export type TaskDateView = 'today' | 'upcoming'
export type SettingsCategory = 'appearance' | 'typography' | 'editor' | 'sync'
export type MobileRoute =
  | { kind: 'list'; view: View; query: string; scroll: number; sortTitle: boolean }
  | { kind: 'note'; id: string; focusTitle?: boolean; scroll: number }
  | { kind: 'settings'; category?: SettingsCategory }
  | { kind: 'calendar' }
  | { kind: 'projects'; scroll: number }
  /** `id` is a project ID, or 'inbox'. */
  | { kind: 'project'; id: string; scroll: number; collapsed: TaskGroup[] }
  | { kind: 'task'; id: string; scroll: number }
  /** Tasks from every project, by due date. */
  | { kind: 'tasks'; view: TaskDateView; scroll: number }
  | { kind: 'pdf'; id: string; target?: PdfNavigation }
export type MobileNavigation = { routes: MobileRoute[] }
/** Done starts collapsed, as on desktop. */
export const projectRoute = (id: string): MobileRoute => ({
  kind: 'project',
  id,
  scroll: 0,
  collapsed: ['done'],
})
export const initialNavigation = (): MobileNavigation => ({
  routes: [{ kind: 'list', view: 'all', query: '', scroll: 0, sortTitle: false }],
})
export type NavigationAction =
  | { type: 'push'; route: MobileRoute }
  | { type: 'back' }
  | { type: 'replace'; route: MobileRoute }
  | { type: 'library'; view: View }
  /** From the drawer: the project list, with a project on top so Back walks to the list. */
  | { type: 'projects'; project?: string; tasks?: TaskDateView }
export function mobileNavigation(
  state: MobileNavigation,
  action: NavigationAction,
): MobileNavigation {
  switch (action.type) {
    case 'push':
      return { routes: [...state.routes, action.route] }
    case 'back':
      return state.routes.length > 1 ? { routes: state.routes.slice(0, -1) } : state
    case 'replace':
      return { routes: [...state.routes.slice(0, -1), action.route] }
    case 'library':
      return {
        routes: [{ kind: 'list', view: action.view, query: '', scroll: 0, sortTitle: false }],
      }
    case 'projects':
      return {
        routes: [
          { kind: 'projects', scroll: 0 },
          ...(action.project ? [projectRoute(action.project)] : []),
          ...(action.tasks ? [{ kind: 'tasks' as const, view: action.tasks, scroll: 0 }] : []),
        ],
      }
  }
}
