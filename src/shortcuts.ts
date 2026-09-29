export type ShortcutCategory = 'Application' | 'Navigation' | 'Notes' | 'Writing'
export interface ShortcutCommand {
  id: string
  label: string
  description: string
  category: ShortcutCategory
  defaultKey: string | null
  scope: 'app' | 'editor'
}
const group = (
  category: ShortcutCategory,
  rows: [string, string, string, string | null][],
): ShortcutCommand[] =>
  rows.map(([id, label, description, defaultKey]) => ({
    id,
    label,
    description,
    defaultKey,
    category,
    scope: category === 'Writing' ? 'editor' : 'app',
  }))
export const shortcutCommands: ShortcutCommand[] = [
  ...group('Application', [
    ['new-note', 'New note', 'Create a note in the current location.', 'Mod+n'],
    [
      'search',
      'Search all notes',
      'Search titles, text, and tags across notebooks.',
      'Mod+Shift+f',
    ],
    ['settings', 'Open Settings', 'Customize Stash.', 'Mod+,'],
  ]),
  ...group('Navigation', [
    ['find', 'Find in current note', 'Search the active note.', 'Mod+f'],
    ['sidebar', 'Toggle sidebar', 'Show or hide notebook navigation.', 'Mod+Shift+d'],
    ['focus', 'Toggle focus mode', 'Show or hide the surrounding workspace.', 'Mod+Shift+Enter'],
    ['contents', 'Toggle table of contents', 'Show or hide the active note outline.', 'Mod+Alt+o'],
    ['editor', 'Focus note editor', 'Move keyboard focus to the note body.', 'Mod+Alt+e'],
    ['title', 'Focus note title', 'Move keyboard focus to the note title.', 'Mod+Alt+t'],
    ['back', 'Go back', 'Return to the previous note in this tab.', 'Mod+['],
    ['forward', 'Go forward', 'Open the next note in this tab history.', 'Mod+]'],
    ['next-tab', 'Next tab', 'Select the next open tab.', 'Ctrl+Tab'],
    ['previous-tab', 'Previous tab', 'Select the previous open tab.', 'Ctrl+Shift+Tab'],
    ['close-tab', 'Close current tab', 'Close the active note tab.', 'Mod+w'],
  ]),
  ...group('Notes', [
    ['pin', 'Pin / unpin note', 'Toggle pinning for the active note.', 'Mod+Alt+p'],
    ['duplicate', 'Duplicate note', 'Create a copy of the active note.', null],
    ['trash', 'Move note to Trash', 'Move the active note to Trash.', null],
    ['move', 'Move note to notebook', 'Choose a notebook for the active note.', null],
    ['copy-link', 'Copy internal note link', 'Copy a link to the active note.', null],
  ]),
  ...group('Writing', [
    ['bold', 'Bold', 'Toggle bold text.', 'Mod+b'],
    ['italic', 'Italic', 'Toggle italic text.', 'Mod+i'],
    ['underline', 'Underline', 'Toggle underlined text.', 'Mod+u'],
    ['link', 'Insert or edit link', 'Add or edit a link at the selection.', 'Mod+k'],
    ...([1, 2, 3, 4, 5, 6].map((n) => [
      `h${n}`,
      `Heading ${n}`,
      `Change the current block to heading ${n}.`,
      `Mod+Alt+${n}`,
    ]) as [string, string, string, string][]),
    ['paragraph', 'Normal paragraph', 'Change the current block to normal text.', 'Mod+Alt+0'],
    ['bullet', 'Bullet list', 'Change the current list to bullets.', 'Mod+7'],
    ['number', 'Numbered list', 'Change the current list to numbers.', 'Mod+8'],
    ['task', 'Checklist', 'Change the current list to a checklist.', 'Mod+9'],
    ['strike', 'Strikethrough', 'Toggle struck-through text.', null],
    ['highlight', 'Highlight', 'Toggle highlighting on selected text.', null],
    ['inline-code', 'Inline code', 'Toggle inline code formatting.', null],
    [
      'toggle-section',
      'Toggle collapsible section',
      'Expand or collapse the current section.',
      'Mod+.',
    ],
    [
      'expand-all',
      'Expand all sections',
      'Expand every collapsible section in the note.',
      'Mod+Shift+.',
    ],
    [
      'collapse-all',
      'Collapse all sections',
      'Collapse every collapsible section in the note.',
      'Mod+Shift+,',
    ],
  ]),
]
export type ShortcutOverrides = Record<string, string | null>
export const bindingFor = (id: string, overrides: ShortcutOverrides = {}) =>
  Object.hasOwn(overrides, id)
    ? overrides[id]
    : (shortcutCommands.find((c) => c.id === id)?.defaultKey ?? null)

