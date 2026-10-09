import AppTooltip from './AppTooltip'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import type { Appearance, Note, Notebook } from '../model'
import { Search, FileText, FileSearch } from '../icons'
import { fontFamily } from '../fonts'
import { notebookContext, quickOpenResults, quickTitleParts } from '../search'
import { useShortcutLabel } from '../useShortcuts'

export default function QuickOpen({
  open,
  onOpenChange,
  notes,
  notebooks,
  recentNoteIds,
  appearance,
  disabled,
  onSelect,
  onSearchContent,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  notes: Note[]
  notebooks: Notebook[]
  recentNoteIds: string[]
  appearance: Appearance
  disabled: boolean
  onSelect: (id: string, newTab?: boolean) => void
  onSearchContent: (query: string) => void
}) {
  const [query, setQuery] = useState(''),
    [index, setIndex] = useState(0)
  const input = useRef<HTMLInputElement>(null),
    contentAction = useRef<HTMLButtonElement>(null),
    listId = useId()
  const shortcutLabel = useShortcutLabel()
  const results = useMemo(
    () => quickOpenResults(notes, query, recentNoteIds),
    [notes, query, recentNoteIds],
  )
  const selectedIndex = Math.min(index, Math.max(0, results.length - 1)),
    selected = results[selectedIndex]
  useEffect(() => {
    if (open) input.current?.focus()
    else {
      setQuery('')
      setIndex(0)
    }
  }, [open])
  useEffect(() => {
    if (open)
      document.getElementById(`${listId}-${selectedIndex}`)?.scrollIntoView({ block: 'nearest' })
  }, [open, listId, selectedIndex, query])
  const choose = (note: Note, newTab = false) => {
    if (disabled) return
    onOpenChange(false)
    onSelect(note.id, newTab || undefined)
  }
  return (
    <Popover.Root open={open && !disabled} onOpenChange={onOpenChange} modal={false}>
      <Popover.Anchor asChild>
        <div className="quick-open-shell text-field-shell">
          <Search size={15} aria-hidden="true" />
          <input
            ref={input}
            className="text-field"
            aria-label="Find note titles"
            aria-description="Find note titles across all notebooks. Excludes Trash."
            placeholder="Find note titles…"
            role="combobox"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-autocomplete="list"
            aria-activedescendant={open && selected ? `${listId}-${selectedIndex}` : undefined}
            disabled={disabled}
            value={query}
            onFocus={() => onOpenChange(true)}
            onClick={() => onOpenChange(true)}
            onChange={(event) => {
              setQuery(event.target.value)
              setIndex(0)
              onOpenChange(true)
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return
              if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                onOpenChange(false)
              }
              if (open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
                event.preventDefault()
                if (results.length)
                  setIndex(
                    (selectedIndex + (event.key === 'ArrowDown' ? 1 : -1) + results.length) %
                      results.length,
                  )
              }
              if (open && event.key === 'Enter' && selected) {
                event.preventDefault()
                choose(selected.note, event.metaKey || event.ctrlKey)
              }
              if (event.key === 'Tab') {
                if (open && !event.shiftKey) {
                  event.preventDefault()
                  contentAction.current?.focus()
                } else onOpenChange(false)
              }
            }}
          />
          <kbd>{shortcutLabel('quick-open')}</kbd>
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          role="presentation"
          className="quick-open-popup"
          side="bottom"
          align="start"
          sideOffset={4}
          data-theme={appearance.dark ? 'dark' : 'light'}
          data-palette={appearance.theme}
          style={{ fontFamily: fontFamily(appearance.uiFont) }}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            if (input.current?.parentElement?.contains(event.target as Node)) event.preventDefault()
          }}
        >
          <p className="quick-open-heading">Titles across all notebooks · Excludes Trash</p>
          {!query.trim() && <p className="quick-open-heading">Recently opened</p>}
          <div id={listId} role="listbox" aria-label="Matching note titles">
            {results.map(({ note, ranges }, i) => {
              const title = note.title || 'Untitled note',
                context = notebookContext(note, notebooks)
              return (
                <div
                  key={note.id}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === selectedIndex}
                  aria-label={`${title}, ${context}`}
                  className="quick-open-result"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={(event) => choose(note, event.metaKey || event.ctrlKey)}
                >
                  <FileText size={14} aria-hidden="true" />
                  <span className="quick-open-labels">
                    <AppTooltip label={title}>
                      <strong>
                        {quickTitleParts(title, ranges).map((part, partIndex) =>
                          part.matched ? (
                            <span key={partIndex} className="quick-open-match">
                              {part.text}
                            </span>
                          ) : (
                            part.text
                          ),
                        )}
                      </strong>
                    </AppTooltip>
                    <AppTooltip label={context}>
                      <small>{context}</small>
                    </AppTooltip>
                  </span>
                </div>
              )
            })}
          </div>
          {!results.length && (
            <p className="global-search-empty" role="status">
              {query.trim()
                ? 'No matching titles.'
                : 'No recently opened notes. Type to find a title.'}
            </p>
          )}
          <button
            ref={contentAction}
            className="quiet-button quick-open-content-action"
            onClick={() => onSearchContent(query)}
            disabled={disabled}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                input.current?.focus()
                onOpenChange(false)
              } else if (event.key === 'Tab' && event.shiftKey) {
                event.preventDefault()
                input.current?.focus()
              }
            }}
          >
            <FileSearch size={16} aria-hidden="true" />
            <span>Search note bodies</span>
            <kbd>{shortcutLabel('search')}</kbd>
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
