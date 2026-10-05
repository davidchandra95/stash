import type { ShortcutOverrides } from './shortcuts'
import { richWritingFixture } from './editor/fixtures'
import type { JSONContent } from '@tiptap/react'
import { generateText } from '@tiptap/core'
import { normalizeContent } from './editor/clipboard'
import { writingExtensions } from './editor/extensions'
import type { CursorSettings } from './editor/cursor'
import { tagFooter, tagsFromText } from './tags'
import type { HeadingStyles } from './headingStyles'

export type {
  CursorBlinking,
  CursorSettings,
  CursorSmoothCaretAnimation,
  CursorStyle,
} from './editor/cursor'

export interface Note {
  id: string
  title: string
  notebookIds: string[]
  quickAccess: boolean
  tags: string[]
  content: JSONContent
  text: string
  pinned: boolean
  trashed: boolean
  hasTasks?: boolean
  updated: number
  source?: FileSource | null
}
export interface FileSource {
  rootId: string
  relativePath: string
  fingerprint: string
  unavailable?: string | null
  trashPath?: string | null
  markdown?: string
}
export interface LinkedRoot {
  id: string
  path: string
  error?: string | null
}
export interface Notebook {
  id: string
  name: string
  color: string
  icon: NotebookIcon
  parentId?: string | null
  rootId?: string | null
  relativePath?: string | null
}
export type NotebookIcon =
  | 'notebook'
  | 'book'
  | 'folder'
  | 'briefcase'
  | 'graduationCap'
  | 'home'
  | 'heart'
  | 'star'
  | 'lightbulb'
  | 'target'
  | 'plane'
  | 'archive'
  | 'calendar'
  | 'camera'
  | 'coffee'
  | 'dumbbell'
  | 'flag'
  | 'gamepad'
  | 'globe'
  | 'mapPin'
  | 'music'
  | 'palette'
  | 'penLine'
  | 'shoppingBag'
export type View =
  | 'all'
  | 'today'
  | 'todo'
  | 'uncategorized'
  | 'pinned'
  | 'quickAccess'
  | 'trash'
  | `book:${string}`
  | `tag:${string}`

