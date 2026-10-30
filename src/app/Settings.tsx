import * as Dialog from '@radix-ui/react-dialog'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import FontPicker from '../components/FontPicker'
import HeadingStyles from '../components/HeadingStyles'
import KeyboardShortcuts from '../components/KeyboardShortcuts'
import {
  accentColors,
  accents,
  autoSyncIntervals,
  autoSyncLabel,
  colorModes,
  layoutNames,
  layouts,
  newNoteTitles,
} from '../appearance'
import { notebookPath, orderedNotebooks } from '../notebooks'
import { fontFamily } from '../fonts'
import {
  Keyboard,
  Palette,
  PenLine,
  RefreshCw,
  Search,
  Type,
  X,
  type IconComponent,
} from '../icons'
import type { Appearance, ColorMode, NewNoteTitle } from '../model'
import { useMotionEnabled, useReducedMotion } from '../motion'
import { noteListModes, type NoteListMode } from '../noteListPresentation'
import { platform } from '../platform'
import { shortcutCommands } from '../shortcuts'
import { library, useLibrarySelector } from '../storage/useLibrary'

type Category = 'appearance' | 'typography' | 'editor' | 'shortcuts' | 'sync'

const categories: { id: Category; label: string; icon: IconComponent; color: string }[] = [
  { id: 'appearance', label: 'Appearance', icon: Palette, color: '#007aff' },
  { id: 'typography', label: 'Typography', icon: Type, color: '#f7821b' },
  { id: 'editor', label: 'Editor', icon: PenLine, color: '#4fa83a' },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard, color: '#8c8c8c' },
  { id: 'sync', label: 'Sync', icon: RefreshCw, color: '#30b0c7' },
]

function Switch({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      className="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  )
}

function Row({
  label,
  description,
  children,
  stacked,
}: {
  label: string
  description?: ReactNode
  children: ReactNode
  stacked?: boolean
}) {
  return (
    <div className={`settings-row ${stacked ? 'is-stacked' : ''}`}>
      <span className="settings-label">
        {label}
        {description && <small>{description}</small>}
      </span>
      <span className="settings-control">{children}</span>
    </div>
  )
}

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  format,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  format: (value: number) => string
  onChange: (value: number) => void
}) {
  return (
    <span className="settings-slider">
      <input
        className="slider"
        type="range"
        aria-label={label}
        aria-valuetext={format(value)}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <output className="tabular">{format(value)}</output>
    </span>
  )
}

type Item = {
  id: string
  category: Category
  group: string
  search: string
  content: ReactNode
}

function useInstalledFonts(open: boolean) {
  const [installed, setInstalled] = useState<string[]>([])
  const [status, setStatus] = useState('')
  useEffect(() => {
    if (!open) return
    let cancelled = false
    if (!isTauri()) {
      setStatus('Installed fonts are available in the Mac app.')
      return
    }
    setStatus('Loading installed fonts…')
    invoke<string[]>('installed_fonts')
      .then((names) => {
        if (cancelled) return
        const sorted = [...new Set(names)].sort((a, b) => a.localeCompare(b))
        setInstalled(sorted)
        setStatus(sorted.length ? '' : 'No installed fonts were found.')
      })
      .catch(() => {
        if (!cancelled) setStatus('Couldn’t load installed fonts. Reopen Settings to try again.')
      })
    return () => {
      cancelled = true
    }
  }, [open])
  return { installed, status }
}

const serifFonts = [
  { value: 'system', label: 'System' },
  { value: 'georgia', label: 'Georgia' },
  { value: 'palatino', label: 'Palatino' },
  { value: 'helvetica', label: 'Helvetica Neue' },
  { value: 'avenir', label: 'Avenir Next' },
]
const codeFonts = [
  { value: 'sf-mono', label: 'SF Mono' },
  { value: 'menlo', label: 'Menlo' },
  { value: 'monaco', label: 'Monaco' },
  { value: 'courier', label: 'Courier New' },
]

