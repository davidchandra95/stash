import { useEffect, useRef, useState } from 'react'
import type { Note } from './model'
import { searchDocument, type ReadSearchNote, type SearchDocument } from './search'

export function useContentSearch(open: boolean, notes: Note[], readNote: ReadSearchNote) {
  const cache = useRef(new Map<string, { source: Note; value: SearchDocument }>())
  const lanes = useRef<Promise<void>[]>(Array.from({ length: 3 }, () => Promise.resolve()))
  const nextLane = useRef(0)
  const [state, setState] = useState<{
    documents: SearchDocument[]
    loading: boolean
    failures: string[]
  }>({ documents: [], loading: false, failures: [] })
  useEffect(() => {
    if (!open) return
    let cancelled = false,
      cursor = 0
    const available = notes.filter((note) => !note.trashed)
    const documents: SearchDocument[] = [],
      failures: string[] = []
    const ids = new Set(available.map((note) => note.id))
    for (const id of cache.current.keys()) if (!ids.has(id)) cache.current.delete(id)
    setState({ documents: [], loading: true, failures: [] })
    const read = (id: string) => {
      const lane = nextLane.current++ % lanes.current.length
      const request = lanes.current[lane].then(() => {
        if (cancelled) throw Error('Search cancelled.')
        return readNote(id)
      })
      lanes.current[lane] = request.then(
        () => {},
        () => {},
      )
      return request
    }
    const worker = async () => {
      while (!cancelled && cursor < available.length) {
        const source = available[cursor++]
        try {
          if (source.source?.unavailable) throw Error(source.source.unavailable)
          const previous = cache.current.get(source.id)
          const unchanged =
            previous &&
            previous.source.content === source.content &&
            previous.source.text === source.text &&
            previous.source.updated === source.updated &&
            previous.source.source?.fingerprint === source.source?.fingerprint
          let document: SearchDocument
          if (unchanged)
            document = {
              ...previous.value,
              note: { ...source, content: previous.value.note.content },
            }
          else {
            const note = await read(source.id)
            if (cancelled) return
            document = { note, doc: searchDocument(note) }
          }
          if (cancelled) return
          documents.push(document)
          cache.current.set(source.id, { source, value: document })
        } catch (error) {
          if (!cancelled) failures.push(`${source.title || 'Untitled note'}: ${String(error)}`)
        }
      }
    }
    void Promise.all(Array.from({ length: Math.min(3, available.length) }, worker)).then(() => {
      if (!cancelled) setState({ documents, loading: false, failures })
    })
    return () => {
      cancelled = true
    }
  }, [open, notes, readNote])
  return state
}
