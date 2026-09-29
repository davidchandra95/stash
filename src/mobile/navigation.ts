import type { View } from '../model'
export type SettingsCategory = 'appearance' | 'typography' | 'editor' | 'sync'
export type MobileRoute =
  | { kind: 'list'; view: View; query: string; scroll: number; sortTitle: boolean }
  | { kind: 'note'; id: string; focusTitle?: boolean; scroll: number }
  | { kind: 'settings'; category?: SettingsCategory }
export type MobileNavigation = { routes: MobileRoute[] }
export const initialNavigation = (): MobileNavigation => ({
  routes: [{ kind: 'list', view: 'all', query: '', scroll: 0, sortTitle: false }],
})
export type NavigationAction =
  | { type: 'push'; route: MobileRoute }
  | { type: 'back' }
  | { type: 'replace'; route: MobileRoute }
  | { type: 'library'; view: View }
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
  }
}
