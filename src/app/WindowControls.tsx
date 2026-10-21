import AppTooltip from '../components/AppTooltip'
import { Columns2, PanelLeft } from '../icons'
import { useApp, useBlocked } from './context'

export function SidebarToggle() {
  const app = useApp()
  const blocked = useBlocked()
  const visible = app.sidebar && !app.focus
  const label = visible ? 'Hide sidebar' : 'Show sidebar'
  return (
    <AppTooltip instant label={label} shortcut={app.shortcutFor('sidebar')} disabled={blocked}>
      <button
        className="icon-btn"
        aria-label={label}
        aria-expanded={visible}
        aria-controls="notebook-sidebar"
        disabled={blocked}
        onClick={app.toggleSidebar}
      >
        <PanelLeft aria-hidden="true" />
      </button>
    </AppTooltip>
  )
}

export function NoteListToggle() {
  const app = useApp()
  const blocked = useBlocked()
  const label = app.noteListVisible ? 'Hide notes list' : 'Show notes list'
  const unavailable = !!app.workspace.documentId
  return (
    <AppTooltip instant label={label} disabled={blocked || unavailable}>
      <button
        className="icon-btn"
        aria-label={label}
        aria-expanded={app.noteListVisible}
        aria-controls="note-list"
        disabled={blocked || unavailable}
        onClick={app.toggleNoteList}
      >
        <Columns2 aria-hidden="true" />
      </button>
    </AppTooltip>
  )
}

/**
 * The first visible pane hosts the window controls: native traffic-light space plus the
 * toggles for any panes that are hidden to its left. The editor always offers a way back
 * to a hidden notes list.
 */
export function LeadingControls({ pane }: { pane: 'list' | 'editor' }) {
  const app = useApp()
  const sidebarVisible = app.sidebar && !app.focus
  const listToggle = pane === 'editor' && !app.noteListVisible && !app.workspace.documentId
  if (sidebarVisible) return listToggle ? <NoteListToggle /> : null
  if (pane === 'editor' && app.noteListVisible) return null
  return (
    <>
      <span className="window-controls-space" data-tauri-drag-region />
      <SidebarToggle />
      {listToggle && <NoteListToggle />}
    </>
  )
}
