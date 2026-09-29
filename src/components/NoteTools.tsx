import { useShortcutActions } from '../useShortcuts'
import { MotionPresence, motion } from '../motion'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { HTMLAttributes } from 'react'
import { createPortal } from 'react-dom'
import { useEditorState } from '@tiptap/react'
import { ArrowDown, ArrowUp, ChevronRight, X } from '../icons'
import type { Note } from '../model'
import { getEditor } from '../editor/session'
import {
  clearReveals,
  documentMatches,
  literalMatches,
  outline,
  scrollToPosition,
  setFind,
  type HeadingEntry,
} from '../editor/noteTools'

export default function NoteTools({
  note,
  contentsOpen,
  findOpen,
  onFindOpenChange,
  disabled,
  contentsDividerProps,
}: {
  note: Note
  contentsOpen: boolean
  findOpen: boolean
  onFindOpenChange: (open: boolean) => void
  disabled: boolean
  contentsDividerProps?: HTMLAttributes<HTMLDivElement>
}) {
  const editor = getEditor(note.id, note.content, undefined, !!note.source)
  const doc = useEditorState({
    editor,
    selector: ({ editor }) => editor.state.doc,
    equalityFn: Object.is,
  })
  const headings = useMemo(() => outline(doc), [doc])
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const [visibleSections, setVisibleSections] = useState<Set<number>>(new Set())
  const input = useRef<HTMLInputElement>(null)
  const titleMatches = useMemo(
    () => literalMatches(note.title, findOpen ? query : ''),
    [note.title, findOpen, query],
  )
  const bodyMatches = useMemo(
    () => documentMatches(doc, findOpen ? query : ''),
    [doc, findOpen, query],
  )
  const total = titleMatches.length + bodyMatches.length
  const current = Math.min(index, Math.max(0, total - 1))
  useEffect(() => {
    setCollapsed(new Set())
    setIndex(0)
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
    } else scrollToPosition(editor, bodyMatches[next - titleMatches.length].from)
  }
  // Jump as a query changes, but keep the find field focused while typing.
  useEffect(() => {
    if (findOpen && query && total) revealMatch(current)
  }, [query, findOpen, editor, total])
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
            <button
              className="outline-heading"
              title={heading.title}
              onClick={() => {
                scrollToPosition(editor, heading.pos + 1)
              }}
            >
              {heading.title}
            </button>
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
  const [slot, setSlot] = useState<Element | null>(null)
  const [titleSlot, setTitleSlot] = useState<Element | null>(null)
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
          </MotionPresence>,
          slot,
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
