import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import HeadingStyles from '../components/HeadingStyles'
import { accentColors, accents, colorModes } from '../appearance'
import { fontFamily } from '../fonts'
import {
  ChevronRight,
  Palette,
  PenLine,
  RefreshCw,
  Search,
  Type,
  X,
  type IconComponent,
} from '../icons'
import type { Appearance, ColorMode } from '../model'
import { useReducedMotion } from '../motion'
import { noteListModes, type NoteListMode } from '../noteListPresentation'
import { library, useLibrarySelector } from '../storage/useLibrary'
import type { SettingsCategory } from './navigation'

/*
 * Mobile settings: the desktop Settings content (src/app/Settings.tsx) laid out as pages.
 * Desktop-only items are left out: translucent sidebar, writing width, the formatting toolbar
 * (always shown on mobile), cursor drawing (mobile uses the native caret) and shortcuts.
 */

const categories: { id: SettingsCategory; label: string; icon: IconComponent; color: string }[] = [
  { id: 'appearance', label: 'Appearance', icon: Palette, color: '#007aff' },
  { id: 'typography', label: 'Typography', icon: Type, color: '#f7821b' },
  { id: 'editor', label: 'Editor', icon: PenLine, color: '#4fa83a' },
  { id: 'sync', label: 'Sync', icon: RefreshCw, color: '#30b0c7' },
]

// Android has no named Mac fonts; these presets resolve to its sans, serif and mono families.
const systemFonts = [
  { value: 'system', label: 'System sans' },
  { value: 'georgia', label: 'System serif' },
  { value: 'menlo', label: 'System monospace' },
]
const presetLabels: Record<string, string> = {
  helvetica: 'Helvetica Neue',
  avenir: 'Avenir Next',
  palatino: 'Palatino',
  'sf-mono': 'SF Mono',
  monaco: 'Monaco',
  courier: 'Courier New',
}

