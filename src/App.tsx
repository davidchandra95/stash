import { useEffect, useState, type CSSProperties } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import CommandPalette, { type PaletteScope } from './components/CommandPalette'
import { MotionPresence, motion } from './motion'
import { platform } from './platform'
import { ShortcutContext, useShortcutActions } from './useShortcuts'
import { useLibrarySelector, library as libraryStore } from './storage/useLibrary'
import type { Note } from './model'
import { AppContext } from './app/context'
import { useAppController } from './app/useAppController'
import Sidebar from './app/Sidebar'
import NoteListPane from './app/NoteListPane'
import EditorPane from './app/EditorPane'
import Overlays from './app/Overlays'

const noNotes: Note[] = []

/** Tracks which pane the user last worked in, and whether the window is key. */
function usePaneFocus() {
  const [pane, setPane] = useState<string | null>(null)
  const [windowActive, setWindowActive] = useState(() => document.hasFocus())
  useEffect(() => {
    const focus = () => setWindowActive(true)
    const blur = () => setWindowActive(false)
    window.addEventListener('focus', focus)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('focus', focus)
      window.removeEventListener('blur', blur)
    }
  }, [])
  const track = (event: { target: EventTarget }) => {
    const owner = (event.target as Element).closest?.<HTMLElement>('[data-pane]')
    if (owner) setPane(owner.dataset.pane ?? null)
  }
  return { pane, windowActive, track }
}

export default function App() {
  const app = useAppController()
  const { library, appearance, workspace } = app
  const blocked = library.quitting || library.syncing || library.converting
  const [palette, setPalette] = useState<{ open: boolean; scope: PaletteScope }>({
    open: false,
    scope: 'titles',
  })
  const paletteNotes = useLibrarySelector((state) => (palette.open ? state.notes : noNotes))
  const paneFocus = usePaneFocus()

  useShortcutActions(
    {
      'quick-open': () => setPalette({ open: true, scope: 'titles' }),
      search: () => setPalette({ open: true, scope: 'bodies' }),
    },
    !library.ready || blocked,
    appearance.shortcuts ?? {},
  )
  useEffect(() => {
    if (blocked) setPalette((value) => (value.open ? { ...value, open: false } : value))
  }, [blocked])

  // Native vibrancy needs a transparent page behind the sidebar.
  const nativeChrome = isTauri() && platform.platform === 'macos'
  const vibrancy = nativeChrome && appearance.translucentSidebar
  useEffect(() => {
    document.documentElement.toggleAttribute('data-vibrancy', vibrancy)
  }, [vibrancy])

  if (!library.ready)
    return (
      <div ref={app.appRef} className="startup">
        <h2>{library.startupError ? 'Couldn’t open your library' : 'Opening your library…'}</h2>
        {library.startupError && (
          <>
            <p role="alert">{library.startupError}</p>
            <p>Your existing library has not been replaced.</p>
            <button className="btn" onClick={() => void library.retryOpen()}>
              Try again
            </button>
          </>
        )}
      </div>
    )

  const sidebarVisible = app.sidebar && !app.focus
  const className = [
    'window',
    workspace.documentId && 'pdf-active',
    app.focus && 'focus-mode',
    !sidebarVisible && 'no-sidebar',
    !app.noteListVisible && 'no-note-list',
    (app.paneResize.resizing || app.contentsResize.resizing) && 'is-resizing',
    nativeChrome && 'native-chrome',
    !paneFocus.windowActive && 'is-inactive',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <ShortcutContext.Provider value={appearance.shortcuts ?? {}}>
      <AppContext.Provider value={app}>
        <div
          className={className}
          ref={app.appRef}
          data-active-pane={paneFocus.pane ?? undefined}
          style={app.variables as CSSProperties}
          onPointerDownCapture={paneFocus.track}
          onFocusCapture={paneFocus.track}
        >
          <MotionPresence open={sidebarVisible} duration={motion.sidebar} initial={false}>
            <Sidebar onSearch={() => setPalette({ open: true, scope: 'titles' })} />
          </MotionPresence>
          <NoteListPane />
          {sidebarVisible && (
            <div {...app.paneResize.dividerProps('sidebar')} aria-controls="notebook-sidebar" />
          )}
          {app.noteListVisible && (
            <div {...app.paneResize.dividerProps('noteList')} aria-controls="note-list" />
          )}
          <EditorPane />
          <Overlays />
          <CommandPalette
            open={palette.open}
            onOpenChange={(open) => setPalette((value) => ({ ...value, open }))}
            initialScope={palette.scope}
            notes={paletteNotes}
            notebooks={app.notebooks}
            disabled={blocked}
            recentNoteIds={library.workspace?.recentNoteIds ?? []}
            commands={app.paletteCommands}
            readNote={libraryStore.readSearchNote}
            onSelect={(id, newTab) => {
              if (!app.notes.some((note) => note.id === id && !note.trashed)) return
              if (newTab) workspace.open(id, true)
              else workspace.preview(id)
              app.setFocus(false)
            }}
            onSelectMatch={(request, newTab) => {
              if (!app.notes.some((note) => note.id === request.noteId && !note.trashed)) return
              if (newTab) workspace.open(request.noteId, true)
              else workspace.preview(request.noteId)
              app.setFocus(false)
              app.setFindOpen(true)
              app.setMatchNavigation(request)
            }}
          />
        </div>
      </AppContext.Provider>
    </ShortcutContext.Provider>
  )
}
