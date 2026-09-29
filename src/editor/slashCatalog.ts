import { inkColors, highlightColors, dateFormats } from './slashOptions'
import { commands } from './commands'
export interface SlashEntry {
  id: string
  label: string
  icon: string
  command?: string
  children?: SlashEntry[]
  keywords?: string
  color?: string
  path?: string
}
const leaf = (id: string, label?: string, icon = id): SlashEntry => ({
  id,
  command: id,
  label: label ?? commands.find((c) => c.id === id)?.label ?? id,
  icon,
})
const group = (id: string, label: string, children: SlashEntry[], icon = id): SlashEntry => ({
  id,
  label,
  icon,
  children,
})
export function slashCatalog(inTable = false): SlashEntry[] {
  return [
    group(
      'headings',
      'Heading',
      [
        ...Array.from({ length: 6 }, (_, i) => ({
          ...leaf(`h${i + 1}`, `H${i + 1}`, 'heading'),
          keywords: `heading ${i + 1}`,
        })),
        leaf('paragraph', 'Normal text', 'paragraph'),
      ],
      'heading',
    ),
    group(
      'formats',
      'Format',
      ['bold', 'italic', 'underline', 'strike', 'subscript', 'superscript'].map((id) => leaf(id)),
      'bold',
    ),
    group(
      'colors',
      'Text Color',
      inkColors.map(([name, color]) => ({
        ...leaf(`ink-${name}`, name, 'color'),
        color: color ?? undefined,
      })),
      'color',
    ),
    group(
      'highlights',
      'Highlight',
      highlightColors.map(([name, color]) => ({
        ...leaf(`highlight-${name}`, name, 'highlight'),
        color: color ?? undefined,
      })),
      'highlight',
    ),
    group(
      'lists',
      'List',
      [
        leaf('task', 'Checklist', 'task'),
        leaf('bullet', 'Bullet List', 'bullet'),
        leaf('number', 'Number List', 'number'),
        leaf('indent'),
        leaf('outdent'),
        leaf('checkbox', 'Inline checkbox', 'task'),
      ],
      'bullet',
    ),
    group(
      'alignment',
      'Text Align',
      ['left', 'center', 'right', 'justify'].map((a) =>
        leaf(`align-${a}`, a[0].toUpperCase() + a.slice(1), 'align'),
      ),
      'align',
    ),
    group(
      'tables',
      'Table',
      [
        ...Array.from({ length: 9 }, (_, i) =>
          leaf(`table-${i + 2}`, `${i + 2}x${i + 2}`, 'table'),
        ),
        ...(inTable
          ? commands.filter((c) => c.context === 'table').map((c) => leaf(c.id, c.label, 'table'))
          : []),
      ],
      'table',
    ),
    group(
      'dates',
      'Date',
      dateFormats().map((label, i) => leaf(`date-${i}`, label, 'date')),
      'date',
    ),
    group(
      'times',
      'Time',
      [
        leaf(
          'time-12',
          new Date().toLocaleTimeString(undefined, {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
          }),
          'time',
        ),
        leaf(
          'time-24',
          new Date().toLocaleTimeString(undefined, {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          }),
          'time',
        ),
      ],
      'time',
    ),
    leaf('divider', 'Text Divider', 'divider'),
    leaf('collapsible', 'Collapsible Section', 'section'),
    leaf('quote', 'Quote', 'quote'),
    leaf('inline-code', 'Code', 'code'),
    leaf('code', 'Code Block', 'code-block'),
    leaf('link', 'Link', 'link'),
    leaf('image', 'Image', 'image'),
    group(
      'sections',
      'Section actions',
      ['wrap', 'unwrap', 'toggle-section', 'expand-all', 'collapse-all'].map((id) =>
        leaf(id, undefined, 'section'),
      ),
      'section',
    ),
  ]
}
export function searchSlash(entries: SlashEntry[], query: string, path = ''): SlashEntry[] {
  const normalized = query.trim().toLowerCase()
  return entries.flatMap((entry) => {
    const full = path ? `${path} / ${entry.label}` : entry.label
    if (entry.children) return searchSlash(entry.children, query, full)
    const command = commands.find((c) => c.id === entry.command)
    const text =
      `${full} ${entry.keywords ?? ''} ${command?.label ?? ''} ${command?.keywords ?? ''}`.toLowerCase()
    return normalized.split(/\s+/).every((part) => text.includes(part)) ? [{ ...entry, path }] : []
  })
}
