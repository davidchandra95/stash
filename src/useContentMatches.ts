import { useEffect, useMemo, useRef, useState } from 'react'
import type { Note } from './model'
import { searchSegments, type ContentGroup, type SearchDocument } from './search'
import { ContentSearchClient, type SearchSnapshot } from './search/contentSearchClient'
import type { IndexedDocument } from './search/contentMatcher'

export function useContentMatches(
  open: boolean,
  documents: SearchDocument[],
  query: string,
  notes: Note[],
) {
  const client = useRef<ContentSearchClient | null>(null)
  const indexed = useRef(new Map<string, IndexedDocument>())
  const version = useRef(0)
  const [state, setState] = useState<SearchSnapshot>({
    query: '',
    matches: new Map(),
    searching: false,
    error: '',
  })
  const titles = useMemo(
    () => new Map(notes.map((note) => [note.id, note.title || 'Untitled note'])),
    [notes],
  )
  const term = query.trim()
  useEffect(() => {
    if (!open) return
    const search = new ContentSearchClient(setState)
    client.current = search
    indexed.current.clear()
    return () => {
      search.dispose()
      client.current = null
      indexed.current.clear()
      setState({ query: '', matches: new Map(), searching: false, error: '' })
    }
  }, [open])
  useEffect(() => {
    if (!client.current) return
    const ids = new Set(documents.map(({ note }) => note.id))
    const removed = [...indexed.current.keys()].filter((id) => !ids.has(id))
    for (const id of removed) indexed.current.delete(id)
    const upserts: IndexedDocument[] = []
    for (const { note, doc } of documents) {
      const segments = searchSegments(doc, titles)
      if (indexed.current.get(note.id)?.segments === segments) continue
      const entry = { id: note.id, version: ++version.current, segments }
      indexed.current.set(note.id, entry)
      upserts.push(entry)
    }
    client.current.update(term, upserts, removed)
  }, [open, documents, term, titles])
  const groups = useMemo(() => {
    if (!open || state.query !== term) return []
    const result: ContentGroup[] = []
    for (const document of documents) {
      const match = state.matches.get(document.note.id)
      if (
        match?.matches.length &&
        match.version === indexed.current.get(document.note.id)?.version &&
        // A title-reference update can invalidate an occurrence before its effect
        // sends a new worker version. Never expose that stale positional context.
        indexed.current.get(document.note.id)?.segments === searchSegments(document.doc, titles)
      )
        result.push({ ...document, matches: match.matches })
    }
    return result.sort(
      (a, b) => b.note.updated - a.note.updated || a.note.id.localeCompare(b.note.id),
    )
  }, [open, documents, term, state, titles])
  return {
    groups,
    searching: open && !!term && (state.query !== term || state.searching),
    failure: state.error,
  }
}
