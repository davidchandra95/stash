import { expect, it } from 'vitest'
import { moveDismissedDates, recognizeDates, recognizeTags, recognizeTimes, taskTitle } from './smartInput'

const reference = '2026-11-03' // Tuesday, independent of the machine's time zone.
const dates = (text: string, day = reference) =>
  recognizeDates(text, day).map((match) => match.date)

it.each([
  ['Buy milk today', '2026-11-03'],
  ['Buy milk tod', '2026-11-03'],
  ['Buy milk td', '2026-11-03'],
  ['Meet TOMORROW', '2026-11-04'],
  ['Call tmr', '2026-11-04'],
  ['Meet Tuesday', '2026-11-03'],
  ['Meet next Tuesday', '2026-11-10'],
  ['Meet Monday', '2026-11-09'],
  ['Meet next Monday', '2026-11-09'],
  ['Meet this Fri', '2026-11-06'],
  ['Ship in 2 days', '2026-11-05'],
  ['Ship 2 weeks later', '2026-11-17'],
  ['Review next week', '2026-11-10'],
  ['Review next month', '2026-12-03'],
  ['Review next year', '2027-11-03'],
  ['Meet on 2026-12-05', '2026-12-05'],
  ['Meet due Nov 12', '2026-11-12'],
  ['Meet 6 March', '2027-03-06'],
  ['Meet Mar. 6th, 2028', '2028-03-06'],
  ['Meet 2nd Jan 2027', '2027-01-02'],
  ['Meet February 29', '2028-02-29'],
])('recognizes %s', (text, date) => expect(dates(text)).toEqual([date]))

it.each([
  'Review someday',
  'Implement todayView',
  'Email tomorrow@example.com',
  'Open /tomorrow/file',
  'Open https://today.test',
  'Fix feature-tomorrow',
  'Call @2pm',
  'Meet at 9am',
  'Call in 2 hours',
  'Repeat every day',
  'Water every Monday at 9am',
  'Water each Monday',
  'Water every other Monday',
  'Water plants every Monday and Friday',
  'Water every single Monday and Friday',
  'Water every 2 weeks on Monday and Friday',
  'Water each Monday, Wednesday and Friday',
  'Remind me tomorrow',
  'Remind tomorrow',
  'Remind me tomorrow at 9am',
  'Not tomorrow @2pm',
  'Not tomorrow',
  'Meet Monday to Friday',
  'Vacation Monday through Friday',
  'Vacation Monday thru Friday',
  'Vacation from Monday until Friday',
  'Vacation between Monday and Friday',
  'Meet Nov 3 - Nov 5',
  'Fix 2026-02-30',
  'Fix 2027-02-29',
  'Meet 31 April',
  'Fix 2026-13-02',
  'Meet 11/12/2026',
  'Fix 2026-11-031',
])('leaves unsupported or ambiguous text unchanged: %s', (text) => {
  expect(dates(text)).toEqual([])
  expect(taskTitle(text, null)).toBe(text)
})

it('uses calendar arithmetic over midnight, year ends, leap days and DST dates', () => {
  expect(dates('tomorrow', '2026-12-31')).toEqual(['2027-01-01'])
  expect(dates('tomorrow', '2028-02-28')).toEqual(['2028-02-29'])
  expect(dates('tomorrow', '2026-03-08')).toEqual(['2026-03-09'])
  expect(dates('tomorrow', '2026-11-01')).toEqual(['2026-11-02'])
  expect(dates('in 1 month', '2026-01-31')).toEqual(['2026-02-28'])
  expect(dates('in 1 year', '2028-02-29')).toEqual(['2029-02-28'])
  expect(dates('tomorrow', '9999-12-31')).toEqual([])
})

it('keeps exact span offsets and removes only the accepted words', () => {
  const text = 'Meet tomorrow at 9am'
  const [match] = recognizeDates(text, reference)
  expect(match).toEqual({ start: 5, end: 13, text: 'tomorrow', date: '2026-11-04' })
  expect(taskTitle(text, match)).toBe('Meet at 9am')
  expect(taskTitle(text, match, true)).toBe(text)
  expect(taskTitle('tomorrow', recognizeDates('tomorrow', reference)[0])).toBe('tomorrow')
  const other = 'Draft today, review tomorrow'
  expect(taskTitle(other, recognizeDates(other, reference).at(-1)!)).toBe('Draft today, review')
})

