import { useEffect, useState } from 'react'
import { emptyTimeline, recordPlace, stepIndex, type Place, type Timeline } from './timeline'

/**
 * Back/Forward across Notes and Projects. It watches where the app is rather than being told,
 * so every way of opening a note, tab, page or task lands on the timeline.
 */
export function useTimeline({
  ready,
  disabled,
  place,
  canVisit,
  visit,
}: {
  ready: boolean
  disabled: boolean
  place: Place
  canVisit: (place: Place) => boolean
  /** Goes to a stop and returns where it actually landed, such as a reopened tab. */
  visit: (place: Place) => Place | null
}) {
  const [timeline, setTimeline] = useState<Timeline>(emptyTimeline)
  const fingerprint = JSON.stringify(place)
  useEffect(() => {
    if (ready) setTimeline((current) => recordPlace(current, place))
  }, [ready, fingerprint])
  const move = (direction: -1 | 1) => {
    const index = stepIndex(timeline, direction, canVisit)
    if (disabled || index === undefined) return
    const landed = visit(timeline.entries[index])
    if (!landed) return
    setTimeline(({ entries }) => ({
      entries: entries.map((entry, i) => (i === index ? landed : entry)),
      index,
    }))
  }
  return {
    move,
    canBack: stepIndex(timeline, -1, canVisit) !== undefined,
    canForward: stepIndex(timeline, 1, canVisit) !== undefined,
  }
}
