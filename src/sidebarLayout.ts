/**
 * Sidebar customization: which views and sections show, and the order of the notes sections.
 * All notes, All projects, the Projects list and Completed/Trash always show.
 */

/** Notes sections below the fixed views, in their default order. */
export const sidebarSections = ['quick', 'notebooks', 'pdfs', 'tags'] as const
export type SidebarSection = (typeof sidebarSections)[number]
export const sidebarSectionLabels: Record<SidebarSection, string> = {
  quick: 'Quick access',
  notebooks: 'Notebooks',
  pdfs: 'PDFs',
  tags: 'Tags',
}

/** Notes views that can be hidden, with the section each belongs to (none: the top group). */
export const notesViewItems = {
  today: { label: 'Today', section: null },
  todo: { label: 'To-do', section: null },
  uncategorized: { label: 'Uncategorized', section: null },
  pinned: { label: 'Pinned notes', section: 'quick' },
  quickAccess: { label: 'Quick Access', section: 'quick' },
} as const satisfies Record<string, { label: string; section: SidebarSection | null }>

/** Task views and the task Tags section, which can be hidden in the Projects sidebar. */
export const taskViewItems = {
  'tasks:today': 'Today',
  'tasks:next7': 'Next 7 Days',
  inbox: 'Inbox',
  'tasks:summary': 'Summary',
  'tasks:calendar': 'Calendar',
  'tasks:tags': 'Tags',
} as const

export type SidebarItem = SidebarSection | keyof typeof notesViewItems | keyof typeof taskViewItems
const sidebarItems = new Set<string>([
  ...sidebarSections,
  ...Object.keys(notesViewItems),
  ...Object.keys(taskViewItems),
])

/** Saved order with unknown and repeated sections dropped and missing ones appended. */
export function normalizeSidebarOrder(value: unknown): SidebarSection[] {
  const saved = Array.isArray(value)
    ? value.filter((id): id is SidebarSection => sidebarSections.includes(id as SidebarSection))
    : []
  return [...new Set([...saved, ...sidebarSections])]
}

export function normalizeSidebarHidden(value: unknown): SidebarItem[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((id): id is SidebarItem => sidebarItems.has(id as string)))]
}

/** Moves a section one place up (-1) or down (+1); the ends stay put. */
export function moveSection(order: SidebarSection[], id: SidebarSection, delta: -1 | 1) {
  const from = order.indexOf(id)
  const to = from + delta
  if (from < 0 || to < 0 || to >= order.length) return order
  const next = [...order]
  ;[next[from], next[to]] = [next[to], next[from]]
  return next
}

/** Shows or hides one item, keeping the list free of repeats. */
export function setSidebarItemHidden(hidden: SidebarItem[], id: SidebarItem, hide: boolean) {
  const rest = hidden.filter((item) => item !== id)
  return hide ? [...rest, id] : rest
}

/** Quick access shows while it isn't hidden and at least one of its views is visible. */
export function sectionVisible(hidden: SidebarItem[], id: SidebarSection) {
  if (hidden.includes(id)) return false
  if (id === 'quick') return !hidden.includes('pinned') || !hidden.includes('quickAccess')
  return true
}