function Switch({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      className="switch"
      aria-label={label}
      aria-checked={checked}
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

/** A slider row: the label and value on one line, a full-width track below. */
function SliderRow({
  label,
  value,
  min,
  max,
  step = 1,
  format,
  description,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  format: (value: number) => string
  description?: string
  onChange: (value: number) => void
}) {
  return (
    <div className="settings-row is-stacked">
      <span className="settings-label">
        <span className="settings-slider-label">
          {label}
          <output className="tabular">{format(value)}</output>
        </span>
        {description && <small>{description}</small>}
      </span>
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
    </div>
  )
}

type Item = {
  id: string
  category: SettingsCategory
  group: string
  search: string
  content: ReactNode
}

/** Installed font families, when the native app can list them. Android currently lists none. */
function useInstalledFonts() {
  const [installed, setInstalled] = useState<string[]>([])
  const [status, setStatus] = useState('')
  useEffect(() => {
    if (!isTauri()) return
    let cancelled = false
    invoke<string[]>('installed_fonts')
      .then((names) => {
        if (!cancelled) setInstalled([...new Set(names)].sort((a, b) => a.localeCompare(b)))
      })
      .catch((error) => {
        console.error('Could not load installed fonts', error)
        if (!cancelled)
          setStatus('Couldn’t load this device’s fonts. Reopen Settings to try again.')
      })
    return () => {
      cancelled = true
    }
  }, [])
  return { installed, status }
}

export default function MobileSettings({
  value,
  onChange,
  category,
  onCategory,
  syncSettings,
  onSync,
  syncDisabled = false,
}: {
  value: Appearance
  onChange: (value: Appearance) => void
  /** The open category page; the category list when undefined. */
  category?: SettingsCategory
  onCategory: (category: SettingsCategory) => void
  syncSettings?: ReactNode
  onSync?: () => void
  syncDisabled?: boolean
}) {
  const [query, setQuery] = useState('')
  const page = useRef<HTMLDivElement>(null)
  const reducedMotion = useReducedMotion()
  const fonts = useInstalledFonts()
  const listMode = useLibrarySelector((state) => state.workspace?.noteListMode ?? 'compact')
  const syncStatus = useLibrarySelector((state) => state.syncStatus)
  const syncing = useLibrarySelector((state) => state.syncing)
  useLayoutEffect(() => {
    if (page.current) page.current.scrollTop = 0
  }, [category, query])

  const set = <K extends keyof Appearance>(key: K, next: Appearance[K]) =>
    onChange({ ...value, [key]: next })
  const fontSelect = (label: string, key: 'noteFont' | 'titleFont' | 'codeFont') => {
    const current = value[key]
    const installed = fonts.installed.map((name) => ({ value: `font:${name}`, label: name }))
    // Keep a font chosen elsewhere selectable instead of showing the wrong choice.
    const known = [...systemFonts, ...installed].some((option) => option.value === current)
    return (
      <select
        className="select-native"
        aria-label={label}
        value={current}
        onChange={(event) => set(key, event.target.value)}
      >
        {systemFonts.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
        {!known && (
          <option value={current}>
            {current.startsWith('font:') ? current.slice(5) : (presetLabels[current] ?? current)}
          </option>
        )}
        {installed.length > 0 && (
          <optgroup label="Installed">
            {installed.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    )
  }

  const items: Item[] = [
    {
      id: 'color-mode',
      category: 'appearance',
      group: '',
      search: 'Appearance color mode light dark auto system theme',
      content: (
        <Row label="Appearance" stacked>
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
        <Row label="Accent color" stacked>
          {/* Android doesn't report an accent color, so the automatic choice shows as Blue. */}
          <span className="accent-options" role="radiogroup" aria-label="Accent color">
            {accentColors.map((accent) => (
              <button
                key={accent}
                type="button"
                role="radio"
                className="accent-option"
                aria-label={accents[accent].label}
                aria-checked={
                  value.accent === accent || (accent === 'blue' && value.accent === 'system')
                }
                style={{ '--swatch': accents[accent].light } as React.CSSProperties}
                onClick={() => set('accent', accent)}
              />
            ))}
          </span>
        </Row>
      ),
    },
    {
      id: 'note-list',
      category: 'appearance',
      group: 'Lists',
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
      group: 'Lists',
      search: 'Show note counts navigation drawer sidebar numbers',
      content: (
        <Row label="Show note counts in navigation">
          <Switch
            label="Show note counts in navigation"
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
      search: 'Animations motion sheets menus scrolling reduce motion',
      content: (
        <Row
          label="Animations"
          description={
            reducedMotion ? 'Off while this device reduces motion' : 'Sheets, menus, and scrolling'
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
      content: <Row label="Note text">{fontSelect('Note font', 'noteFont')}</Row>,
    },
    {
      id: 'title-font',
      category: 'typography',
      group: 'Fonts',
      search: 'Note title font heading typeface',
      content: <Row label="Note titles">{fontSelect('Note title font', 'titleFont')}</Row>,
    },
    {
      id: 'code-font',
      category: 'typography',
      group: 'Fonts',
      search: 'Code font monospace code blocks inline code',
      content: <Row label="Code">{fontSelect('Code font', 'codeFont')}</Row>,
    },
    {
      id: 'note-size',
      category: 'typography',
      group: 'Fonts',
      search: 'Note font size text size',
      content: (
        <SliderRow
          label="Text size"
          value={value.size}
          min={13}
          max={23}
          format={(size) => `${size} px`}
          onChange={(size) => set('size', size)}
        />
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
            <small className="field-error" role="alert">
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
          mobile
          onChange={(headingStyles) => set('headingStyles', headingStyles)}
        />
      ),
    },
    {
      id: 'line-spacing',
      category: 'editor',
      group: 'Writing',
      search: 'Line spacing line height',
      content: (
        <SliderRow
          label="Line spacing"
          value={value.lineSpacing}
          min={0.5}
          max={2.5}
          step={0.1}
          format={(spacing) => `${spacing.toFixed(1)}×`}
          onChange={(spacing) => set('lineSpacing', spacing)}
        />
      ),
    },
    {
      id: 'paragraph-spacing',
      category: 'editor',
      group: 'Writing',
      search: 'Paragraph spacing',
      content: (
        <SliderRow
          label="Paragraph spacing"
          value={value.paragraphSpacing}
          min={0}
          max={32}
          format={(spacing) => `${spacing} px`}
          onChange={(spacing) => set('paragraphSpacing', spacing)}
        />
      ),
    },
    {
      id: 'list-spacing',
      category: 'editor',
      group: 'Writing',
      search: 'List item spacing bullets',
      content: (
        <SliderRow
          label="List item spacing"
          value={value.listItemSpacing}
          min={-8}
          max={32}
          format={(spacing) => `${spacing} px`}
          onChange={(spacing) => set('listItemSpacing', spacing)}
        />
      ),
    },
    {
      id: 'bottom-space',
      category: 'editor',
      group: 'Writing',
      search: 'Space at the bottom of the editor extra space below the note scrolling',
      content: (
        <SliderRow
          label="Space at the bottom of the editor"
          description="At least 112 px, so the last line can scroll above the keyboard"
          value={value.editorBottomSpace}
          min={0}
          max={400}
          step={8}
          format={(space) => `${space} px`}
          onChange={(space) => set('editorBottomSpace', space)}
        />
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
              <>
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
                    disabled={!syncStatus?.configured || syncing || syncDisabled}
                    onClick={onSync}
                  >
                    {syncing ? 'Syncing…' : 'Sync now'}
                  </button>
                </Row>
                {syncStatus?.warnings.map((warning) => (
                  <p key={warning} className="status-line" role="status">
                    {warning}
                  </p>
                ))}
              </>
            ),
          },
          {
            id: 'sync-connection',
            category: 'sync' as const,
            group: 'Server',
            search: 'Sync connection server URL device token Keystore',
            content: <div className="settings-form">{syncSettings}</div>,
          },
        ]
      : []),
  ]

  const search = query.trim().toLocaleLowerCase()
  const visible = items.filter((item) =>
    search ? item.search.toLocaleLowerCase().includes(search) : item.category === category,
  )
  const shown = categories.filter((cat) => visible.some((item) => item.category === cat.id))

  return (
    <div className="mobile-settings" ref={page}>
      {!category && (
        <label className="field-shell settings-search">
          <Search aria-hidden="true" />
          <input
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
              onClick={() => setQuery('')}
            >
              <X aria-hidden="true" />
            </button>
          )}
        </label>
      )}
      {!category && !search ? (
        <nav aria-label="Settings categories" className="settings-group">
          {categories
            .filter((cat) => cat.id !== 'sync' || !!syncSettings)
            .map(({ id, label, icon: Icon, color }) => (
              <button
                key={id}
                className="settings-item mobile-settings-category"
                onClick={() => onCategory(id)}
              >
                <span
                  className="settings-category-icon"
                  style={{ '--swatch': color } as React.CSSProperties}
                  aria-hidden="true"
                >
                  <Icon />
                </span>
                <span className="settings-label">{label}</span>
                <ChevronRight aria-hidden="true" className="ui-icon mobile-chevron" />
              </button>
            ))}
        </nav>
      ) : (
        <div className="settings-content">
          {shown.map((cat) => (
            <section key={cat.id} aria-label={cat.label}>
              {search && <h2 className="settings-section-title">{cat.label}</h2>}
              {[
                ...new Set(
                  visible.filter((item) => item.category === cat.id).map((item) => item.group),
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
          {search && !visible.length && (
            <div className="settings-empty" role="status">
              <p>No results for “{query.trim()}”</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
