import AppTooltip from './AppTooltip'
import { useShortcutActions, useShortcutLabel } from '../useShortcuts'
import { useEffect, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { PanelLeft, PanelLeftClose, Columns2, ArrowLeft, ArrowRight } from '../icons'
import type { Appearance, Note, Notebook } from '../model'
import QuickOpen from './QuickOpen'
import ContentSearch from './ContentSearch'
import type { MatchNavigation, ReadSearchNote } from '../search'

export default function TitleBar({
  notes,
  notebooks,
  appearance,
  sidebarVisible,
  noteListVisible,
  noteListAvailable,
  disabled,
  onToggleSidebar,
  onToggleNoteList,
  onSelect,
  canBack = false,
  canForward = false,
  onBack,
  onForward,
  recentNoteIds = [],
  readSearchNote,
  onSelectMatch,
}: {
  notes: Note[]
  notebooks: Notebook[]
  appearance: Appearance
  sidebarVisible: boolean
  noteListVisible: boolean
  noteListAvailable: boolean
  disabled: boolean
  onToggleSidebar: () => void
  onToggleNoteList: () => void
  onSelect: (id: string, newTab?: boolean) => void
  canBack?: boolean
  canForward?: boolean
  onBack?: () => void
  onForward?: () => void
  recentNoteIds?: string[]
  readSearchNote: ReadSearchNote
  onSelectMatch: (request: MatchNavigation, newTab?: boolean) => void
}) {
  const [searchMode, setSearchMode] = useState<'quick' | 'content' | null>(null)
  const native = isTauri()
  const shortcutLabel = useShortcutLabel()
  useShortcutActions(
    { 'quick-open': () => setSearchMode('quick'), search: () => setSearchMode('content') },
    disabled,
  )
  useEffect(() => {
    if (disabled) setSearchMode(null)
  }, [disabled])
  return (
    <header className={`title-bar ${native ? 'native-title-bar' : ''}`} data-tauri-drag-region>
      <div className="title-bar-left" data-tauri-drag-region>
        <AppTooltip
          instant
          label={sidebarVisible ? 'Hide sidebar' : 'Show sidebar'}
          shortcut={shortcutLabel('sidebar')}
          disabled={disabled}
        >
          <button
            className="icon-button"
            disabled={disabled}
            onClick={onToggleSidebar}
            aria-label={sidebarVisible ? 'Hide sidebar' : 'Show sidebar'}
          >
            {sidebarVisible ? <PanelLeftClose size={17} /> : <PanelLeft size={17} />}
          </button>
        </AppTooltip>
        <AppTooltip
          instant
          label={noteListVisible ? 'Hide notes list' : 'Show notes list'}
          disabled={disabled || !noteListAvailable}
        >
          <button
            className="icon-button"
            disabled={disabled || !noteListAvailable}
            onClick={onToggleNoteList}
            aria-label={noteListVisible ? 'Hide notes list' : 'Show notes list'}
            aria-expanded={noteListVisible}
            aria-controls="note-list"
          >
            <Columns2 size={17} />
          </button>
        </AppTooltip>
      </div>
      <div className="title-bar-controls" data-tauri-drag-region>
        <div className="title-navigation">
          <AppTooltip
            instant
            label="Back to previous note"
            shortcut={shortcutLabel('back')}
            disabled={disabled || !canBack}
          >
            <button
              className="icon-button"
              aria-label="Back to previous note"
              disabled={disabled || !canBack}
              onClick={onBack}
            >
              <ArrowLeft size={16} />
            </button>
          </AppTooltip>
          <AppTooltip
            instant
            label="Forward to next note"
            shortcut={shortcutLabel('forward')}
            disabled={disabled || !canForward}
          >
            <button
              className="icon-button"
              aria-label="Forward to next note"
              disabled={disabled || !canForward}
              onClick={onForward}
            >
              <ArrowRight size={16} />
            </button>
          </AppTooltip>
        </div>
        <div className="title-bar-search">
          <QuickOpen
            open={searchMode === 'quick'}
            onOpenChange={(open) =>
              setSearchMode((mode) => (open ? 'quick' : mode === 'quick' ? null : mode))
            }
            notes={notes}
            notebooks={notebooks}
            appearance={appearance}
            disabled={disabled}
            recentNoteIds={recentNoteIds}
            onSelect={onSelect}
          />
          <ContentSearch
            open={searchMode === 'content'}
            onOpenChange={(open) =>
              setSearchMode((mode) => (open ? 'content' : mode === 'content' ? null : mode))
            }
            onQuickOpen={() => setSearchMode('quick')}
            notes={notes}
            notebooks={notebooks}
            appearance={appearance}
            disabled={disabled}
            readNote={readSearchNote}
            onSelectMatch={onSelectMatch}
          />
        </div>
      </div>
    </header>
  )
}
