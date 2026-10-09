import { Fragment, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Notebook } from '../model'
import { matchSnippet, notebookContext } from '../search'
import {
  ContentResultIndex,
  SearchRowLayout,
  matchAnchor,
  resultKey,
  type MatchAnchor,
  type ResultRow,
} from '../search/contentResults'

type Measurement = { noteId: string; anchor?: MatchAnchor; height: number }
export function resultId(listId: string, row: ResultRow) {
  return `${listId}-${encodeURIComponent(resultKey(row))}`
}

export default function ContentSearchResults({
  index,
  selectedIndex,
  listId,
  query,
  notebooks,
  busy,
  onChoose,
}: {
  index: ContentResultIndex
  selectedIndex: number
  listId: string
  query: string
  notebooks: Notebook[]
  busy: boolean
  onChoose: (row: ResultRow, newTab: boolean) => void
}) {
  const list = useRef<HTMLDivElement>(null)
  const measured = useRef(new Map<string, Measurement>())
  const [measurementVersion, setMeasurementVersion] = useState(0)
  const [viewport, setViewport] = useState({ top: 0, height: 320, width: 0 })
  const previousSelectedRow = useRef<number | undefined>(undefined)
  const revealSelected = useRef(true)
  const expectedScrollTop = useRef<number | undefined>(undefined)
  const selected = index.match(selectedIndex)
  const selectedRow = selected?.rowIndex
  const layout = useMemo(() => {
    const value = new SearchRowLayout(index.rows)
    for (const [key, measurement] of measured.current) {
      const match = measurement.anchor ? index.locate(measurement.anchor) : undefined
      const row = measurement.anchor
        ? match === undefined
          ? undefined
          : index.match(match)?.rowIndex
        : index.heading(measurement.noteId)
      if (row !== undefined && resultKey(index.row(row)!) === key)
        value.measure(row, measurement.height)
    }
    return value
  }, [index, measurementVersion])
  const start = Math.max(0, layout.at(viewport.top) - 6)
  const end = Math.min(index.rows, layout.at(viewport.top + viewport.height) + 7)
  const rowNumbers = Array.from({ length: Math.max(0, end - start) }, (_, i) => start + i)
  // Keep the active descendant mounted even after a user manually scrolls away.
  if (selectedRow !== undefined && (selectedRow < start || selectedRow >= end))
    rowNumbers.push(selectedRow)
  rowNumbers.sort((a, b) => a - b)
  const chunks: { rows: ResultRow[]; start: number; end: number }[] = []
  for (const number of rowNumbers) {
    const row = index.row(number)!
    const last = chunks.at(-1)
    if (last && last.rows[0].groupIndex === row.groupIndex && last.end === number) {
      last.rows.push(row)
      last.end++
    } else chunks.push({ rows: [row], start: number, end: number + 1 })
  }

  useLayoutEffect(() => {
    if (selectedRow !== previousSelectedRow.current) {
      previousSelectedRow.current = selectedRow
      revealSelected.current = true
    }
    if (!revealSelected.current) return
    const element = list.current
    if (!element || !selected) return
    const option = document.getElementById(resultId(listId, selected))
    if (!option) return
    // Measure the mounted option after each height correction. An estimated
    // jump can otherwise stop short when wrapping to a distant multiline row.
    const bounds = option.getBoundingClientRect()
    const top = element.getBoundingClientRect().top + element.clientTop
    const height = element.clientHeight || viewport.height
    if (bounds.top < top) element.scrollTop += bounds.top - top
    else if (bounds.bottom > top + height) element.scrollTop += bounds.bottom - top - height
    expectedScrollTop.current = element.scrollTop
    setViewport((current) =>
      current.top === element.scrollTop && current.height === height
        ? current
        : { ...current, top: element.scrollTop, height },
    )
  }, [selectedRow, layout, viewport.height, listId])

  useLayoutEffect(() => {
    const element = list.current
    if (!element) return
    const updateViewport = () => {
      const height = element.clientHeight || 320,
        width = element.clientWidth
      setViewport((current) =>
        current.height === height && current.width === width && current.top === element.scrollTop
          ? current
          : { height, width, top: element.scrollTop },
      )
    }
    updateViewport()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      let changed = false
      for (const entry of entries) {
        if (entry.target === element) {
          if (
            entry.contentRect.width &&
            viewport.width &&
            entry.contentRect.width !== viewport.width
          ) {
            measured.current.clear()
            changed = true
          }
          updateViewport()
          continue
        }
        const number = Number((entry.target as HTMLElement).dataset.searchRow)
        const row = index.row(number)
        const height = entry.target.getBoundingClientRect().height
        if (!row || !height) continue
        const key = resultKey(row),
          previous = measured.current.get(key)
        if (
          previous &&
          Math.abs(previous.height - height) < 0.5 &&
          previous.anchor?.text === row.match?.segment.text
        )
          continue
        measured.current.delete(key)
        measured.current.set(key, {
          noteId: row.group.note.id,
          anchor: row.match ? matchAnchor(row.group, row.match) : undefined,
          height,
        })
        while (measured.current.size > 2048)
          measured.current.delete(measured.current.keys().next().value!)
        changed = true
      }
      if (changed) setMeasurementVersion((value) => value + 1)
    })
    observer.observe(element)
    element
      .querySelectorAll<HTMLElement>('[data-search-row]')
      .forEach((row) => observer.observe(row))
    return () => observer.disconnect()
  }, [index, start, end, selectedRow, viewport.width])

  let cursor = 0
  return (
    <div
      ref={list}
      className="global-search-results content-search-results"
      id={listId}
      role="listbox"
      aria-label="Matching content"
      aria-busy={busy}
      onScroll={(event) => {
        const top = event.currentTarget.scrollTop
        if (
          expectedScrollTop.current === undefined ||
          Math.abs(top - expectedScrollTop.current) > 1
        )
          revealSelected.current = false
        setViewport((current) => ({ ...current, top }))
      }}
    >
      {chunks.map((chunk) => {
        const before = layout.offset(chunk.start) - layout.offset(cursor)
        cursor = chunk.end
        const group = chunk.rows[0].group
        return (
          <Fragment key={`${group.note.id}-${chunk.start}`}>
            {before > 0 && (
              <div
                aria-hidden="true"
                className="content-search-spacer"
                style={{ height: before }}
              />
            )}
            <div
              className="content-search-group"
              role="group"
              aria-label={`${group.note.title || 'Untitled note'}, ${group.matches.length} matches`}
            >
              {chunk.rows.map((row) =>
                row.match ? (
                  <div
                    key={resultKey(row)}
                    data-search-row={row.rowIndex}
                    id={resultId(listId, row)}
                    className="global-search-result content-search-match"
                    role="option"
                    aria-selected={row.matchIndex === selectedIndex}
                    aria-posinset={row.matchIndex + 1}
                    aria-setsize={index.matches}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={(event) => onChoose(row, event.metaKey || event.ctrlKey)}
                  >
                    {matchSnippet(row.match, query).map((part, i) =>
                      part.highlighted ? (
                        <mark key={i} className={part.target ? 'target-match' : undefined}>
                          {part.text}
                        </mark>
                      ) : (
                        <span key={i}>{part.text}</span>
                      ),
                    )}
                  </div>
                ) : (
                  <div
                    key={resultKey(row)}
                    data-search-row={row.rowIndex}
                    className={`content-search-heading${row.groupIndex ? ' content-search-heading-separated' : ''}`}
                  >
                    <strong>{group.note.title || 'Untitled note'}</strong>
                    <small>{notebookContext(group.note, notebooks)}</small>
                    <span>{group.matches.length}</span>
                  </div>
                ),
              )}
            </div>
          </Fragment>
        )
      })}
      {cursor < index.rows && (
        <div
          aria-hidden="true"
          className="content-search-spacer"
          style={{ height: layout.offset(index.rows) - layout.offset(cursor) }}
        />
      )}
    </div>
  )
}
