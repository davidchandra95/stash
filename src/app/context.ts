import { createContext, useContext } from 'react'
import type { AppController } from './useAppController'

export const AppContext = createContext<AppController | null>(null)

export function useApp() {
  const app = useContext(AppContext)
  if (!app) throw Error('useApp must be used inside the desktop workspace.')
  return app
}

/** Library operations that block workspace interaction while they run. */
export function useBlocked() {
  const { library } = useApp()
  return library.quitting || library.syncing || library.converting
}
