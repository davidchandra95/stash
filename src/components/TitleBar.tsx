import { useShortcutActions, useShortcutLabel } from '../useShortcuts'
import { useMotionEnabled } from '../motion'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { isTauri } from '@tauri-apps/api/core'
import {
  PanelLeft,
  PanelLeftClose,
  Plus,
  Search,
  X,
  ArrowLeft,
  ArrowRight,
  List,
  FileText,
  ExternalLink,
  MoreHorizontal,
} from '../icons'
import type { Appearance, Note, Notebook } from '../model'
import { fontFamily } from '../fonts'

export function searchNotes(notes: Note[], query: string): Note[] {
  const term = query.trim().toLocaleLowerCase()
  if (!term) return []
  return notes
    .filter(
      (note) => !note.trashed && `${note.title}\n${note.text}`.toLocaleLowerCase().includes(term),
    )
    .sort((a, b) => b.updated - a.updated || a.id.localeCompare(b.id))
}

export default function TitleBar({
  notes,
  notebooks,
  appearance,
  sidebarVisible,
  disabled,
  onToggleSidebar,
  onNewNote,
  onSelect,
  tabs = [],
  activeTabId,
  onSelectTab,
  onCloseTab,
  onKeepOpenTab,
  canBack = false,
  canForward = false,
  onBack,
  onForward,
  noteLoaded = false,
  contentsOpen = false,
  onToggleContents,
  findOpen = false,
  onToggleFind,
  noteMenu,
}: {
  notes: Note[]
  notebooks: Notebook[]
  appearance: Appearance
  sidebarVisible: boolean
  disabled: boolean
  onToggleSidebar: () => void
  onNewNote: () => void
  onSelect: (id: string, newTab?: boolean) => void
  tabs?: { id: string; noteId: string; preview?: boolean }[]
  activeTabId?: string | null
  onSelectTab?: (id: string) => void
  onCloseTab?: (id: string) => void
  onKeepOpenTab?: (id: string) => void
  canBack?: boolean
  canForward?: boolean
  onBack?: () => void
  onForward?: () => void
  noteLoaded?: boolean
  contentsOpen?: boolean
  onToggleContents?: () => void
  findOpen?: boolean
  onToggleFind?: () => void
  noteMenu?: ReactNode
}) {
  const motionActive = useMotionEnabled()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const trigger = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  const native = isTauri()
  const results = searchNotes(notes, query)
  const selectedIndex = Math.min(index, Math.max(0, results.length - 1))
  const selected = results[selectedIndex]
  const changeOpen = (value: boolean) => {
    setOpen(value)
    if (!value) {
      setQuery('')
      setIndex(0)
    }
  }
  const shortcutLabel = useShortcutLabel()
  useShortcutActions({ search: () => setOpen(true) }, disabled)
  useEffect(() => {
    document.getElementById(`${listId}-${selectedIndex}`)?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex, query, listId])
  useEffect(() => {
    document
      .querySelector('.note-tab.active')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeTabId, tabs.length])
  const choose = (note: Note, newTab = false) => {
    if (disabled) return
    changeOpen(false)
    if (newTab) onSelect(note.id, true)
    else onSelect(note.id)
  }
  return (
    <header className={`title-bar ${native ? 'native-title-bar' : ''}`} data-tauri-drag-region>
      <div className="title-bar-left" data-tauri-drag-region>
        <button
          className="icon-button"
          disabled={disabled}
          onClick={onToggleSidebar}
          aria-label={sidebarVisible ? 'Hide sidebar' : 'Show sidebar'}
          title={`${sidebarVisible ? 'Hide sidebar' : 'Show sidebar'} (${shortcutLabel('sidebar')})`}
        >
          {sidebarVisible ? <PanelLeftClose size={17} /> : <PanelLeft size={17} />}
        </button>
      </div>
      <div className="title-bar-search">
        <Dialog.Root open={open} onOpenChange={changeOpen}>
          <Dialog.Trigger asChild>
            <button
              ref={trigger}
              className="global-search-trigger"
              disabled={disabled}
              aria-label="Search all notes"
            >
              <Search size={15} />
              <span>Search all notes…</span>
              <kbd>{shortcutLabel('search')}</kbd>
            </button>
          </Dialog.Trigger>
          {(open || motionActive) && (
            <Dialog.Portal>
              <Dialog.Overlay className="dialog-overlay" />
              <Dialog.Content
                inert={!open}
                className="global-search-dialog"
                data-theme={appearance.dark ? 'dark' : 'light'}
                data-palette={appearance.theme}
                style={{ fontFamily: fontFamily(appearance.uiFont) }}
                onOpenAutoFocus={(event) => {
                  event.preventDefault()
                  inputRef.current?.focus()
                }}
                onCloseAutoFocus={(event) => {
                  event.preventDefault()
                  trigger.current?.focus()
                }}
              >
                <Dialog.Title>Search all notes</Dialog.Title>
                <Dialog.Description className="muted">
                  Search titles and note text across your notebooks.
                </Dialog.Description>
                <Dialog.Close className="icon-button global-search-close" aria-label="Close search">
                  <X size={18} />
                </Dialog.Close>
                <input
                  ref={inputRef}
                  className="global-search-input text-field"
                  aria-label="Search all notes"
                  placeholder="Search all notes…"
                  role="combobox"
                  aria-expanded="true"
                  aria-controls={listId}
                  aria-autocomplete="list"
                  aria-activedescendant={selected ? `${listId}-${selectedIndex}` : undefined}
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value)
                    setIndex(0)
                  }}
                  onKeyDown={(event) => {
                    if (event.nativeEvent.isComposing) return
                    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                      event.preventDefault()
                      if (results.length)
                        setIndex(
                          (selectedIndex + (event.key === 'ArrowDown' ? 1 : -1) + results.length) %
                            results.length,
                        )
                    } else if (event.key === 'Enter' && selected) {
                      event.preventDefault()
                      choose(selected)
                    }
                  }}
                />
                <div
                  className="global-search-results"
                  id={listId}
                  role="listbox"
                  aria-label="Matching notes"
                >
                  {results.map((note, i) => (
                    <div
                      key={note.id}
                      id={`${listId}-${i}`}
                      role="option"
                      aria-selected={i === selectedIndex}
                      className="global-search-result"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={(event) => choose(note, event.metaKey || event.ctrlKey)}
                    >
                      <strong>{note.title || 'Untitled note'}</strong>
                      <small>
                        {notebooks
                          .filter((book) => note.notebookIds.includes(book.id))
                          .map((book) => book.name)
                          .join(', ') || 'Uncategorized'}
                      </small>
                      <p>{note.text.replace(/\s+/g, ' ').slice(0, 160) || 'Empty note'}</p>
                      <button
                        className="icon-button search-new-tab"
                        aria-label={`Open ${note.title || 'Untitled note'} in new tab`}
                        onClick={(event) => {
                          event.stopPropagation()
                          choose(note, true)
                        }}
                      >
                        <ExternalLink size={14} />
                      </button>
                    </div>
                  ))}
                </div>
                {!results.length && (
                  <p className="global-search-empty" role="status">
                    {query.trim() ? 'No notes found.' : 'Type to search your notes.'}
                  </p>
                )}
              </Dialog.Content>
            </Dialog.Portal>
          )}
        </Dialog.Root>
      </div>
      <div className="title-bar-editor" data-tauri-drag-region>
        <div className="title-navigation">
          <button
            className="icon-button new-note-button"
            title={`New note (${shortcutLabel('new-note')})`}
            aria-label="New note"
            disabled={disabled}
            onClick={onNewNote}
          >
            <Plus size={19} />
          </button>
          <button
            className="icon-button"
            title={`Back to previous note (${shortcutLabel('back')})`}
            aria-label="Back to previous note"
            disabled={disabled || !canBack}
            onClick={onBack}
          >
            <ArrowLeft size={16} />
          </button>
          <button
            className="icon-button"
            title={`Forward to next note (${shortcutLabel('forward')})`}
            aria-label="Forward to next note"
            disabled={disabled || !canForward}
            onClick={onForward}
          >
            <ArrowRight size={16} />
          </button>
        </div>
        <div
          className="note-tabs"
          data-tauri-drag-region
          role="tablist"
          aria-label="Open notes"
          onKeyDown={(event) => {
            const index = tabs.findIndex((t) => t.id === activeTabId)
            let target: number | undefined
            if (event.key === 'ArrowRight') target = (index + 1) % tabs.length
            if (event.key === 'ArrowLeft') target = (index - 1 + tabs.length) % tabs.length
            if (event.key === 'Home') target = 0
            if (event.key === 'End') target = tabs.length - 1
            if (target !== undefined && tabs[target]) {
              event.preventDefault()
              onSelectTab?.(tabs[target].id)
              event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')[target]?.focus()
            }
          }}
        >
          {tabs.map((tab) => {
            const title = notes.find((n) => n.id === tab.noteId)?.title || 'Untitled note'
            return (
              <div
                className={`note-tab ${activeTabId === tab.id ? 'active' : ''} ${tab.preview ? 'preview' : ''}`}
                key={tab.id}
              >
                <button
                  role="tab"
                  aria-selected={activeTabId === tab.id}
                  tabIndex={activeTabId === tab.id ? 0 : -1}
                  disabled={disabled}
                  title={tab.preview ? `${title} - Preview (double-click to keep open)` : title}
                  onClick={() => onSelectTab?.(tab.id)}
                  onDoubleClick={() => onKeepOpenTab?.(tab.id)}
                  onKeyDown={(event) => {
                    if (tab.preview && activeTabId === tab.id && event.key === 'Enter') {
                      event.preventDefault()
                      onKeepOpenTab?.(tab.id)
                    }
                  }}
                >
                  <FileText size={14} />
                  <span>{title}</span>
                </button>
                <button
                  className="tab-close"
                  disabled={disabled}
                  aria-label={`Close ${title}`}
                  title={`Close ${title} (${shortcutLabel('close-tab')})`}
                  onClick={() => {
                    onCloseTab?.(tab.id)
                    requestAnimationFrame(() =>
                      (
                        document.querySelector<HTMLElement>('.note-tabs [aria-selected="true"]') ??
                        document.querySelector<HTMLElement>('[aria-label="New note"]')
                      )?.focus(),
                    )
                  }}
                >
                  <X size={13} />
                </button>
              </div>
            )
          })}
        </div>
        <div className="title-bar-right" data-tauri-drag-region>
          <button
            className="icon-button"
            aria-label="Table of contents"
            title={`Table of contents (${shortcutLabel('contents')})`}
            aria-pressed={contentsOpen}
            disabled={disabled || !noteLoaded}
            onClick={onToggleContents}
          >
            <List size={18} />
          </button>
          <button
            className="icon-button"
            aria-label="Find in note"
            title={`Find in note (${shortcutLabel('find')})`}
            aria-pressed={findOpen}
            disabled={disabled || !noteLoaded}
            onClick={onToggleFind}
          >
            <Search size={17} />
          </button>
          {noteMenu || (
            <button className="icon-button" aria-label="Note actions" disabled>
              <MoreHorizontal size={21} />
            </button>
          )}
        </div>
      </div>
    </header>
  )
}
