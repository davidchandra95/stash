import type { Location } from './workspace'

/** One stop on the app-wide Back/Forward timeline. `empty` is Notes with no tab open. */
export type Place =
  | { kind: 'tab'; tabId: string; location: Location }
  | { kind: 'project'; view: string; taskId: string | null }
  | { kind: 'empty' }
export type Timeline = { entries: Place[]; index: number }

const LIMIT = 200

export const emptyTimeline: Timeline = { entries: [], index: -1 }

const placeKey = (place: Place) => {
  if (place.kind === 'project') return `project:${place.view}:${place.taskId ?? ''}`
  if (place.kind === 'empty') return 'empty'
  const { location, tabId } = place
  return `tab:${tabId}:${location.kind === 'pdf' ? `pdf:${location.documentId}` : location.noteId}`
}

/** Follows the app to `place`, dropping anything ahead of the current stop. */
export function recordPlace(timeline: Timeline, place: Place): Timeline {
  const { entries, index } = timeline
  const current = entries[index]
  // The same stop with newer details, such as the notes filter in effect.
  if (current && placeKey(current) === placeKey(place))
    return { entries: entries.map((entry, i) => (i === index ? place : entry)), index }
  // Closing the task panel is not a destination: fold it into the page it was on.
  if (
    current?.kind === 'project' &&
    place.kind === 'project' &&
    current.view === place.view &&
    current.taskId &&
    !place.taskId
  ) {
    const previous = entries[index - 1]
    return previous && placeKey(previous) === placeKey(place)
      ? { entries: entries.slice(0, index), index: index - 1 }
      : { entries: [...entries.slice(0, index), place], index }
  }
  const next = [...entries.slice(0, index + 1), place].slice(-LIMIT)
  return { entries: next, index: next.length - 1 }
}

/** The nearest stop in `direction` that can still be visited. */
export function stepIndex(
  { entries, index }: Timeline,
  direction: -1 | 1,
  canVisit: (place: Place) => boolean,
): number | undefined {
  for (let i = index + direction; i >= 0 && i < entries.length; i += direction)
    if (canVisit(entries[i])) return i
}
