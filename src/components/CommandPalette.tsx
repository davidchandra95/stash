import AppTooltip from './AppTooltip'
import { useContext, useEffect, useId, useMemo, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { isTauri } from '@tauri-apps/api/core'
import type { Note, Notebook } from '../model'
import { FileText, Search, type IconComponent } from '../icons'
import { useMotionEnabled } from '../motion'
import { ShortcutContext } from '../useShortcuts'
import { bindingFor, matchesBinding } from '../shortcuts'
import { useContentSearch } from '../useContentSearch'
import { useContentMatches } from '../useContentMatches'
import ContentSearchResults, { resultId } from './ContentSearchResults'
import {
  ContentResultIndex,
  matchAnchor,
  type MatchAnchor,
  type ResultRow,
} from '../search/contentResults'
import {
  commandResults,
  notebookContext,
  quickOpenResults,
  quickTitleParts,
  type MatchNavigation,
  type ReadSearchNote,
  type TitleRange,
} from '../search'

export type PaletteCommand = {
  id: string
  label: string
  /** Extra words that find the command without being shown. */
  keywords?: string
  /** Display-only binding such as ⌘N. */
  shortcut?: string
  icon?: IconComponent
  disabled?: boolean
  /** Marks the current choice, such as the active theme. */
  checked?: boolean
  run: () => void
}
export type PaletteScope = 'titles' | 'bodies'

const COMMAND_PREFIX = '>'

function Highlighted({ text, ranges }: { text: string; ranges: TitleRange[] }) {
  return quickTitleParts(text, ranges).map((part, i) =>
    part.matched ? (
      <mark key={i} className="palette-match">
        {part.text}
      </mark>
    ) : (
      part.text
    ),
  )
}

export default function CommandPalette({
  open,
  onOpenChange,
  initialScope = 'titles',
  initialQuery = '',
  notes,
  notebooks,
  disabled,
  recentNoteIds,
  commands,
  readNote,
  onSelect,
  onSelectMatch,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialScope?: PaletteScope
  initialQuery?: string
  notes: Note[]
  notebooks: Notebook[]
  disabled: boolean
  recentNoteIds: string[]
  commands: PaletteCommand[]
  readNote: ReadSearchNote
  onSelect: (id: string, newTab?: boolean) => void
  onSelectMatch: (request: MatchNavigation, newTab?: boolean) => void
}) {
  const [text, setText] = useState(''),
    [scope, setScope] = useState<PaletteScope>('titles'),
    [index, setIndex] = useState(0),
    [selection, setSelection] = useState<{ anchor: MatchAnchor | null; index: number }>({
      anchor: null,
      index: 0,
    })
  const input = useRef<HTMLInputElement>(null),
    skipFocusReturn = useRef(false),
    returnFocus = useRef<HTMLElement | null>(null),
    listId = useId()
  const overrides = useContext(ShortcutContext)
  const motionActive = useMotionEnabled()
  const commandMode = text.startsWith(COMMAND_PREFIX)
  const mode = commandMode ? 'commands' : scope
  const query = commandMode ? text.slice(COMMAND_PREFIX.length) : text

  const titleMatches = useMemo(
    () => (open && mode === 'titles' ? quickOpenResults(notes, query, recentNoteIds) : []),
    [open, mode, notes, query, recentNoteIds],
  )
  const commandMatches = useMemo(
    () => (open && mode === 'commands' ? commandResults(commands, query) : []),
    [open, mode, commands, query],
  )
  const bodies = open && mode === 'bodies'
  const { documents, loading, failures, read, total } = useContentSearch(bodies, notes, readNote)
  const { groups, searching, failure } = useContentMatches(bodies, documents, query, notes)
  const contentIndex = useMemo(() => new ContentResultIndex(groups), [groups])
  const busy = loading || searching

  const listLength = mode === 'titles' ? titleMatches.length : commandMatches.length
  const selectedIndex = Math.min(index, Math.max(0, listLength - 1))
  const contentSelected =
    (selection.anchor ? contentIndex.locate(selection.anchor) : undefined) ??
    Math.min(selection.index, Math.max(0, contentIndex.matches - 1))
  const selectedRow = contentIndex.match(contentSelected)

  useEffect(() => {
    if (!open) return
    returnFocus.current = document.activeElement as HTMLElement | null
    setText(initialQuery)
    setScope(initialScope)
    setIndex(0)
    setSelection({ anchor: null, index: 0 })
  }, [open, initialScope, initialQuery])
  useEffect(() => {
    if (!selectedRow?.match) return
    const anchor = matchAnchor(selectedRow.group, selectedRow.match)
    setSelection((current) =>
      current.index === contentSelected &&
      current.anchor?.doc === anchor.doc &&
      current.anchor.noteId === anchor.noteId &&
      current.anchor.from === anchor.from &&
      current.anchor.offset === anchor.offset &&
      current.anchor.text === anchor.text
        ? current
        : { anchor, index: contentSelected },
    )
  }, [contentSelected, contentIndex, selectedRow])
  useEffect(() => {
    if (open && mode !== 'bodies')
      document.getElementById(`${listId}-${selectedIndex}`)?.scrollIntoView({ block: 'nearest' })
  }, [open, mode, listId, selectedIndex, query])

  const close = (restoreFocus = true) => {
    skipFocusReturn.current = !restoreFocus
    onOpenChange(false)
  }
  const chooseNote = (note: Note, newTab = false) => {
    if (disabled) return
    close(false)
    onSelect(note.id, newTab || undefined)
  }
  const chooseCommand = (command: PaletteCommand) => {
    if (disabled || command.disabled) return
    close(false)
    // Let the dialog release focus before the command moves it elsewhere.
    window.setTimeout(command.run, 0)
  }
  const chooseMatch = (row: ResultRow, newTab = false) => {
    if (disabled || !row.match) return
    close(false)
    onSelectMatch(
      { noteId: row.group.note.id, query: query.trim(), doc: row.group.doc, match: row.match },
      newTab,
    )
  }
  const switchScope = (next: PaletteScope) => {
    setScope(next)
    setIndex(0)
    setSelection({ anchor: null, index: 0 })
    if (commandMode) setText(query)
    input.current?.focus()
  }
  const move = (direction: 1 | -1) => {
    if (mode === 'bodies') {
      if (!contentIndex.matches) return
      const next = (contentSelected + direction + contentIndex.matches) % contentIndex.matches
      const row = contentIndex.match(next)!
      setSelection({ anchor: matchAnchor(row.group, row.match!), index: next })
    } else if (listLength) setIndex((selectedIndex + direction + listLength) % listLength)
  }

  const placeholder =
    mode === 'commands'
      ? 'Run a command…'
      : mode === 'bodies'
        ? 'Search note bodies…'
        : 'Find note titles… or type > for commands'
  const label =
    mode === 'commands'
      ? 'Run a command'
      : mode === 'bodies'
        ? 'Search note bodies'
        : 'Find note titles'
  const activeDescendant =
    mode === 'bodies'
      ? selectedRow
        ? resultId(listId, selectedRow)
        : undefined
      : listLength
        ? `${listId}-${selectedIndex}`
        : undefined

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {(open || motionActive) && (
        <Dialog.Portal>
          <Dialog.Overlay className="palette-overlay" />
          <Dialog.Content
            inert={!open}
            className="palette"
            aria-describedby={`${listId}-description`}
            onOpenAutoFocus={(event) => {
              event.preventDefault()
              skipFocusReturn.current = false
              input.current?.focus()
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              if (!skipFocusReturn.current && returnFocus.current?.isConnected)
                returnFocus.current.focus()
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return
              const native = event.nativeEvent
              if (matchesBinding(native, bindingFor('quick-open', overrides), isTauri())) {
                event.preventDefault()
                event.stopPropagation()
                if (mode !== 'titles') switchScope('titles')
              } else if (matchesBinding(native, bindingFor('search', overrides), isTauri())) {
                event.preventDefault()
                event.stopPropagation()
                if (mode !== 'bodies') switchScope('bodies')
              }
            }}
          >
            <Dialog.Title className="sr-only">Search and commands</Dialog.Title>
            <Dialog.Description className="sr-only" id={`${listId}-description`}>
              Type to find note titles. Press Tab for note text, or type &gt; to run a command.
              Excludes Trash.
            </Dialog.Description>
            <div className="palette-input">
              <Search aria-hidden="true" />
              <input
                ref={input}
                aria-label={label}
                placeholder={placeholder}
                role="combobox"
                aria-expanded="true"
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={activeDescendant}
                disabled={disabled}
                value={text}
                spellCheck={false}
                onChange={(event) => {
                  setText(event.target.value)
                  setIndex(0)
                  setSelection({ anchor: null, index: 0 })
                }}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return
                  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault()
                    move(event.key === 'ArrowDown' ? 1 : -1)
                  } else if (event.key === 'Tab') {
                    event.preventDefault()
                    event.stopPropagation() // keep the dialog focus trap from moving focus
                    if (!commandMode) switchScope(scope === 'titles' ? 'bodies' : 'titles')
                  } else if (event.key === 'Backspace' && text === '' && scope === 'bodies') {
                    switchScope('titles')
                  } else if (event.key === 'Enter') {
                    event.preventDefault()
                    const newTab = event.metaKey || event.ctrlKey
                    if (mode === 'titles') {
                      const result = titleMatches[selectedIndex]
                      if (result) chooseNote(result.note, newTab)
                    } else if (mode === 'commands') {
                      const result = commandMatches[selectedIndex]
                      if (result) chooseCommand(result.command)
                    } else if (selectedRow) chooseMatch(selectedRow, newTab)
                  }
                }}
              />
              {mode !== 'commands' && (
                <div className="segmented" role="group" aria-label="Search scope">
                  <button
                    type="button"
                    aria-pressed={mode === 'titles'}
                    tabIndex={-1}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => switchScope('titles')}
                  >
                    Titles
                  </button>
                  <button
                    type="button"
                    aria-pressed={mode === 'bodies'}
                    tabIndex={-1}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => switchScope('bodies')}
                  >
                    Note text
                  </button>
                </div>
              )}
            </div>
            <div className="palette-body">
              {mode === 'titles' && (
                <>
                  {!query.trim() && !!titleMatches.length && (
                    <p className="palette-heading" id={`${listId}-heading`}>
                      Recent
                    </p>
                  )}
                  <div id={listId} role="listbox" aria-label="Matching note titles">
                    {titleMatches.map(({ note, ranges }, i) => {
                      const title = note.title || 'Untitled note',
                        context = notebookContext(note, notebooks)
                      return (
                        <div
                          key={note.id}
                          id={`${listId}-${i}`}
                          role="option"
                          aria-selected={i === selectedIndex}
                          aria-label={`${title}, ${context}`}
                          className="palette-row"
                          onMouseDown={(event) => event.preventDefault()}
                          onMouseMove={() => i !== selectedIndex && setIndex(i)}
                          onClick={(event) => chooseNote(note, event.metaKey || event.ctrlKey)}
                        >
                          <FileText aria-hidden="true" />
                          <AppTooltip label={title}>
                            <span className="palette-label">
                              <Highlighted text={title} ranges={ranges} />
                            </span>
                          </AppTooltip>
                          <AppTooltip label={context}>
                            <span className="palette-context">{context}</span>
                          </AppTooltip>
                        </div>
                      )
                    })}
                  </div>
                  {!titleMatches.length && (
                    <p className="palette-empty" role="status">
                      {query.trim()
                        ? 'No matching titles. Press Tab to search note text.'
                        : 'No recent notes. Type to find a title.'}
                    </p>
                  )}
                </>
              )}
              {mode === 'commands' && (
                <>
                  <div id={listId} role="listbox" aria-label="Commands">
                    {commandMatches.map(({ command, ranges }, i) => {
                      const Icon = command.icon
                      return (
                        <div
                          key={command.id}
                          id={`${listId}-${i}`}
                          role="option"
                          aria-selected={i === selectedIndex}
                          aria-disabled={command.disabled || undefined}
                          aria-checked={command.checked}
                          className="palette-row"
                          onMouseDown={(event) => event.preventDefault()}
                          onMouseMove={() => i !== selectedIndex && setIndex(i)}
                          onClick={() => chooseCommand(command)}
                        >
                          {Icon ? <Icon aria-hidden="true" /> : <span className="ui-icon" />}
                          <span className="palette-label">
                            <Highlighted text={command.label} ranges={ranges} />
                          </span>
                          {command.checked && <span className="palette-context">Current</span>}
                          {command.shortcut && <kbd>{command.shortcut}</kbd>}
                        </div>
                      )
                    })}
                  </div>
                  {!commandMatches.length && (
                    <p className="palette-empty" role="status">
                      No matching commands.
                    </p>
                  )}
                </>
              )}
              {mode === 'bodies' && (
                <>
                  <p className="palette-heading" role="status">
                    {query.trim()
                      ? `${contentIndex.matches} ${contentIndex.matches === 1 ? 'match' : 'matches'} in ${groups.length} ${groups.length === 1 ? 'note' : 'notes'}${busy ? ` · Searching… (${read} of ${total} notes read)` : ''}`
                      : loading
                        ? `Reading notes… (${read} of ${total})`
                        : 'Type to search the text of every note.'}
                  </p>
                  {(!!failures.length || !!failure) && (
                    <div className="palette-errors" role="status">
                      <p>Some notes could not be searched. Results may be incomplete.</p>
                      {failure && <p>Search could not finish: {failure}</p>}
                      {!!failures.length && (
                        <details>
                          <summary>
                            {failures.length} unreadable {failures.length === 1 ? 'note' : 'notes'}
                          </summary>
                          {failures.map((error) => (
                            <p key={error}>{error}</p>
                          ))}
                        </details>
                      )}
                    </div>
                  )}
                  <ContentSearchResults
                    key={query.trim()}
                    index={contentIndex}
                    selectedIndex={contentSelected}
                    listId={listId}
                    query={query.trim()}
                    notebooks={notebooks}
                    busy={busy}
                    onChoose={chooseMatch}
                  />
                  {!busy && !failure && !!query.trim() && !contentIndex.matches && (
                    <p className="palette-empty">No matches found.</p>
                  )}
                </>
              )}
            </div>
            <div className="palette-footer" aria-hidden="true">
              <span>
                <kbd>↵</kbd> Open
              </span>
              {mode !== 'commands' && (
                <span>
                  <kbd>{isTauri() ? '⌘↵' : 'Ctrl+↵'}</kbd> New tab
                </span>
              )}
              {mode !== 'commands' && (
                <span>
                  <kbd>⇥</kbd> {mode === 'titles' ? 'Search note text' : 'Search titles'}
                </span>
              )}
              <span className="spacer" />
              <span>
                <kbd>&gt;</kbd> Commands
              </span>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      )}
    </Dialog.Root>
  )
}