export default function Settings({
  open,
  onOpenChange,
  value,
  onChange,
  initialCategory = 'appearance',
  syncSettings,
  onSync,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  value: Appearance
  onChange: (value: Appearance) => void
  initialCategory?: 'appearance' | 'sync'
  syncSettings?: ReactNode
  onSync: () => void
}) {
  const [category, setCategory] = useState<Category>('appearance')
  const [query, setQuery] = useState('')
  const [shortcutQuery, setShortcutQuery] = useState('')
  const content = useRef<HTMLDivElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const drag = useRef<{
    pointer: number
    x: number
    y: number
    offset: { x: number; y: number }
    bounds: DOMRect
  } | null>(null)
  const motionActive = useMotionEnabled()
  const reducedMotion = useReducedMotion()
  const fonts = useInstalledFonts(open)
  const listMode = useLibrarySelector((state) => state.workspace?.noteListMode ?? 'compact')
  const syncStatus = useLibrarySelector((state) => state.syncStatus)
  const syncing = useLibrarySelector((state) => state.syncing)
  const notebooks = useLibrarySelector((state) => state.notebooks)
  const defaultNotebookId = notebooks.some((book) => book.id === value.defaultNotebookId)
    ? value.defaultNotebookId
    : ''

  useEffect(() => {
    if (!open) return
    setCategory(initialCategory)
    setQuery('')
    setShortcutQuery('')
    setOffset({ x: 0, y: 0 })
  }, [open, initialCategory])
  useEffect(() => {
    if (content.current) content.current.scrollTop = 0
  }, [category, query])

  // The title bars move the window like a native one, keeping it fully inside the app window.
  const dragHandle = {
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      if (event.button !== 0 || (event.target as Element).closest('button, input, a')) return
      const bounds = panel.current?.getBoundingClientRect()
      if (!bounds) return
      drag.current = {
        pointer: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        offset,
        bounds,
      }
      event.currentTarget.setPointerCapture(event.pointerId)
      event.preventDefault()
    },
    onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
      const start = drag.current
      if (!start || start.pointer !== event.pointerId) return
      const { bounds } = start
      const dx = Math.max(
        -bounds.left,
        Math.min(window.innerWidth - bounds.right, event.clientX - start.x),
      )
      const dy = Math.max(
        -bounds.top,
        Math.min(window.innerHeight - bounds.bottom, event.clientY - start.y),
      )
      setOffset({ x: start.offset.x + dx, y: start.offset.y + dy })
    },
    onPointerUp: (event: React.PointerEvent<HTMLElement>) => {
      drag.current = null
      event.currentTarget.releasePointerCapture(event.pointerId)
    },
    onLostPointerCapture: () => {
      drag.current = null
    },
  }

  const set = <K extends keyof Appearance>(key: K, next: Appearance[K]) =>
    onChange({ ...value, [key]: next })
  const nativeMac = isTauri() && platform.platform === 'macos'

  const items: Item[] = [
    {
      id: 'color-mode',
      category: 'appearance',
      group: '',
      search: 'Appearance color mode light dark auto system theme',
      content: (
        <Row label="Appearance">
          <span className="mode-options" role="radiogroup" aria-label="Appearance">
            {(Object.keys(colorModes) as ColorMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={value.colorMode === mode}
                className="mode-option"
                onClick={() => set('colorMode', mode)}
              >
                <span className={`mode-preview is-${mode}`} aria-hidden="true">
                  <i />
                </span>
                {colorModes[mode]}
              </button>
            ))}
          </span>
        </Row>
      ),
    },
    {
      id: 'accent',
      category: 'appearance',
      group: '',
      search: 'Accent color highlight selection blue purple pink red orange yellow green graphite',
      content: (
        <Row
          label="Accent color"
          description={value.accent === 'system' ? 'Follows your macOS accent color' : undefined}
        >
          <span className="accent-options" role="radiogroup" aria-label="Accent color">
            <button
              type="button"
              role="radio"
              className="accent-option is-system"
              aria-label="Multicolor (follow macOS)"
              aria-checked={value.accent === 'system'}
              onClick={() => set('accent', 'system')}
            />
            {accentColors.map((accent) => (
              <button
                key={accent}
                type="button"
                role="radio"
                className="accent-option"
                aria-label={accents[accent].label}
                aria-checked={value.accent === accent}
                style={{ '--swatch': accents[accent].light } as React.CSSProperties}
                onClick={() => set('accent', accent)}
              />
            ))}
          </span>
        </Row>
      ),
    },
    {
      id: 'translucent-sidebar',
      category: 'appearance',
      group: 'Window',
      search: 'Translucent sidebar transparency vibrancy desktop',
      content: (
        <Row
          label="Translucent sidebar"
          description={nativeMac ? undefined : 'Available in the Mac app'}
        >
          <Switch
            label="Translucent sidebar"
            checked={value.translucentSidebar}
            disabled={!nativeMac}
            onChange={(checked) => set('translucentSidebar', checked)}
          />
        </Row>
      ),
    },
    {
      id: 'layout',
      category: 'appearance',
      group: 'Window',
      search: 'Layout cards panels modern standard rounded',
      content: (
        <Row label="Layout" description="Cards floats the notes list and editor as panels">
          <span className="segmented" role="radiogroup" aria-label="Layout">
            {layouts.map((layout) => (
              <button
                key={layout}
                type="button"
                role="radio"
                aria-checked={value.layout === layout}
                onClick={() => set('layout', layout)}
              >
                {layoutNames[layout]}
              </button>
            ))}
          </span>
        </Row>
      ),
    },
    {
      id: 'note-list',
      category: 'appearance',
      group: 'Window',
      search: 'Note list compact preview text line',
      content: (
        <Row label="Note list" description="Preview adds a line of note text">
          <select
            className="select-native"
            aria-label="Note list"
            value={listMode}
            onChange={(event) => library.setNoteListMode(event.target.value as NoteListMode)}
          >
            {(Object.keys(noteListModes) as NoteListMode[]).map((mode) => (
              <option key={mode} value={mode}>
                {noteListModes[mode]}
              </option>
            ))}
          </select>
        </Row>
      ),
    },
    {
      id: 'sidebar-counts',
      category: 'appearance',
      group: 'Window',
      search: 'Show note counts sidebar numbers',
      content: (
        <Row label="Show note counts in sidebar">
          <Switch
            label="Show note counts in sidebar"
            checked={value.sidebarCounts}
            onChange={(checked) => set('sidebarCounts', checked)}
          />
        </Row>
      ),
    },
    {
      id: 'animations',
      category: 'appearance',
      group: 'Motion',
      search: 'Animations motion panels menus cursor reduce motion',
      content: (
        <Row
          label="Animations"
          description={
            reducedMotion
              ? 'Off while Reduce Motion is on in macOS'
              : 'Panels, menus, and the writing cursor'
          }
        >
          <Switch
            label="Animations"
            checked={value.animationsEnabled}
            onChange={(checked) => set('animationsEnabled', checked)}
          />
        </Row>
      ),
    },
    {
      id: 'note-font',
      category: 'typography',
      group: 'Fonts',
      search: 'Note font body text content typeface',
      content: (
        <Row label="Note text">
          <FontPicker
            label="Note font"
            value={value.noteFont}
            presetOptions={serifFonts}
            installed={fonts.installed}
            onChange={(next) => set('noteFont', next)}
          />
        </Row>
      ),
    },
    {
      id: 'title-font',
      category: 'typography',
      group: 'Fonts',
      search: 'Note title font heading typeface',
      content: (
        <Row label="Note titles">
          <FontPicker
            label="Note title font"
            value={value.titleFont}
            presetOptions={serifFonts}
            installed={fonts.installed}
            onChange={(next) => set('titleFont', next)}
          />
        </Row>
      ),
    },
    {
      id: 'code-font',
      category: 'typography',
      group: 'Fonts',
      search: 'Code font monospace code blocks inline code',
      content: (
        <Row label="Code">
          <FontPicker
            label="Code font"
            value={value.codeFont}
            presetOptions={codeFonts}
            installed={fonts.installed}
            onChange={(next) => set('codeFont', next)}
          />
        </Row>
      ),
    },
    {
      id: 'note-size',
      category: 'typography',
      group: 'Fonts',
      search: 'Note font size text size',
      content: (
        <Row label="Text size">
          <Slider
            label="Note font size"
            value={value.size}
            min={13}
            max={23}
            format={(size) => `${size} pt`}
            onChange={(size) => set('size', size)}
          />
        </Row>
      ),
    },
    {
      id: 'font-preview',
      category: 'typography',
      group: 'Fonts',
      search: 'Font preview',
      content: (
        <div className="font-preview" aria-label="Preview">
          <strong style={{ fontFamily: fontFamily(value.titleFont) }}>
            A little room to think
          </strong>
          <span style={{ fontFamily: fontFamily(value.noteFont), fontSize: value.size }}>
            Keep the tools quiet. Give the ideas room.
          </span>
          <code style={{ fontFamily: fontFamily(value.codeFont) }}>const idea = 'small'</code>
          {fonts.status && (
            <small className="field-help" role="status">
              {fonts.status}
            </small>
          )}
        </div>
      ),
    },
    {
      id: 'heading-styles',
      category: 'typography',
      group: 'Headings',
      search: 'Heading styles H1 H2 H3 H4 H5 H6 font weight italic color',
      content: (
        <HeadingStyles
          styles={value.headingStyles}
          noteFont={value.noteFont}
          installed={fonts.installed}
          onChange={(headingStyles) => set('headingStyles', headingStyles)}
        />
      ),
    },
    {
      id: 'writing-width',
      category: 'editor',
      group: 'Writing',
      search: 'Writing width line length column',
      content: (
        <Row label="Writing width">
          <Slider
            label="Writing width"
            value={value.width}
            min={40}
            max={100}
            format={(width) => `${width}%`}
            onChange={(width) => set('width', width)}
          />
        </Row>
      ),
    },
    {
      id: 'line-spacing',
      category: 'editor',
      group: 'Writing',
      search: 'Line spacing line height',
      content: (
        <Row label="Line spacing">
          <Slider
            label="Line spacing"
            value={value.lineSpacing}
            min={0.5}
            max={2.5}
            step={0.1}
            format={(spacing) => `${spacing.toFixed(1)}×`}
            onChange={(spacing) => set('lineSpacing', spacing)}
          />
        </Row>
      ),
    },
    {
      id: 'paragraph-spacing',
      category: 'editor',
      group: 'Writing',
      search: 'Paragraph spacing',
      content: (
        <Row label="Paragraph spacing">
          <Slider
            label="Paragraph spacing"
            value={value.paragraphSpacing}
            min={0}
            max={32}
            format={(spacing) => `${spacing} px`}
            onChange={(spacing) => set('paragraphSpacing', spacing)}
          />
        </Row>
      ),
    },
    {
      id: 'list-spacing',
      category: 'editor',
      group: 'Writing',
      search: 'List item spacing bullets',
      content: (
        <Row label="List item spacing">
          <Slider
            label="List item spacing"
            value={value.listItemSpacing}
            min={-8}
            max={32}
            format={(spacing) => `${spacing} px`}
            onChange={(spacing) => set('listItemSpacing', spacing)}
          />
        </Row>
      ),
    },
    {
      id: 'bottom-space',
      category: 'editor',
      group: 'Writing',
      search: 'Extra space below the note bottom scrolling',
      content: (
        <Row
          label="Extra space below the note"
          description="Half the window height is always added so you can scroll past the end"
        >
          <Slider
            label="Extra space below the note"
            value={value.editorBottomSpace}
            min={0}
            max={400}
            step={8}
            format={(space) => `${space} px`}
            onChange={(space) => set('editorBottomSpace', space)}
          />
        </Row>
      ),
    },
    {
      id: 'formatting-toolbar',
      category: 'editor',
      group: 'Writing',
      search: 'Always show formatting toolbar bold italic',
      content: (
        <Row
          label="Always show formatting toolbar"
          description="Otherwise it appears when you select text"
        >
          <Switch
            label="Always show formatting toolbar"
            checked={value.showFormattingToolbar}
            onChange={(checked) => set('showFormattingToolbar', checked)}
          />
        </Row>
      ),
    },
    {
      id: 'spellcheck',
      category: 'editor',
      group: 'Writing',
      search: 'Check spelling spellcheck spell checker typos',
      content: (
        <Row label="Check spelling">
          <Switch
            label="Check spelling"
            checked={value.spellcheck}
            onChange={(checked) => set('spellcheck', checked)}
          />
        </Row>
      ),
    },
    {
      id: 'default-notebook',
      category: 'editor',
      group: 'New notes',
      search: 'Default notebook new notes location uncategorized',
      content: (
        <Row label="Default notebook" description="Used outside a notebook view">
          <select
            className="select-native"
            aria-label="Default notebook"
            value={defaultNotebookId}
            onChange={(event) => set('defaultNotebookId', event.target.value)}
          >
            <option value="">None</option>
            {orderedNotebooks(notebooks).map((book) => (
              <option key={book.id} value={book.id}>
                {notebookPath(book, notebooks)}
              </option>
            ))}
          </select>
        </Row>
      ),
    },
    {
      id: 'new-note-title',
      category: 'editor',
      group: 'New notes',
      search: 'New note title first line name',
      content: (
        <Row
          label="Title"
          description={
            value.newNoteTitle === 'firstLine'
              ? 'Start typing in the note; its first line becomes the title'
              : 'Start in the title field'
          }
        >
          <span className="segmented" role="radiogroup" aria-label="New note title">
            {(Object.keys(newNoteTitles) as NewNoteTitle[]).map((mode) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={value.newNoteTitle === mode}
                onClick={() => set('newNoteTitle', mode)}
              >
                {newNoteTitles[mode]}
              </button>
            ))}
          </span>
        </Row>
      ),
    },
    {
      id: 'cursor-style',
      category: 'editor',
      group: 'Cursor',
      search: 'Cursor style insertion point caret block underline',
      content: (
        <Row label="Style">
          <select
            className="select-native"
            aria-label="Cursor style"
            value={value.cursorStyle}
            onChange={(e) => set('cursorStyle', e.target.value as Appearance['cursorStyle'])}
          >
            <option value="line">Line</option>
            <option value="line-thin">Thin line</option>
            <option value="block">Block</option>
            <option value="block-outline">Block outline</option>
            <option value="underline">Underline</option>
            <option value="underline-thin">Thin underline</option>
          </select>
        </Row>
      ),
    },
    {
      id: 'cursor-blinking',
      category: 'editor',
      group: 'Cursor',
      search: 'Cursor blinking blink smooth phase expand solid',
      content: (
        <Row label="Blinking">
          <select
            className="select-native"
            aria-label="Cursor blinking"
            value={value.cursorBlinking}
            onChange={(e) => set('cursorBlinking', e.target.value as Appearance['cursorBlinking'])}
          >
            <option value="blinking">Blink</option>
            <option value="smooth">Smooth</option>
            <option value="phase">Phase</option>
            <option value="expand">Expand</option>
            <option value="solid">Don’t blink</option>
          </select>
        </Row>
      ),
    },
    {
      id: 'smooth-caret',
      category: 'editor',
      group: 'Cursor',
      search: 'Smooth caret animation cursor movement',
      content: (
        <Row label="Smooth caret movement">
          <Switch
            label="Smooth caret animation"
            checked={value.cursorSmoothCaretAnimation === 'on'}
            onChange={(checked) => set('cursorSmoothCaretAnimation', checked ? 'on' : 'off')}
          />
        </Row>
      ),
    },
    ...(syncSettings
      ? [
          {
            id: 'sync-status',
            category: 'sync' as const,
            group: 'Status',
            search: 'Sync now status last synced pending changes',
            content: (
              <Row
                label={syncStatus?.configured ? 'Connected' : 'Not connected'}
                description={
                  syncStatus?.configured
                    ? syncStatus.lastSuccess
                      ? `Last synced ${new Date(syncStatus.lastSuccess).toLocaleString()}${syncStatus.pending ? ` · ${syncStatus.pending} changes waiting` : ''}`
                      : 'Not synced yet'
                    : 'Add a server below to sync this library.'
                }
              >
                <button
                  type="button"
                  className="btn"
                  disabled={!syncStatus?.configured || syncing}
                  onClick={onSync}
                >
                  {syncing ? 'Syncing…' : 'Sync now'}
                </button>
              </Row>
            ),
          },
          {
            id: 'auto-sync',
            category: 'sync' as const,
            group: 'Status',
            search: 'Sync automatically auto sync interval minutes background',
            content: (
              <Row label="Sync automatically" description="Waits until you pause typing">
                <select
                  className="select-native"
                  aria-label="Sync automatically"
                  value={value.autoSyncMinutes}
                  disabled={!syncStatus?.configured}
                  onChange={(event) => set('autoSyncMinutes', Number(event.target.value))}
                >
                  {autoSyncIntervals.map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {autoSyncLabel(minutes)}
                    </option>
                  ))}
                </select>
              </Row>
            ),
          },
          {
            id: 'sync-connection',
            category: 'sync' as const,
            group: 'Server',
            search: 'Sync connection server URL device token Keychain',
            content: <div className="settings-form">{syncSettings}</div>,
          },
        ]
      : []),
  ]

  const search = query.trim().toLocaleLowerCase()
  const visible = items.filter((item) =>
    search ? item.search.toLocaleLowerCase().includes(search) : item.category === category,
  )
  const shortcutMatches =
    !!search &&
    shortcutCommands.some((command) =>
      `${command.label} ${command.description} ${command.category} keyboard shortcuts`
        .toLowerCase()
        .includes(search),
    )
  const title = search ? 'Search results' : categories.find((c) => c.id === category)!.label
  const shownCategories = categories.filter(
    (cat) => (cat.id !== 'sync' || !!syncSettings) && (search ? true : cat.id === category),
  )

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {(open || motionActive) && (
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay settings-overlay" />
          <Dialog.Content
            ref={panel}
            inert={!open}
            className="settings"
            style={
              {
                '--settings-x': `${offset.x}px`,
                '--settings-y': `${offset.y}px`,
              } as React.CSSProperties
            }
            aria-describedby={undefined}
            onEscapeKeyDown={(event) => {
              if (document.querySelector('.shortcut-recording')) event.preventDefault()
            }}
            onOpenAutoFocus={(event) => {
              returnFocus.current =
                document.activeElement instanceof HTMLElement ? document.activeElement : null
              event.preventDefault()
              searchInput.current?.focus()
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              returnFocus.current?.focus()
            }}
          >
            <aside className="settings-sidebar">
              <div className="settings-sidebar-bar" {...dragHandle}>
                <Dialog.Close className="window-close" aria-label="Close settings">
                  <X aria-hidden="true" />
                </Dialog.Close>
              </div>
              <label className="field-shell settings-search">
                <Search aria-hidden="true" />
                <input
                  ref={searchInput}
                  aria-label="Search settings"
                  placeholder="Search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                {query && (
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Clear settings search"
                    onClick={() => {
                      setQuery('')
                      searchInput.current?.focus()
                    }}
                  >
                    <X aria-hidden="true" />
                  </button>
                )}
              </label>
              <nav aria-label="Settings categories">
                {categories
                  .filter((cat) => cat.id !== 'sync' || !!syncSettings)
                  .map(({ id, label, icon: Icon, color }) => (
                    <button
                      key={id}
                      className={`settings-category ${!search && category === id ? 'is-selected' : ''}`}
                      aria-current={!search && category === id ? 'page' : undefined}
                      onClick={() => {
                        setCategory(id)
                        setQuery('')
                      }}
                    >
                      <span
                        className="settings-category-icon"
                        style={{ '--swatch': color } as React.CSSProperties}
                        aria-hidden="true"
                      >
                        <Icon />
                      </span>
                      {label}
                    </button>
                  ))}
              </nav>
            </aside>
            <div className="settings-main">
              <div className="settings-bar" {...dragHandle}>
                <Dialog.Title className="settings-title">{title}</Dialog.Title>
              </div>
              <div className="settings-content" ref={content}>
                {category === 'shortcuts' && !search && (
                  <>
                    <label className="field-shell shortcuts-search">
                      <Search aria-hidden="true" />
                      <input
                        aria-label="Search shortcuts"
                        placeholder="Filter shortcuts"
                        value={shortcutQuery}
                        onChange={(event) => setShortcutQuery(event.target.value)}
                      />
                    </label>
                    <KeyboardShortcuts
                      value={value.shortcuts ?? {}}
                      onChange={(next) => set('shortcuts', next)}
                      query={shortcutQuery}
                    />
                  </>
                )}
                {shownCategories
                  .filter((cat) => visible.some((item) => item.category === cat.id))
                  .map((cat) => (
                    <section key={cat.id} aria-label={cat.label}>
                      {search && <h2 className="settings-section-title">{cat.label}</h2>}
                      {[
                        ...new Set(
                          visible
                            .filter((item) => item.category === cat.id)
                            .map((item) => item.group),
                        ),
                      ].map((group) => (
                        <section key={group || 'main'} aria-label={group || cat.label}>
                          {group && <h3 className="settings-group-title">{group}</h3>}
                          <div className="settings-group">
                            {visible
                              .filter((item) => item.category === cat.id && item.group === group)
                              .map((item) => (
                                <div key={item.id} className="settings-item">
                                  {item.content}
                                </div>
                              ))}
                          </div>
                        </section>
                      ))}
                    </section>
                  ))}
                {shortcutMatches && (
                  <section aria-label="Shortcuts">
                    <h2 className="settings-section-title">Shortcuts</h2>
                    <KeyboardShortcuts
                      value={value.shortcuts ?? {}}
                      onChange={(next) => set('shortcuts', next)}
                      query={search}
                    />
                  </section>
                )}
                {search && !visible.length && !shortcutMatches && (
                  <div className="settings-empty" role="status">
                    <p>No results for “{query.trim()}”</p>
                  </div>
                )}
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      )}
    </Dialog.Root>
  )
}
