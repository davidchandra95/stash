import { hasTasks, matchesView, type FileSource, type Note, type View } from '../model'
import { noteComparator, sortNotes, type NoteListPreferences } from '../noteOrder'
import type { LibraryState } from './library'

// Navigation owns membership and the edited day. Exact timestamps, text, and
// documents belong to live rows/editor readers, so typing does not wake the shell.
export type NavigationNote = Pick<
  Note,
  'id' | 'title' | 'notebookIds' | 'tags' | 'pinned' | 'trashed' | 'quickAccess'
> & {
  updated: number
  hasTasks: boolean
  source?: Omit<FileSource, 'markdown'> | null
}
const sameArray = <T>(a: readonly T[], b: readonly T[]) =>
  a.length === b.length && a.every((value, i) => value === b[i])
export function localDay(timestamp = Date.now()) {
  const date = new Date(timestamp)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}
const sourceFields = ['rootId', 'relativePath', 'fingerprint', 'unavailable', 'trashPath'] as const
function navigationNote(note: Note, previous?: NavigationNote): NavigationNote {
  const next: NavigationNote = {
    id: note.id,
    title: note.title,
    pinned: note.pinned,
    trashed: note.trashed,
    quickAccess: note.quickAccess,
    notebookIds: note.notebookIds,
    tags: note.tags,
    updated: localDay(note.updated),
    hasTasks: hasTasks(note),
    source: note.source
      ? (Object.fromEntries(sourceFields.map((key) => [key, note.source![key]])) as Omit<
          FileSource,
          'markdown'
        >)
      : note.source,
  }
  if (!previous) return next
  if (sameArray(previous.notebookIds, next.notebookIds)) next.notebookIds = previous.notebookIds
  if (sameArray(previous.tags, next.tags)) next.tags = previous.tags
  if (
    previous.source &&
    next.source &&
    sourceFields.every((key) => previous.source![key] === next.source![key])
  )
    next.source = previous.source
  return Object.keys(next).every(
    (key) => next[key as keyof NavigationNote] === previous[key as keyof NavigationNote],
  )
    ? previous
    : next
}
type Change = { previous?: Note; next?: Note }

export class LibraryProjection {
  private notes?: Note[]
  private byId = new Map<string, Note>()
  private navigationById = new Map<string, NavigationNote>()
  private navigationNotes: NavigationNote[] = []
  private tagList: string[] = []
  private counts = new Map<View, number>()
  private day = NaN
  private version = 0
  private changes: Change[] = []
  constructor(private now = () => Date.now()) {}

  private sync(state: LibraryState) {
    const day = localDay(this.now())
    if (day !== this.day) {
      this.day = day
      this.counts.delete('today')
    }
    if (state.notes === this.notes) return
    const nextById = new Map<string, Note>()
    const nextNavigation: NavigationNote[] = []
    const changes: Change[] = []
    const navigationChanges: { previous?: NavigationNote; next?: NavigationNote }[] = []
    for (const note of state.notes) {
      nextById.set(note.id, note)
      const previous = this.byId.get(note.id)
      const navigation =
        previous === note
          ? this.navigationById.get(note.id)!
          : navigationNote(note, this.navigationById.get(note.id))
      const previousNavigation = this.navigationById.get(note.id)
      if (previousNavigation !== navigation)
        navigationChanges.push({ previous: previousNavigation, next: navigation })
      this.navigationById.set(note.id, navigation)
      nextNavigation.push(navigation)
      if (previous !== note) changes.push({ previous, next: note })
    }
    for (const [id, previous] of this.byId)
      if (!nextById.has(id)) {
        changes.push({ previous })
        navigationChanges.push({ previous: this.navigationById.get(id) })
        this.navigationById.delete(id)
      }
    if (!sameArray(this.navigationNotes, nextNavigation)) {
      this.navigationNotes = nextNavigation
      for (const [view, count] of this.counts) {
        const delta = navigationChanges.reduce(
          (sum, change) =>
            sum +
            Number(!!change.next && this.matches(change.next, view)) -
            Number(!!change.previous && this.matches(change.previous, view)),
          0,
        )
        if (delta) this.counts.set(view, count + delta)
      }
      if (
        navigationChanges.some(
          ({ previous, next }) =>
            !previous || !next || previous.tags !== next.tags || previous.trashed !== next.trashed,
        )
      ) {
        const tags = [
          ...new Set(nextNavigation.filter((note) => !note.trashed).flatMap((note) => note.tags)),
        ].sort()
        if (!sameArray(this.tagList, tags)) this.tagList = tags
      }
    }
    this.byId = nextById
    this.notes = state.notes
    this.changes = changes
    this.version++
  }
  navigation = (state: LibraryState) => {
    this.sync(state)
    return this.navigationNotes
  }
  note = (state: LibraryState, id: string) => {
    this.sync(state)
    return this.byId.get(id)
  }
  tags = (state: LibraryState) => {
    this.sync(state)
    return this.tagList
  }
  count = (state: LibraryState, view: View) => {
    this.sync(state)
    let count = this.counts.get(view)
    if (count === undefined) {
      count = this.navigationNotes.filter((note) => this.matches(note, view)).length
      this.counts.set(view, count)
    }
    return count
  }
  private matches(note: Note | NavigationNote, view: View) {
    return view === 'today'
      ? !note.trashed && localDay(note.updated) === this.day
      : matchesView(note, view)
  }

  list(view: View, query: string, preferences?: NoteListPreferences) {
    const compare = noteComparator(preferences)
    const term = query.toLowerCase()
    const matchesQuery = (note: Note) => `${note.title} ${note.text}`.toLowerCase().includes(term)
    let version = -1
    let day = NaN
    let ordered: Note[] = []
    let ids: string[] = []
    return (state: LibraryState) => {
      this.sync(state)
      if (version === this.version && day === this.day) return ids
      let changedOrder = false
      let changedQuery = false
      if (version !== this.version - 1 || day !== this.day || this.changes.length > 8) {
        ordered = sortNotes(
          state.notes.filter((note) => this.matches(note, view)),
          preferences,
        )
        changedOrder = true
      } else {
        for (const { previous, next } of this.changes) {
          const index = ordered.findIndex((note) => note.id === (next?.id ?? previous?.id))
          const included = !!next && this.matches(next, view)
          if (previous && next && matchesQuery(previous) !== matchesQuery(next)) changedQuery = true
          if (index >= 0 && included) {
            ordered[index] = next!
            if (
              (index > 0 && compare(ordered[index - 1], next!) > 0) ||
              (index + 1 < ordered.length && compare(next!, ordered[index + 1]) > 0)
            ) {
              ordered.splice(index, 1)
              this.insert(ordered, next!, compare)
              changedOrder = true
            }
          } else if (index >= 0) {
            ordered.splice(index, 1)
            changedOrder = true
          } else if (included) {
            this.insert(ordered, next!, compare)
            changedOrder = true
          }
        }
      }
      version = this.version
      day = this.day
      if (changedOrder || changedQuery) {
        const nextIds = (term ? ordered.filter(matchesQuery) : ordered).map((note) => note.id)
        if (!sameArray(ids, nextIds)) ids = nextIds
      }
      return ids
    }
  }
  private insert(notes: Note[], note: Note, compare: ReturnType<typeof noteComparator>) {
    let low = 0,
      high = notes.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (compare(notes[middle], note) <= 0) low = middle + 1
      else high = middle
    }
    notes.splice(low, 0, note)
  }
}
export const libraryProjection = new LibraryProjection()