it('still recognizes a date when every describes the work, rather than a schedule', () => {
  expect(dates('Review every contract tomorrow')).toEqual(['2026-11-04'])
})

it('preserves cancellation across edits elsewhere and recognizes a changed date phrase', () => {
  const text = 'Meet tomorrow'
  const [match] = recognizeDates(text, reference)
  const moved = moveDismissedDates(text, 'Please meet tomorrow', [match])
  expect(moved[0]).toMatchObject({ start: 12, end: 20, text: 'tomorrow' })
  expect(moveDismissedDates(text, 'Meet tomorrow please', [match])).toEqual([match])
  expect(moveDismissedDates(text, 'Meet Friday', [match])).toEqual([])
  expect(moveDismissedDates(text, '', [match])).toEqual([])
})

it.each([
  ['Throw trash @2pm', '14:00'],
  ['Meet tomorrow at 9am', '09:00'],
  ['Meet @2:30PM', '14:30'],
  ['Meet 2 pm', '14:00'],
  ['Meet at 14:30', '14:30'],
  ['Meet @00:00', '00:00'],
  ['Meet @12am', '00:00'],
  ['Meet @12pm', '12:00'],
  ['Meet 23:59.', '23:59'],
])('recognizes time in %s', (text, time) => {
  expect(recognizeTimes(text).map((match) => match.time)).toEqual([time])
})

it.each([
  'Meet @0pm',
  'Meet @13pm',
  'Meet @24:00',
  'Meet @2:99pm',
  'Meet @2:5pm',
  'Meet @2p',
  'Email person@2pm.com',
  'Visit https://site/2pm',
  'Fix test2pm',
  'Repeat every Monday at 9am',
  'Repeat every Monday and Friday at 9am',
  'Meet @2pm-@3pm',
  'Meet between 9am and 10am',
  'Meet Monday through Friday at 9am',
  'Remind me at 9am',
  'Remind me tomorrow at 9am',
  'Not tomorrow @2pm',
  'Not @2pm',
])('leaves unsupported or invalid times literal: %s', (text) => {
  expect(recognizeTimes(text)).toEqual([])
})

it('keeps separate date and time spans and removes only the accepted ones', () => {
  const text = 'Meet tomorrow at 9am'
  const [date] = recognizeDates(text, reference)
  const [time] = recognizeTimes(text)
  expect(time).toEqual({ start: 14, end: 20, text: 'at 9am', time: '09:00' })
  expect(taskTitle(text, [date, time])).toBe('Meet')
  expect(taskTitle(text, [time])).toBe('Meet tomorrow')
  expect(taskTitle(text, [date])).toBe('Meet at 9am')
  expect(taskTitle(text, [date, time], true)).toBe(text)
  expect(taskTitle('@2pm', recognizeTimes('@2pm'))).toBe('@2pm')
  expect(moveDismissedDates(text, 'Please meet tomorrow at 9am', [time])[0]).toMatchObject({
    start: 21,
    end: 27,
    time: '09:00',
  })
})

it('keeps an unsupported reminder offset literal after a separate supported date and time', () => {
  const text = 'Review report tomorrow at 3pm remind me 30 minutes earlier'
  const dates = recognizeDates(text, reference)
  const times = recognizeTimes(text)
  expect(dates.map((match) => match.date)).toEqual(['2026-11-04'])
  expect(times.map((match) => match.time)).toEqual(['15:00'])
  expect(taskTitle(text, [...dates, ...times])).toBe('Review report remind me 30 minutes earlier')
})

it.each([
  ['Meet 9am to 10am', '09:00', '10:00'],
  ['Work from 14:15 until 15:30', '14:15', '15:30'],
  ['Work @11pm-1am', '23:00', '01:00'],
])('recognizes a time range in %s', (text, time, endTime) => {
  expect(recognizeTimes(text)).toEqual([expect.objectContaining({ time, endTime })])
  expect(taskTitle(text, recognizeTimes(text))).toMatch(/^(Meet|Work)$/)
})

it('recognizes #tags, leaving numbers and URL fragments as text', () => {
  const names = (text: string) => recognizeTags(text).map((match) => match.tag)
  expect(names('Call vendor #Work tomorrow #home.')).toEqual(['work', 'home'])
  expect(names('Fix bug #123')).toEqual([])
  expect(names('See example.com/#intro')).toEqual([])
  expect(names('No tags here')).toEqual([])
  const [match] = recognizeTags('Call #work now')
  expect(taskTitle('Call #work now', match)).toBe('Call now')
})
