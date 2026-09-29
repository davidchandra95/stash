import { useEffect, useSyncExternalStore } from 'react'
import { platform } from '../platform'
import { addPluginListener, invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { LibraryStore } from './library'
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
export function useLibrary() {
  const state = useSyncExternalStore(library.subscribe, library.getSnapshot)
  useEffect(start, [])
  return {
    ...state,
    setNotes: library.setNotes,
    setNotebooks: library.setNotebooks,
    deleteNotebook: library.deleteNotebook,
    updateNotebook: library.updateNotebook,
    setAppearance: library.setAppearance,
    setWorkspace: library.setWorkspace,
    setPaneWidths: library.setPaneWidths,
    load: library.load,
    activate: library.activate,
    retryOpen: () => {
      if (!started) start()
      else void library.open()
    },
    flush: library.flush,
    requestQuit: library.requestQuit,
    keepEditing: library.keepEditing,
    addSamples: library.addSamples,
  }
}
