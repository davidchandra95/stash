import type { WritingCommand } from './commands'
export const inkColors = [
  ['Default', null],
  ['Red', '#a83432'],
  ['Orange', '#ad5b13'],
  ['Yellow', '#7b6513'],
  ['Green', '#387342'],
  ['Blue', '#216f9c'],
  ['Purple', '#7655ae'],
] as const
export const highlightColors = [
  ['None', null],
  ['Red', '#dc726033'],
  ['Orange', '#e8a84140'],
  ['Yellow', '#e3d84a45'],
  ['Green', '#64ae7040'],
  ['Blue', '#5b9cd440'],
  ['Purple', '#a885cc40'],
] as const
const pad = (n: number) => String(n).padStart(2, '0')
export function dateFormats(now = new Date()) {
  const full = now.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
  const short = now.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  const time = now.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
  const y = now.getFullYear(),
    m = pad(now.getMonth() + 1),
    d = pad(now.getDate())
  return [
    `${full} at ${time}`,
    full,
    `${short}, ${time}`,
    short,
    time,
    `${d}/${m}/${y}`,
    `${d}-${m}-${y}`,
    `${y}-${m}-${d}`,
    `${y}/${m}/${d}`,
  ]
}
export const slashExtraCommands: WritingCommand[] = [
  ...inkColors.map(([name, color]) => ({
    id: `ink-${name}`,
    label: `Text Color ${name}`,
    run: (c: Parameters<WritingCommand['run']>[0]) => (color ? c.setColor(color) : c.unsetColor()),
  })),
  ...highlightColors.map(([name, color]) => ({
    id: `highlight-${name}`,
    label: `Highlight ${name}`,
    run: (c: Parameters<WritingCommand['run']>[0]) =>
      color ? c.setHighlight({ color }) : c.unsetHighlight(),
  })),
  ...Array.from({ length: 9 }, (_, i) => ({
    id: `table-${i + 2}`,
    label: `Table ${i + 2}x${i + 2}`,
    run: (c: Parameters<WritingCommand['run']>[0]) =>
      c.insertTable({ rows: i + 2, cols: i + 2, withHeaderRow: false }),
  })),
  ...Array.from({ length: 9 }, (_, i) => ({
    id: `date-${i}`,
    label: `Date format ${i + 1}`,
    run: (c: Parameters<WritingCommand['run']>[0]) => c.insertContent(dateFormats()[i]),
  })),
  {
    id: 'time-12',
    label: 'Time 12-hour',
    run: (c) =>
      c.insertContent(
        new Date().toLocaleTimeString(undefined, {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        }),
      ),
  },
  {
    id: 'time-24',
    label: 'Time 24-hour',
    run: (c) =>
      c.insertContent(
        new Date().toLocaleTimeString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }),
      ),
  },
  { id: 'indent', label: 'Indent', run: (c) => c.sinkListItem('mixedListItem') },
  { id: 'outdent', label: 'Outdent', run: (c) => c.liftListItem('mixedListItem') },
]
