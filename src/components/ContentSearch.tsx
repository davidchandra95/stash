import AppTooltip from './AppTooltip'
import { useContext, useEffect, useId, useMemo, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { isTauri } from '@tauri-apps/api/core'
import type { Appearance, Note, Notebook } from '../model'
import { FileSearch, X } from '../icons'
import { fontFamily } from '../fonts'
import { useMotionEnabled } from '../motion'
import { ShortcutContext, useShortcutLabel } from '../useShortcuts'
import { bindingFor, matchesBinding } from '../shortcuts'
import { useContentSearch } from '../useContentSearch'
import {
  matchSnippet,
  notebookContext,
  searchContent,
  type MatchNavigation,
  type ReadSearchNote,
} from '../search'

export default function ContentSearch({
  open,
  onOpenChange,
  onQuickOpen,
  notes,
  notebooks,
  appearance,
  disabled,
  readNote,
  onSelectMatch,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onQuickOpen: () => void
  notes: Note[]
  notebooks: Notebook[]
  appearance: Appearance
  disabled: boolean
  readNote: ReadSearchNote
  onSelectMatch: (request: MatchNavigation, newTab?: boolean) => void
}) {
  const [query, setQuery] = useState(''),
    [index, setIndex] = useState(0)
  const trigger = useRef<HTMLButtonElement>(null),
    input = useRef<HTMLInputElement>(null)
  const skipFocusReturn = useRef(false),
    listId = useId()
  const shortcutLabel = useShortcutLabel(),
    overrides = useContext(ShortcutContext)
  const motionActive = useMotionEnabled()
  const { documents, loading, failures } = useContentSearch(open, notes, readNote)
  const groups = useMemo(() => searchContent(documents, query, notes), [documents, query, notes])
  const rows = groups.flatMap((group) => group.matches.map((match) => ({ group, match })))
  const selectedIndex = Math.min(index, Math.max(0, rows.length - 1)),
    selected = rows[selectedIndex]
  useEffect(() => {
    if (!open) {
      setQuery('')
      setIndex(0)
    }
  }, [open])
  useEffect(() => {
    if (open)
      document.getElementById(`${listId}-${selectedIndex}`)?.scrollIntoView({ block: 'nearest' })
  }, [open, selectedIndex, listId, query])
  const choose = (row: (typeof rows)[number], newTab = false) => {
    if (disabled) return
    skipFocusReturn.current = true
    onOpenChange(false)
    onSelectMatch(
      { noteId: row.group.note.id, query: query.trim(), doc: row.group.doc, match: row.match },
      newTab,
    )
  }
  let rowIndex = 0
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AppTooltip
        instant
        label="Search note content"
        shortcut={shortcutLabel('search')}
        disabled={disabled}
      >
        <Dialog.Trigger asChild>
          <button
            ref={trigger}
            className="icon-button content-search-trigger"
            disabled={disabled}
            aria-label="Search note content"
          >
            <FileSearch size={16} />
          </button>
        </Dialog.Trigger>
      </AppTooltip>
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
              skipFocusReturn.current = false
              input.current?.focus()
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              if (!skipFocusReturn.current) trigger.current?.focus()
            }}
            onKeyDown={(event) => {
              if (
                !event.nativeEvent.isComposing &&
                matchesBinding(event.nativeEvent, bindingFor('quick-open', overrides), isTauri())
              ) {
                event.preventDefault()
                event.stopPropagation()
                skipFocusReturn.current = true
                onQuickOpen()
              }
            }}
          >
            <Dialog.Title>Search note content</Dialog.Title>
            <Dialog.Description className="global-search-description muted">
              Search note text across your notebooks.
            </Dialog.Description>
            <Dialog.Close className="icon-button global-search-close" aria-label="Close search">
              <X size={18} />
            </Dialog.Close>
            <input
              ref={input}
              className="global-search-input text-field"
              aria-label="Search note content"
              placeholder="Search note content…"
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={selected ? `${listId}-${selectedIndex}` : undefined}
              disabled={disabled}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setIndex(0)
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault()
                  if (rows.length)
                    setIndex(
                      (selectedIndex + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) %
                        rows.length,
                    )
                } else if (event.key === 'Enter' && selected) {
                  event.preventDefault()
                  choose(selected, event.metaKey || event.ctrlKey)
                }
              }}
            />
            <p className="content-search-status muted" role="status">
              {loading
                ? 'Reading notes…'
                : query.trim()
                  ? `${rows.length} ${rows.length === 1 ? 'match' : 'matches'} in ${groups.length} ${groups.length === 1 ? 'note' : 'notes'}`
                  : 'Type to search note content.'}
            </p>
            {!!failures.length && (
              <div className="content-search-errors" role="status">
                <p>Some notes could not be searched. Results may be incomplete.</p>
                <details>
                  <summary>
                    {failures.length} unreadable {failures.length === 1 ? 'note' : 'notes'}
                  </summary>
                  {failures.map((error) => (
                    <p key={error}>{error}</p>
                  ))}
                </details>
              </div>
            )}
            <div
              className="global-search-results"
              id={listId}
              role="listbox"
              aria-label="Matching content"
              aria-busy={loading}
            >
              {groups.map((group) => (
                <div
                  key={group.note.id}
                  className="content-search-group"
                  role="group"
                  aria-label={`${group.note.title || 'Untitled note'}, ${group.matches.length} matches`}
                >
                  <div className="content-search-heading">
                    <strong>{group.note.title || 'Untitled note'}</strong>
                    <small>{notebookContext(group.note, notebooks)}</small>
                    <span>{group.matches.length}</span>
                  </div>
                  {group.matches.map((match) => {
                    const i = rowIndex++
                    return (
                      <div
                        key={`${match.from}-${match.offset}`}
                        id={`${listId}-${i}`}
                        className="global-search-result content-search-match"
                        role="option"
                        aria-selected={i === selectedIndex}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={(event) =>
                          choose({ group, match }, event.metaKey || event.ctrlKey)
                        }
                      >
                        {matchSnippet(match, query.trim()).map((part, j) =>
                          part.highlighted ? (
                            <mark key={j} className={part.target ? 'target-match' : undefined}>
                              {part.text}
                            </mark>
                          ) : (
                            <span key={j}>{part.text}</span>
                          ),
                        )}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
            {!loading && !!query.trim() && !rows.length && (
              <p className="global-search-empty">No matches found.</p>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      )}
    </Dialog.Root>
  )
}