// These remain owned by the platform or contextual editor keymaps.
export const reservedShortcuts: Record<string, string> = {
  'Mod+ArrowLeft': 'Move to line start',
  'Mod+ArrowRight': 'Move to line end',
  'Mod+ArrowUp': 'Move to document start',
  'Mod+ArrowDown': 'Move to document end',
  'Mod+Shift+ArrowLeft': 'Select to line start',
  'Mod+Shift+ArrowRight': 'Select to line end',
  'Mod+Shift+ArrowUp': 'Select to document start',
  'Mod+Shift+ArrowDown': 'Select to document end',
  'Alt+ArrowLeft': 'Move to previous word',
  'Alt+ArrowRight': 'Move to next word',
  'Alt+Shift+ArrowLeft': 'Select previous word',
  'Alt+Shift+ArrowRight': 'Select next word',
  'Mod+Backspace': 'Delete to line start',
  'Alt+Backspace': 'Delete previous word',
  'Ctrl+a': 'Move to line start',
  'Ctrl+e': 'Move to line end',
  'Ctrl+h': 'Delete previous character',
  'Ctrl+d': 'Delete next character',
  'Ctrl+k': 'Delete to line end',
  'Ctrl+t': 'Transpose characters',
  'Ctrl+b': 'Move left',
  'Ctrl+f': 'Move right',
  'Ctrl+p': 'Move up',
  'Ctrl+n': 'Move down',
  'Mod+c': 'Copy',
  'Mod+x': 'Cut',
  'Mod+v': 'Paste',
  'Mod+Shift+v': 'Paste plain text',
  'Mod+a': 'Select all',
  'Mod+z': 'Undo',
  'Mod+Shift+z': 'Redo',
  'Mod+y': 'Redo',
  'Mod+q': 'Quit',
  'Mod+h': 'Hide application',
  'Mod+Alt+h': 'Hide other applications',
  'Mod+m': 'Minimize window',
  'Mod+Tab': 'Switch application',
  'Mod+Space': 'System search',
  'Ctrl+Space': 'Input source',
  'Ctrl+Alt+Space': 'Input source',
  'Mod+Enter': 'Exit current block',
  'Mod+Alt+c': 'Code block',
  'Mod+Shift+b': 'Quote',
  'Mod+Shift+7': 'Numbered list',
  'Mod+Shift+8': 'Bullet list',
  'Mod+Shift+l': 'Align left',
  'Mod+Shift+e': 'Align center',
  'Mod+Shift+r': 'Align right',
  'Mod+Shift+j': 'Justify',
}
export const legacyEditorKeys = ['Mod+Shift+s', 'Mod+Shift+h', 'Mod+e']
const punctuation: Record<string, string> = {
  Period: '.',
  Comma: ',',
  BracketLeft: '[',
  BracketRight: ']',
  Slash: '/',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Minus: '-',
  Equal: '=',
  Backquote: '`',
}
export function eventBinding(event: KeyboardEvent, mac: boolean): string | null {
  if (['Meta', 'Control', 'Alt', 'Shift', 'Dead', 'Unidentified', 'Process'].includes(event.key))
    return null
  let key = event.key.length === 1 ? event.key.toLowerCase() : event.key
  // Option produces alternate characters on macOS. Store the underlying key.
  if (/^Key[A-Z]$/.test(event.code)) key = event.code.slice(3).toLowerCase()
  else if (/^Digit[0-9]$/.test(event.code)) key = event.code.slice(5)
  else if (punctuation[event.code]) key = punctuation[event.code]
  else if (key === '>') key = '.'
  else if (key === '<') key = ','
  if (key === ' ') key = 'Space'
  const parts: string[] = []
  if (event.metaKey) parts.push(mac ? 'Mod' : 'Meta')
  if (event.ctrlKey) parts.push(mac ? 'Ctrl' : 'Mod')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  return [...parts, key].join('+')
}
export const platformBinding = (key: string, mac: boolean) =>
  mac ? key : key.replace(/^Ctrl\+/, 'Mod+')
export function matchesBinding(event: KeyboardEvent, binding: string | null, mac: boolean) {
  return !!binding && eventBinding(event, mac) === platformBinding(binding, mac)
}
export function shortcutLabel(binding: string | null, mac = true): string {
  if (!binding) return 'Unassigned'
  return binding
    .split('+')
    .map(
      (k) =>
        ({
          Mod: mac ? '⌘' : 'Ctrl',
          Ctrl: mac ? '⌃' : 'Ctrl',
          Meta: '⌘',
          Alt: mac ? '⌥' : 'Alt',
          Shift: mac ? '⇧' : 'Shift',
          Space: 'Space',
        })[k] ?? (k.length === 1 ? k.toUpperCase() : k),
    )
    .join(mac ? '' : '+')
}
export function bindingError(
  id: string,
  binding: string,
  overrides: ShortcutOverrides,
  mac = true,
): string | null {
  if (!/^(Mod|Ctrl|Alt|Meta)\+/.test(binding)) return 'Include Command, Control, or Option.'
  if (!supportedBinding.test(binding)) return 'This key combination is not supported.'
  const canonical = platformBinding(binding, mac)
  const reserved = Object.entries(reservedShortcuts).find(
    ([key]) =>
      (mac || (!key.startsWith('Ctrl+') && key !== 'Mod+Tab')) &&
      platformBinding(key, mac) === canonical,
  )
  if (reserved) return `Reserved for ${reserved[1]}.`
  const other = shortcutCommands.find(
    (c) =>
      c.id !== id &&
      bindingFor(c.id, overrides) &&
      platformBinding(bindingFor(c.id, overrides)!, mac) === canonical,
  )
  return other ? `Already used by ${other.label}. Clear or change that shortcut first.` : null
}
const supportedBinding =
  /^(?:(?:Mod|Ctrl|Alt|Meta|Shift)\+)+(?:[a-z0-9.,\[\]\/\\;'`=\-]|Enter|Tab|Space|Backspace|Delete|Escape|Arrow(?:Left|Right|Up|Down)|Home|End|PageUp|PageDown|F\d{1,2})$/
export function normalizeOverrides(value: unknown): ShortcutOverrides {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: ShortcutOverrides = {}
  for (const c of shortcutCommands) {
    const key = (value as ShortcutOverrides)[c.id]
    if (key === null || (typeof key === 'string' && supportedBinding.test(key))) result[c.id] = key
  }
  // Validate against the entire candidate map so swapped bindings stay valid.
  for (const [id, key] of Object.entries(result))
    if (key && bindingError(id, key, result)) result[id] = null
  return result
}
