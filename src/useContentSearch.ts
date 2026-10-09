import { useEffect, useMemo, useRef, useState } from 'react'
import type { Note } from './model'
import { searchDocument, type ReadSearchNote, type SearchDocument } from './search'

const cacheLimit = 512
const cacheCharacters = 4 * 1024 * 1024
const sliceMs = 4
const publishMs = 16

type CachedDocument = { source: Note; value: SearchDocument; characters: number }
type SearchState = {
  notes: Note[] | null
  documents: SearchDocument[]
  loading: boolean
  failures: string[]
  read: number
  total: number
}

function unchanged(previous: Note, source: Note) {
  return (
    previous.content === source.content &&
    previous.text === source.text &&
    previous.updated === source.updated &&
    !!previous.source === !!source.source &&
    previous.source?.rootId === source.source?.rootId &&
    previous.source?.relativePath === source.source?.relativePath &&
    previous.source?.fingerprint === source.source?.fingerprint &&
    previous.source?.unavailable === source.source?.unavailable
  )
}

export function useContentSearch(open: boolean, notes: Note[], readNote: ReadSearchNote) {
  const cache = useRef(new Map<string, CachedDocument>())
  const active = useRef(new Map<string, CachedDocument>())
  const lanes = useRef<Promise<void>[]>(Array.from({ length: 3 }, () => Promise.resolve()))
  const [state, setState] = useState<SearchState>({
    notes: null,
    documents: [],
    loading: false,
    failures: [],
    read: 0,
    total: 0,
  })
  useEffect(() => {
    if (!open) {
      active.current.clear()
      setState({ notes, documents: [], loading: false, failures: [], read: 0, total: 0 })
      return
    }
    let cancelled = false,
      cursor = 0,
      completed = 0,
      published = false
    let publishTimer: ReturnType<typeof setTimeout> | undefined
    const available = notes.filter((note) => !note.trashed)
    const ids = new Set(available.map((note) => note.id))
    for (const entries of [cache.current, active.current])
      for (const id of entries.keys()) if (!ids.has(id)) entries.delete(id)
    // A clean linked file can change without a new JS summary. Reopening search
    // must consult readSearchNote again; loaded/pending drafts still win there.
    const reusable = (source: Note) => {
      const previous =
        active.current.get(source.id) ?? (!source.source ? cache.current.get(source.id) : null)
      return previous && unchanged(previous.source, source) && !source.source?.unavailable
        ? previous
        : null
    }
    const work: Note[] = []
    const documents: SearchDocument[] = [],
      failures: string[] = []
    for (const source of available) {
      const previous = reusable(source)
      if (previous) {
        const value =
          previous.source === source
            ? previous.value
            : {
                ...previous.value,
                note: {
                  ...source,
                  content: previous.value.note.content,
                  source: previous.value.note.source,
                },
              }
        documents.push(value)
        active.current.set(source.id, { ...previous, source, value })
        completed++
      } else {
        active.current.delete(source.id)
        work.push(source)
      }
    }
    work.sort((a, b) => b.updated - a.updated || a.id.localeCompare(b.id))
    setState({
      notes,
      documents: [...documents],
      loading: !!work.length,
      failures: [],
      read: completed,
      total: available.length,
    })
    const publish = (loading: boolean) => {
      if (cancelled) return
      published = true
      setState({
        notes,
        documents: [...documents],
        loading,
        failures: [...failures],
        read: completed,
        total: available.length,
      })
    }
    const schedulePublish = () => {
      if (publishTimer !== undefined) return
      publishTimer = setTimeout(
        () => {
          publishTimer = undefined
          publish(true)
        },
        published ? publishMs : 0,
      )
    }
    const remember = (source: Note, value: SearchDocument) => {
      cache.current.delete(source.id)
      const characters =
        value.doc.content.size + value.note.text.length + (value.note.source?.markdown?.length ?? 0)
      active.current.set(source.id, { source, value, characters })
      if (characters > cacheCharacters) return
      cache.current.set(source.id, { source, value, characters })
      let size = 0
      for (const entry of cache.current.values()) size += entry.characters
      while (cache.current.size > cacheLimit || size > cacheCharacters) {
        const first = cache.current.entries().next().value!
        size -= first[1].characters
        cache.current.delete(first[0])
      }
    }
    const read = (id: string, lane: number) => {
      const request = lanes.current[lane].then(() => {
        if (cancelled) throw Error('Search cancelled.')
        return readNote(id)
      })
      // Keep the cap across effect generations, including reads already launched
      // by a closed dialog. Native invokes cannot be aborted by this hook.
      lanes.current[lane] = request.then(
        () => {},
        () => {},
      )
      return request
    }
    const worker = async (lane: number) => {
      let spent = 0
      while (!cancelled && cursor < work.length) {
        const source = work[cursor++]
        let started: number | undefined
        try {
          const note = await read(source.id, lane)
          if (cancelled) return
          // Waiting for I/O already yields the event loop. Budget preparation
          // work separately, so slow reads do not incur another artificial wait.
          started = performance.now()
          const document = { note, doc: searchDocument(note) }
          if (cancelled) return
          documents.push(document)
          remember(source, document)
        } catch (error) {
          started ??= performance.now()
          if (!cancelled) failures.push(`${source.title || 'Untitled note'}: ${String(error)}`)
        }
        if (cancelled) return
        completed++
        schedulePublish()
        spent += performance.now() - started
        if (spent >= sliceMs) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0))
          spent = 0
        }
      }
    }
    void Promise.all(
      Array.from({ length: Math.min(3, work.length) }, (_, lane) => worker(lane)),
    ).then(() => {
      if (publishTimer !== undefined) clearTimeout(publishTimer)
      publish(false)
    })
    return () => {
      cancelled = true
      if (publishTimer !== undefined) clearTimeout(publishTimer)
    }
  }, [open, notes, readNote])
  // Keep unchanged results on library updates, but hide changed/removed bodies
  // before effect cleanup and before a late worker batch can be selected.
  const visible = useMemo(() => {
    if (!open) return []
    if (state.notes === notes) return state.documents
    const previous = new Map(state.notes?.map((note) => [note.id, note]) ?? [])
    const current = new Map(notes.map((note) => [note.id, note]))
    return state.documents.flatMap((document) => {
      const source = current.get(document.note.id),
        old = previous.get(document.note.id)
      return source && old && !source.trashed && unchanged(old, source)
        ? [{ ...document, note: { ...source, content: document.note.content } }]
        : []
    })
  }, [open, notes, state.notes, state.documents])
  return {
    documents: visible,
    loading: open && (state.notes !== notes || state.loading),
    failures: open && state.notes === notes ? state.failures : [],
    read: open && state.notes === notes ? state.read : visible.length,
    total: open
      ? state.notes === notes
        ? state.total
        : notes.filter((note) => !note.trashed).length
      : 0,
  }
}
