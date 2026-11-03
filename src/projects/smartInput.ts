/** Local calendar dates and wall-clock times. No repeats or reminders. */
export interface InputSpan {
  start: number
  end: number
  text: string
}
export interface DateMatch extends InputSpan {
  date: string
}
export interface TimeMatch extends InputSpan {
  time: string
  endTime?: string
}
export type ScheduleMatch = DateMatch | TimeMatch

const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const months = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]
const weekdayPattern = weekdays.map((day) => `${day}|${day.slice(0, 3)}`).join('|')
const monthPattern = months.map((month) => `${month}|${month.slice(0, 3)}`).join('|')
const repeatSchedule = new RegExp(
  `\\b(?:every|each)\\s+(?:(?:other|single|\\d+)\\s+)?(?:${weekdayPattern}|days?|weeks?|months?|years?|weekdays?|weekends?)(?:s)?\\b`,
  'iu',
)
const ordinal = '\\d{1,2}(?:st|nd|rd|th)?'
const namedDate = `(?:(?:${monthPattern})\\.? ${ordinal}|${ordinal} (?:${monthPattern})\\.?)(?:,? \\d{4})?`
const expression = new RegExp(
  `(?<![\\p{L}\\p{N}_/@.-])(?:on |due )?(?:` +
    `\\d{4}-\\d{2}-\\d{2}|${namedDate}|` +
    `(?:in \\d{1,3} (?:days?|weeks?|months?|years?))|` +
    `(?:\\d{1,3} (?:days?|weeks?|months?|years?) later)|` +
    `(?:next (?:week|month|year))|` +
    `(?:(?:next |this )?(?:${weekdayPattern}))|today|tomorrow|tod|td|tmr)` +
    `(?![\\p{L}\\p{N}_/@-]|\\.[\\p{L}\\p{N}])`,
  'giu',
)
const timeExpression =
  /(?<![\p{L}\p{N}_/@.:-])(?:@|at\s+)?(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)|\d{1,2}:\d{2})(?![\p{L}\p{N}_/@:-]|\.[\p{L}\p{N}])/giu
const timeToken = '(?:\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)|\\d{1,2}:\\d{2})'
const timeRangeExpression = new RegExp(
  `(?<![\\p{L}\\p{N}_/@.:-])(?:@|at\\s+|from\\s+)?(${timeToken})\\s*(?:to|until|[-–])\\s*(${timeToken})(?![\\p{L}\\p{N}_/@:-])`,
  'giu',
)
const timeRanges = (text: string) => [...text.matchAll(timeRangeExpression)]

function blockedSchedule(text: string) {
  if (repeatSchedule.test(text)) return true
  const candidates = [...text.matchAll(expression), ...text.matchAll(timeExpression)].sort(
    (a, b) => a.index - b.index,
  )
  // A protected date also protects its following time, rather than defaulting that time to today.
  if (
    candidates.some((candidate) =>
      /\b(?:not|remind(?:\s+me)?)\s+$/i.test(text.slice(0, candidate.index)),
    )
  )
    return true
  for (let i = 1; i < candidates.length; i++) {
    const previous = candidates[i - 1]
    const between = text.slice(previous.index + previous[0].length, candidates[i].index)
    if (
      /^\s*(?:to|through|thru|until|[-–])\s*$/i.test(between) &&
      !timeRanges(text).some(
        (range) =>
          previous.index >= range.index && candidates[i].index < range.index + range[0].length,
      )
    )
      return true
    if (/^\s*and\s*$/i.test(between) && /\bbetween\s*$/i.test(text.slice(0, previous.index)))
      return true
  }
  return false
}

function unsupportedContext(before: string, after: string) {
  return (
    /\b(?:every(?:\s+other)?|each|not|until|from|remind(?:\s+me)?)\s+$/i.test(before) ||
    /(?:\b(?:to|through|thru|until)|[-–])\s*$/i.test(before) ||
    /^\s*(?:(?:to|through|thru|until)\b|[-–])/i.test(after)
  )
}

