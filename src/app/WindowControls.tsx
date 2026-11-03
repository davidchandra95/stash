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
