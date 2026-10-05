import AppTooltip from './AppTooltip'
import { useShortcutActions } from '../useShortcuts'
import { MotionPresence, motion } from '../motion'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { HTMLAttributes } from 'react'
import { createPortal } from 'react-dom'
import { useEditorState } from '@tiptap/react'
import { replaceBodyText } from '../editor/replace'
import { ArrowDown, ArrowUp, ChevronRight, X } from '../icons'
import type { Note } from '../model'
import { getEditor } from '../editor/session'
import { referenceTitle } from '../editor/noteReferences'
import { resolveMatch, type MatchNavigation } from '../search'
import {
  clearReveals,
  documentMatches,
  literalMatches,
  outline,
  scrollToPosition,
  scrollToMatch,
  setFind,
  type HeadingEntry,
} from '../editor/noteTools'

export default function NoteTools({
  note,
  contentsOpen,
  findOpen,
  onFindOpenChange,
  disabled,
  readOnly = false,
  contentsDividerProps,
  searchNavigation,
  searchNotes = [note],
  onSearchNavigationComplete,
}: {
  note: Note
  contentsOpen: boolean
  findOpen: boolean
  onFindOpenChange: (open: boolean) => void
  disabled: boolean
  readOnly?: boolean
  searchNavigation?: MatchNavigation | null
  searchNotes?: Note[]
  onSearchNavigationComplete?: () => void
  contentsDividerProps?: HTMLAttributes<HTMLDivElement>
}) {
  const editor = getEditor(note.id, note.content, undefined, !!note.source)
  useEditorState({
    editor,
    selector: ({ editor }) => editor.state.doc,
    equalityFn: Object.is,
  })
  // The subscription can still hold the previous editor's snapshot during a tab switch.
  // Always calculate positions against the currently mounted editor.
  const doc = editor.state.doc
  const headings = useMemo(() => outline(doc), [doc])
  const [query, setQuery] = useState('')
  const [replaceOpen, setReplaceOpen] = useState(false)
  const [replacement, setReplacement] = useState('')
  const replacementInput = useRef<HTMLInputElement>(null)
  const [index, setIndex] = useState(0)
  const [navigationError, setNavigationError] = useState('')
  const pendingReveal = useRef<import('../editor/searchText').DocumentMatch | null>(null)
  const handledNavigation = useRef<MatchNavigation | null>(null)
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const [visibleSections, setVisibleSections] = useState<Set<number>>(new Set())
  const input = useRef<HTMLInputElement>(null)
  const [slot, setSlot] = useState<Element | null>(null)
  const [titleSlot, setTitleSlot] = useState<Element | null>(null)
  const titleMatches = useMemo(
    () => literalMatches(note.title, findOpen ? query : ''),
    [note.title, findOpen, query],
  )
  const bodyMatches = useMemo(
    () =>
      documentMatches(doc, findOpen ? query : '', (id, fallback) =>
        referenceTitle(editor, id, fallback),
      ),
    [doc, findOpen, query, editor, searchNotes],
  )
  const total = titleMatches.length + bodyMatches.length
  const current = Math.min(index, Math.max(0, total - 1))
  useEffect(() => {
    setCollapsed(new Set())
    setIndex(0)
    setNavigationError('')
    setReplaceOpen(false)
    setReplacement('')
    pendingReveal.current = null
    handledNavigation.current = null
    return () => {
      if (editor.isDestroyed) return
      setFind(editor, '', -1)
      clearReveals(editor)
    }
  }, [editor])
  useLayoutEffect(() => {
    setFind(editor, findOpen ? query : '', current - titleMatches.length)
    return () => {
      if (editor.isDestroyed) return
      setFind(editor, '', -1)
    }
  }, [editor, findOpen, query, current, titleMatches.length])
  useEffect(() => {
    if (findOpen) input.current?.focus()
  }, [findOpen, editor])
  useShortcutActions(
    {
      find: () => {
        onFindOpenChange(true)
        input.current?.focus()
        input.current?.select()
      },
    },
    disabled,
  )
  useEffect(() => {
    if (!contentsOpen) return
    const scroll = editor.view.dom.closest('.note-scroll')
    if (!scroll) return
    const flat: HeadingEntry[] = []
    const visit = (entries: HeadingEntry[]) =>
      entries.forEach((heading) => {
        flat.push(heading)
        visit(heading.children)
      })
    visit(headings)
    const update = () => {
      if (editor.isDestroyed) return
      const viewport = scroll.getBoundingClientRect()
      const visible = new Set<number>()
      for (const [index, heading] of flat.entries()) {
        // A heading owns only the content before the next heading, not its descendants.
        const end = flat[index + 1]?.pos ?? doc.content.size
        const element = editor.view.nodeDOM(heading.pos)
        if (!(element instanceof HTMLElement) || !element.getClientRects().length) continue
        const next = end < doc.content.size ? editor.view.nodeDOM(end) : null
        const bottom =
          next instanceof HTMLElement && next.getClientRects().length
            ? next.getBoundingClientRect().top
            : editor.view.dom.getBoundingClientRect().bottom
        if (element.getBoundingClientRect().top < viewport.bottom && bottom > viewport.top)
          visible.add(heading.pos)
      }
      setVisibleSections((previous) =>
        previous.size === visible.size && [...visible].every((pos) => previous.has(pos))
          ? previous
          : visible,
      )
    }
    update()
    scroll.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    resize?.observe(scroll)
    resize?.observe(editor.view.dom)
    return () => {
      scroll.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      resize?.disconnect()
    }
  }, [editor, doc, headings, contentsOpen])
  const revealMatch = (value: number) => {
    if (!total) return
    const next = (value + total) % total
    setIndex(next)
    if (next < titleMatches.length) {
      const title = document.querySelector<HTMLInputElement>('.note-title')
      title?.scrollIntoView({ block: 'center' })
      const highlights = document.querySelector<HTMLElement>('.note-title-highlights')
      const mark = highlights?.querySelectorAll<HTMLElement>('mark')[next]
      if (title && highlights && mark) {
        title.scrollLeft = Math.max(0, mark.offsetLeft - title.clientWidth / 2)
        highlights.scrollLeft = title.scrollLeft
      }
    } else scrollToMatch(editor, bodyMatches[next - titleMatches.length])
  }
  // Jump as a query changes, but keep the find field focused while typing.
  useEffect(() => {
    if (findOpen && query && total && !navigationError) revealMatch(current)
  }, [query, findOpen, editor, total, navigationError])
  useEffect(() => {
    if (
      !searchNavigation ||
      searchNavigation.noteId !== note.id ||
      disabled ||
      handledNavigation.current === searchNavigation
    )
      return
    handledNavigation.current = searchNavigation
    const match = resolveMatch(editor.state.doc, searchNavigation, searchNotes)
    setQuery(searchNavigation.query)
    if (match) {
      const matches = documentMatches(editor.state.doc, searchNavigation.query, (id, fallback) =>
        referenceTitle(editor, id, fallback),
      )
      const bodyIndex = matches.findIndex(
        (candidate) => candidate.from === match.from && candidate.offset === match.offset,
      )
      const titleCount = literalMatches(note.title, searchNavigation.query).length
      setIndex(titleCount + bodyIndex)
      pendingReveal.current = match
      setNavigationError('')
    } else {
      setNavigationError('This match changed. Search again to find its current location.')
    }
    onSearchNavigationComplete?.()
  }, [
    searchNavigation,
    editor,
    note.id,
    disabled,
    searchNotes,
    note.title,
    onSearchNavigationComplete,
  ])
  useEffect(() => {
    const match = pendingReveal.current
    if (!match || !findOpen || !slot) return
    pendingReveal.current = null
    scrollToMatch(editor, match)
    input.current?.focus({ preventScroll: true })
  })
  const writesBlocked = disabled || readOnly || !!note.trashed || !editor.isEditable
  const activeBodyMatch = bodyMatches[current - titleMatches.length]
  const replace = (all: boolean) => {
    if (writesBlocked || editor.isDestroyed) return
    // Re-read the document and title matches immediately before any write.
    const freshTitle = literalMatches(note.title, query)
    const freshBody = documentMatches(editor.state.doc, query, (id, fallback) =>
      referenceTitle(editor, id, fallback),
    )
    const match = freshBody[current - freshTitle.length]
    if (!all && (!match || match.atom)) return
    const result = replaceBodyText(editor, query, replacement, all ? undefined : match)
    if (result) {
      const next = documentMatches(editor.state.doc, query, (id, fallback) =>
        referenceTitle(editor, id, fallback),
      )
      const nextIndex = next.findIndex((candidate) => candidate.from >= result.next)
      setIndex(nextIndex >= 0 ? freshTitle.length + nextIndex : 0)
      setNavigationError('')
    }
    replacementInput.current?.focus({ preventScroll: true })
  }
  const close = () => {
    onFindOpenChange(false)
    editor.view.focus()
  }
  const tree = (entries: HeadingEntry[]) => (
    <ul>
      {entries.map((heading) => (
        <li key={heading.pos}>
          <div className="outline-row" data-visible={visibleSections.has(heading.pos) || undefined}>
            {heading.children.length ? (
              <button
                className="outline-disclosure"
                aria-label={`${collapsed.has(heading.pos) ? 'Expand' : 'Collapse'} ${heading.title}`}
                aria-expanded={!collapsed.has(heading.pos)}
                onClick={() =>
                  setCollapsed((old) => {
                    const next = new Set(old)
                    if (next.has(heading.pos)) next.delete(heading.pos)
                    else next.add(heading.pos)
                    return next
                  })
                }
              >
                <ChevronRight size={13} />
              </button>
            ) : (
              <span className="outline-bullet">·</span>
            )}
            <AppTooltip label={heading.title}>
              <button
                className="outline-heading"
                onClick={() => {
                  scrollToPosition(editor, heading.pos + 1)
                }}
              >
                {heading.title}
              </button>
            </AppTooltip>
          </div>
          {heading.children.length > 0 && (
            <MotionPresence
              open={!collapsed.has(heading.pos)}
              collapse
              duration={motion.collapse}
              initial={false}
            >
              <div>{tree(heading.children)}</div>
            </MotionPresence>
          )}
        </li>
      ))}
    </ul>
  )
  useLayoutEffect(() => {
    setSlot(document.getElementById('note-find-slot'))
    setTitleSlot(document.querySelector('.note-title-highlights'))
  }, [note.id])
  useEffect(() => {
    if (findOpen) input.current?.focus()
  }, [slot, findOpen])
  useEffect(() => {
    const map = ({ transaction }: { transaction: import('@tiptap/pm/state').Transaction }) => {
      if (!transaction.docChanged) return
      setCollapsed(
        (old) =>
          new Set(
            [...old].flatMap((pos) => {
              const mapped = transaction.mapping.mapResult(pos)
              return mapped.deleted ? [] : [mapped.pos]
            }),
          ),
      )
    }
    editor.on('transaction', map)
    return () => {
      editor.off('transaction', map)
    }
  }, [editor])
  const markedTitle = () => {
    const pieces = []
    let last = 0
    titleMatches.forEach((match, i) => {
      pieces.push(
        note.title.slice(last, match.from),
        <mark key={i} className={current === i ? 'current-match' : ''}>
          {note.title.slice(match.from, match.to)}
        </mark>,
      )
      last = match.to
    })
    pieces.push(note.title.slice(last))
    return pieces
  }
  return (
    <>
      {slot &&
        createPortal(
          <MotionPresence open={findOpen} collapse duration={motion.find}>
            <div className="note-find-bar" role="search" aria-label="Find in current note">
              <div className="note-find-row">
                <button
                  className="icon-button find-replace-toggle"
                  aria-label="Show replacement"
                  aria-expanded={replaceOpen}
                  disabled={disabled}
                  onClick={() => setReplaceOpen((open) => !open)}
                >
                  <ChevronRight size={15} />
                </button>
                <input
                  ref={input}
                  className="text-field"
                  value={query}
                  disabled={disabled}
                  aria-label="Find in current note"
                  placeholder="Find in note…"
                  onChange={(event) => {
                    setQuery(event.target.value)
                    setIndex(0)
                    setNavigationError('')
                  }}
                  onKeyDown={(event) => {
                    if (event.nativeEvent.isComposing) return
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      revealMatch(current + (event.shiftKey ? -1 : 1))
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      event.stopPropagation()
                      close()
                    }
                  }}
                />
                <span role="status">
                  {total ? `${current + 1} of ${total}` : query ? 'No matches' : '0 of 0'}
                </span>
                <button
                  className="icon-button"
                  aria-label="Previous match"
                  disabled={!total || disabled}
                  onClick={() => revealMatch(current - 1)}
                >
                  <ArrowUp size={15} />
                </button>
                <button
                  className="icon-button"
                  aria-label="Next match"
                  disabled={!total || disabled}
                  onClick={() => revealMatch(current + 1)}
                >
                  <ArrowDown size={15} />
                </button>
                <button className="icon-button" aria-label="Close find" onClick={close}>
                  <X size={15} />
                </button>
              </div>
              {replaceOpen && (
                <div className="note-find-row note-replace-row">
                  <input
                    ref={replacementInput}
                    className="text-field"
                    aria-label="Replace with"
                    placeholder="Replace with…"
                    value={replacement}
                    disabled={writesBlocked}
                    onChange={(event) => setReplacement(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.nativeEvent.isComposing) return
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        replace(event.shiftKey)
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault()
                        event.stopPropagation()
                        close()
                      }
                    }}
                  />
                  <button
                    className="quiet-button"
                    disabled={writesBlocked || !activeBodyMatch || !!activeBodyMatch.atom}
                    onClick={() => replace(false)}
                  >
                    Replace
                  </button>
                  <button
                    className="quiet-button"
                    disabled={writesBlocked || !bodyMatches.some((match) => !match.atom)}
                    onClick={() => replace(true)}
                  >
                    Replace all
                  </button>
                </div>
              )}
            </div>
          </MotionPresence>,
          slot,
        )}
      {findOpen && navigationError && (
        <p className="content-search-navigation-error" role="status">
          {navigationError}
        </p>
      )}
      {titleSlot && createPortal(markedTitle(), titleSlot)}
      {contentsOpen && contentsDividerProps && <div {...contentsDividerProps} />}
      <MotionPresence open={contentsOpen} duration={motion.contents}>
        <aside className="note-outline" aria-label="Table of contents">
          <h2>Table of contents</h2>
          {headings.length ? (
            <nav aria-label="Note headings">{tree(headings)}</nav>
          ) : (
            <p>Add headings to see this note’s contents.</p>
          )}
        </aside>
      </MotionPresence>
    </>
  )
}