export function recognizeTimes(text: string): TimeMatch[] {
  if (blockedSchedule(text)) return []
  const matches: TimeMatch[] = []
  const parseTime = (text: string) => {
    const parts = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(text.trim())
    if (!parts) return null
    let hour = Number(parts[1])
    const minute = Number(parts[2] ?? 0)
    if (minute > 59 || (parts[3] ? hour < 1 || hour > 12 : hour > 23)) return null
    if (parts[3]) hour = (hour % 12) + (parts[3].toLowerCase() === 'pm' ? 12 : 0)
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  }
  const ranges = timeRanges(text)
  for (const range of ranges) {
    if (unsupportedContext(text.slice(0, range.index), text.slice(range.index + range[0].length)))
      continue
    const time = parseTime(range[1]),
      endTime = parseTime(range[2])
    if (time && endTime && time !== endTime)
      matches.push({
        start: range.index,
        end: range.index + range[0].length,
        text: range[0],
        time,
        endTime,
      })
  }
  for (const match of text.matchAll(timeExpression)) {
    const start = match.index
    const end = start + match[0].length
    if (ranges.some((range) => start >= range.index && start < range.index + range[0].length))
      continue
    if (unsupportedContext(text.slice(0, start), text.slice(end))) continue
    const parts = /^(?:@|at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(match[0])!
    let hour = Number(parts[1])
    const minute = Number(parts[2] ?? 0)
    if (minute > 59 || (parts[3] ? hour < 1 || hour > 12 : hour > 23)) continue
    if (parts[3]) hour = (hour % 12) + (parts[3].toLowerCase() === 'pm' ? 12 : 0)
    matches.push({
      start,
      end,
      text: match[0],
      time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    })
  }
  return matches.sort((a, b) => a.start - b.start)
}

const calendar = (date: string) => new Date(`${date}T12:00:00Z`)
const iso = (date: Date) => date.toISOString().slice(0, 10)
function validDate(year: number, month: number, day: number) {
  if (year < 1000 || year > 9999) return null
  const date = new Date(Date.UTC(year, month, day, 12))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day
    ? iso(date)
    : null
}
function shift(reference: string, amount: number, unit: string) {
  const date = calendar(reference)
  if (unit.startsWith('day') || unit.startsWith('week')) {
    date.setUTCDate(date.getUTCDate() + amount * (unit.startsWith('week') ? 7 : 1))
  } else {
    // Calendar arithmetic clamps month ends, rather than overflowing into the following month.
    const day = date.getUTCDate()
    date.setUTCDate(1)
    date.setUTCMonth(date.getUTCMonth() + amount * (unit.startsWith('year') ? 12 : 1))
    const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
    date.setUTCDate(Math.min(day, last))
  }
  return date.getUTCFullYear() <= 9999 ? iso(date) : null
}

function resolve(text: string, reference: string): string | null {
  const phrase = text.toLowerCase().replace(/^(?:on|due) /, '')
  if (/^\d{4}-\d{2}-\d{2}$/.test(phrase)) {
    const [year, month, day] = phrase.split('-').map(Number)
    return validDate(year, month - 1, day)
  }
  if (['today', 'tod', 'td'].includes(phrase)) return reference
  if (['tomorrow', 'tmr'].includes(phrase)) return shift(reference, 1, 'day')
  const relative = /^(?:in )?(\d+) (days?|weeks?|months?|years?)(?: later)?$/.exec(phrase)
  if (relative) return shift(reference, Number(relative[1]), relative[2])
  if (/^next (week|month|year)$/.test(phrase)) return shift(reference, 1, phrase.slice(5))
  const weekday = /^(?:(next|this) )?([a-z]+)$/.exec(phrase)
  const index = weekday ? weekdays.findIndex((day) => day.startsWith(weekday[2])) : -1
  if (index !== -1) {
    const distance = (index - calendar(reference).getUTCDay() + 7) % 7
    return shift(reference, distance || (weekday![1] === 'next' ? 7 : 0), 'day')
  }
  const named =
    /^(?:([a-z]+)\.? (\d+)(?:st|nd|rd|th)?|(\d+)(?:st|nd|rd|th)? ([a-z]+)\.?)(?:,? (\d{4}))?$/.exec(
      phrase,
    )
  if (!named) return null
  const month = months.findIndex((name) => name.startsWith(named[1] ?? named[4]))
  const day = Number(named[2] ?? named[3])
  let year = Number(named[5] ?? reference.slice(0, 4))
  if (named[5]) return validDate(year, month, day)
  // Missing years use the next valid occurrence, including leap day.
  for (let attempt = 0; attempt < 8; attempt++, year++) {
    const value = validDate(year, month, day)
    if (value && value >= reference) return value
  }
  return null
}

/** Returns all valid spans. The composer uses the last non-dismissed date. */
export function recognizeDates(text: string, reference: string): DateMatch[] {
  if (blockedSchedule(text)) return []
  const matches: DateMatch[] = []
  const candidates = [...text.matchAll(expression)]
  for (const match of candidates) {
    const start = match.index
    const end = start + match[0].length
    const before = text.slice(0, start)
    const after = text.slice(end)
    if (unsupportedContext(before, after)) continue
    const date = resolve(match[0], reference)
    if (date) matches.push({ start, end, text: match[0], date })
  }
  return matches
}

/** Remove only accepted spans; a schedule-only draft still makes a useful task title. */
export function taskTitle(
  text: string,
  match: InputSpan | InputSpan[] | null,
  keepDateWords = false,
) {
  if (!match || keepDateWords) return text.trim()
  let title = text
  const spans = Array.isArray(match) ? match : [match]
  for (const span of [...spans].sort((a, b) => b.start - a.start)) {
    title = [title.slice(0, span.start).trimEnd(), title.slice(span.end).trimStart()]
      .filter(Boolean)
      .join(' ')
  }
  title = title.replace(/\s+([,.;!?])/g, '$1').trim()
  return title || text.trim()
}

/** Keep a dismissed span cancelled across edits elsewhere, but recognize replacements. */
export function moveDismissedDates<T extends InputSpan>(
  previous: string,
  next: string,
  dismissed: T[],
): T[] {
  let start = 0
  while (start < previous.length && start < next.length && previous[start] === next[start]) start++
  let oldEnd = previous.length
  let newEnd = next.length
  while (oldEnd > start && newEnd > start && previous[oldEnd - 1] === next[newEnd - 1]) {
    oldEnd--
    newEnd--
  }
  return dismissed.flatMap((match) => {
    if (match.end <= start) return [match]
    if (match.start >= oldEnd) {
      const delta = newEnd - oldEnd
      return [{ ...match, start: match.start + delta, end: match.end + delta }]
    }
    return []
  })
}
