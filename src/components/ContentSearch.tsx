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
import { useContentMatches } from '../useContentMatches'
import ContentSearchResults, { resultId } from './ContentSearchResults'
import {
  ContentResultIndex,
  matchAnchor,
  type MatchAnchor,
  type ResultRow,
} from '../search/contentResults'
import { type MatchNavigation, type ReadSearchNote } from '../search'

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
  initialQuery = '',
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
  initialQuery?: string
}) {
  const [query, setQuery] = useState(''),
    [selection, setSelection] = useState<{ anchor: MatchAnchor | null; index: number }>({
      anchor: null,
      index: 0,
    })
  const trigger = useRef<HTMLButtonElement>(null),
    input = useRef<HTMLInputElement>(null)
  const skipFocusReturn = useRef(false),
    listId = useId()
  const shortcutLabel = useShortcutLabel(),
    overrides = useContext(ShortcutContext)
  const motionActive = useMotionEnabled()
  const { documents, loading, failures, read, total } = useContentSearch(open, notes, readNote)
  const { groups, searching, failure } = useContentMatches(open, documents, query, notes)
  const index = useMemo(() => new ContentResultIndex(groups), [groups])
  const selectedIndex =
    (selection.anchor ? index.locate(selection.anchor) : undefined) ??
    Math.min(selection.index, Math.max(0, index.matches - 1))
  const selected = index.match(selectedIndex)
  const busy = loading || searching
  useEffect(() => {
    setQuery(open ? initialQuery : '')
    setSelection({ anchor: null, index: 0 })
  }, [open, initialQuery])
  useEffect(() => {
    if (!selected?.match) return
    const anchor = matchAnchor(selected.group, selected.match)
    setSelection((current) =>
      current.index === selectedIndex &&
      current.anchor?.doc === anchor.doc &&
      current.anchor.noteId === anchor.noteId &&
      current.anchor.from === anchor.from &&
      current.anchor.offset === anchor.offset &&
      current.anchor.text === anchor.text
        ? current
        : { anchor, index: selectedIndex },
    )
  }, [selectedIndex, index])
  const choose = (row: ResultRow, newTab = false) => {
    if (disabled || !row.match) return
    skipFocusReturn.current = true
    onOpenChange(false)
    onSelectMatch(
      { noteId: row.group.note.id, query: query.trim(), doc: row.group.doc, match: row.match },
      newTab,
    )
  }
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AppTooltip
        instant
        label="Search note bodies across all notebooks"
        shortcut={shortcutLabel('search')}
        disabled={disabled}
      >
        <Dialog.Trigger asChild>
          <button
            ref={trigger}
            className="icon-button content-search-trigger"
            disabled={disabled}
            aria-label="Search note bodies"
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
            <Dialog.Title>Search note bodies</Dialog.Title>
            <Dialog.Description className="global-search-description muted">
              Search body text across all notebooks. Excludes Trash. Use Find note titles for
              titles.
            </Dialog.Description>
            <Dialog.Close className="icon-button global-search-close" aria-label="Close search">
              <X size={18} />
            </Dialog.Close>
            <input
              ref={input}
              className="global-search-input text-field"
              aria-label="Search note bodies"
              placeholder="Search note bodies…"
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={selected ? resultId(listId, selected) : undefined}
              disabled={disabled}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setSelection({ anchor: null, index: 0 })
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault()
                  if (index.matches) {
                    const next =
                      (selectedIndex + (event.key === 'ArrowDown' ? 1 : -1) + index.matches) %
                      index.matches
                    const row = index.match(next)!
                    setSelection({ anchor: matchAnchor(row.group, row.match!), index: next })
                  }
                } else if (event.key === 'Enter' && selected) {
                  event.preventDefault()
                  choose(selected, event.metaKey || event.ctrlKey)
                }
              }}
            />
            <p className="content-search-status muted" role="status">
              {query.trim()
                ? `${index.matches} ${index.matches === 1 ? 'match' : 'matches'} in ${groups.length} ${groups.length === 1 ? 'note' : 'notes'}${busy ? ` · Searching… (${read} of ${total} notes read)` : ''}`
                : loading
                  ? `Reading notes… (${read} of ${total})`
                  : 'Type to search note bodies.'}
            </p>
            {(!!failures.length || !!failure) && (
              <div className="content-search-errors" role="status">
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
              index={index}
              selectedIndex={selectedIndex}
              listId={listId}
              query={query.trim()}
              notebooks={notebooks}
              busy={busy}
              onChoose={choose}
            />
            {!busy && !failure && !!query.trim() && !index.matches && (
              <p className="global-search-empty">No matches found.</p>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      )}
    </Dialog.Root>
  )
}