export interface Appearance extends CursorSettings {
  shortcuts?: ShortcutOverrides
  appStyle: 'default' | 'cards'
  animationsEnabled: boolean
  theme:
    'classic' | 'zen' | 'financial' | 'tiktok' | 'catppuccin' | 'lastchat' | 'qrafthive' | 'aster'
  dark: boolean
  uiFont: string
  titleFont: string
  noteFont: string
  codeFont: string
  headingStyles: HeadingStyles
  size: number
  width: number
  lineSpacing: number
  paragraphSpacing: number
  listItemSpacing: number
  editorBottomSpace: number
}
const now = Date.now()
export const initialNotebooks: Notebook[] = [
  { id: 'personal', name: 'Personal', color: '#82936f', icon: 'notebook' },
  { id: 'work', name: 'Work', color: '#899ab4', icon: 'briefcase' },
  { id: 'learning', name: 'Learning', color: '#ba9775', icon: 'graduationCap' },
]
const sample = (
  id: string,
  title: string,
  notebook: string,
  tags: string[],
  content: string,
  pinned = false,
  days = 0,
): Note => {
  const normalized = normalizeContent(
    tags.length ? `${content}<p>${tagFooter(tags)}</p>` : content,
    writingExtensions,
  )
  const text = generateText(normalized, writingExtensions)
  return {
    id,
    title,
    notebookIds: notebook ? [notebook] : [],
    quickAccess: false,
    tags: tagsFromText(text),
    content: normalized,
    pinned,
    trashed: false,
    text,
    updated: now - days * 86400000,
  }
}
export const initialNotes: Note[] = [
  sample('writing-lab', 'A garden journal', 'learning', ['writing', 'ideas'], richWritingFixture),
  sample(
    'welcome',
    'A little room to think',
    'personal',
    ['ideas', 'writing'],
    `<p>A place for the things you want to remember, the ideas you are still working through, and the occasional very good sentence.</p><h2>Make yourself at home</h2><p>This is your working notebook. Start with a thought, turn it into a list, or give it a little structure. There is no right way to begin.</p><blockquote><p>Keep the tools quiet. Give the ideas room.</p></blockquote><h2>A few things to try</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Find a comfortable writing space</p></li><li data-type="taskItem" data-checked="false"><p>Choose a different font for your notes</p></li><li data-type="taskItem" data-checked="false"><p>Add a table or a snippet of code</p></li></ul><p>Open <strong>Settings</strong> to make the writing area yours. Your interface, notes, and code each have their own font.</p><hr><p><em>Sample content for exploring your notebook.</em></p>`,
    true,
  ),
  sample(
    'week',
    'The week ahead',
    'personal',
    ['planning'],
    '<p>A little less rushing, a little more intention.</p><h2>Make time for</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Read a chapter before opening the laptop</p></li><li data-type="taskItem" data-checked="false"><p>Take a long walk without a destination</p></li><li data-type="taskItem" data-checked="true"><p>Clear a little space on the desk</p></li></ul>',
    false,
    1,
  ),
  sample(
    'design',
    'Notes on a quieter interface',
    'work',
    ['design', 'ideas'],
    '<p>The best interface helps you find your place and then gets out of the way.</p><h2>Principles</h2><ul><li><p>Give every control a clear purpose.</p></li><li><p>Keep navigation compact and writing generous.</p></li><li><p>Let typography do the organizing.</p></li></ul><h2>Small decisions</h2><table><tbody><tr><th><p>Area</p></th><th><p>Direction</p></th></tr><tr><td><p>Navigation</p></td><td><p>Compact and familiar</p></td></tr><tr><td><p>Editor</p></td><td><p>Comfortable, with a quiet toolbar</p></td></tr><tr><td><p>Color</p></td><td><p>One subtle accent</p></td></tr></tbody></table>',
    true,
  ),
  sample(
    'code',
    'Useful little snippets',
    'learning',
    ['code'],
    '<p>A small collection of patterns worth keeping close.</p><h2>A friendly greeting</h2><pre><code class="language-typescript">type Person = { name: string }\n\nfunction greet(person: Person): string {\n  return `Hello, ${person.name}.`\n}</code></pre><p>Select a code language from the toolbar while your cursor is inside the block.</p><h2>Things to remember</h2><ul><li><p>Prefer clarity over cleverness.</p></li><li><p>Keep the examples small enough to understand.</p></li></ul>',
    false,
    2,
  ),
  sample(
    'reading',
    'Between the pages',
    'personal',
    ['reading'],
    '<p>Sometimes a book gives you a new thought. Sometimes it gives a name to a thought you already had.</p><blockquote><p>A notebook is a conversation with your future self.</p></blockquote><h2>To come back to</h2><p>What makes an ordinary day feel well spent?</p>',
    false,
    3,
  ),
  sample(
    'meeting',
    'Monday catch-up',
    'work',
    ['planning'],
    '<h2>What we talked about</h2><p>Start with the writing experience. Try the small interactions before adding more features.</p><h2>Next steps</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Review tables and code editing</p></li><li data-type="taskItem" data-checked="false"><p>Try the light and dark appearances</p></li></ul>',
    false,
    1,
  ),
  sample(
    'scratch',
    'Something worth remembering',
    '',
    ['ideas'],
    '<p>Leave room for the unexpected.</p>',
    false,
    4,
  ),
]
export function hasTasks(note: Note): boolean {
  return note.hasTasks ?? /"kind":"task"|"type":"inlineCheckbox"/.test(JSON.stringify(note.content))
}
export function matchesView(note: Note, view: View): boolean {
  if (view === 'trash') return note.trashed
  if (note.trashed) return false
  if (view === 'pinned') return note.pinned
  if (view === 'quickAccess') return note.quickAccess
  if (view === 'uncategorized') return !note.notebookIds.length
  if (view === 'todo') return hasTasks(note)
  if (view === 'today') return new Date(note.updated).toDateString() === new Date().toDateString()
  if (view.startsWith('book:')) return note.notebookIds.includes(view.slice(5))
  if (view.startsWith('tag:')) return note.tags.includes(view.slice(4))
  return true
}
