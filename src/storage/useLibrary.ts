import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { platform } from '../platform'
import { addPluginListener, invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { LibraryStore, type LibraryState } from './library'
const native = isTauri()
export const library = new LibraryStore(
  native
    ? {
        command: (name, args) => invoke(name, args),
        open: () => invoke('open_library'),
        load: (id) => invoke('load_note', { id }),
        saveNote: (input) => invoke('save_note', { input }),
        savePreferences: (input) => invoke('save_preferences', { input }),
        quit: () => invoke('finish_quit'),
      }
    : null,
)
let started = false
function start() {
  if (started) return
  started = true
  if (native) {
    const startup = async () => {
      if (platform.mobile) {
        library.useImmediateSaves()
        if (platform.platform === 'android')
          await addPluginListener<{ state: string }>('stash-platform', 'lifecycle', ({ state }) => {
            if (state === 'paused') void library.flush().catch(() => {})
            else void library.refreshSyncStatus()
          })
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'hidden') void library.flush().catch(() => {})
        })
      } else {
        await listen('save-before-quit', () => {
          if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
          void library.requestQuit()
        })
        await invoke('frontend_ready')
      }
      await library.open()
      await library.refreshSyncStatus()
    }
    void startup().catch((error) => {
      started = false
      library.failStartup(error)
    })
    void listen<string>('sync-progress', (event) => library.setSyncProgress(event.payload))
    window.addEventListener('blur', () => {
      void library.flush().catch(() => {})
    })
    document.addEventListener(
      'keydown',
      (event) => {
        if (
          library.getSnapshot().quitting ||
          library.getSnapshot().syncing ||
          library.getSnapshot().converting
        ) {
          event.preventDefault()
          event.stopImmediatePropagation()
        }
      },
      true,
    )
  }
}
export function useLibrarySelector<T>(
  select: (state: LibraryState) => T,
  equal: (a: T, b: T) => boolean = Object.is,
) {
  const committed = useRef<{ value: T } | null>(null)
  const getSelected = useMemo(() => {
    let snapshot: LibraryState | undefined
    let value: T
    return () => {
      const next = library.getSnapshot()
      if (snapshot === next) return value
      const selected = select(next)
      const previous = snapshot ? { value } : committed.current
      snapshot = next
      value = previous && equal(previous.value, selected) ? previous.value : selected
      return value
    }
  }, [select, equal])
  const value = useSyncExternalStore(library.subscribe, getSelected, getSelected)
  useEffect(() => {
    committed.current = { value }
  }, [value])
  useEffect(start, [])
  return value
}
const retryOpen = () => {
  if (!started) start()
  else void library.open()
}
export const libraryActions = {
  setNotes: library.setNotes,
  setNotebooks: library.setNotebooks,
  deleteNotebook: library.deleteNotebook,
  updateNotebook: library.updateNotebook,
  setAppearance: library.setAppearance,
  setWorkspace: library.setWorkspace,
  setPaneWidths: library.setPaneWidths,
  load: library.load,
  activate: library.activate,
  retryOpen,
  flush: library.flush,
  requestQuit: library.requestQuit,
  keepEditing: library.keepEditing,
  addSamples: library.addSamples,
}
export function useLibrary() {
  const state = useLibrarySelector(library.getSnapshot)
  return {
    ...state,
    ...libraryActions,
  }
}

export function shallowEqual<T extends object>(a: T, b: T) {
  const keys = Object.keys(a) as (keyof T)[]
  return keys.length === Object.keys(b).length && keys.every((key) => Object.is(a[key], b[key]))
}
