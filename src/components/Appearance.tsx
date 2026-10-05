import type { SettingsCategory } from '../mobile/navigation'
import { ChevronRight } from '../icons'
import { shortcutCommands } from '../shortcuts'
import KeyboardShortcuts from './KeyboardShortcuts'
import { useMotionEnabled, useReducedMotion } from '../motion'
import * as Dialog from '@radix-ui/react-dialog'
import {
  Sun,
  Moon,
  X,
  Type,
  Search,
  Palette,
  TextCursorInput,
  Keyboard,
  RefreshCw,
} from '../icons'
import type { Appearance as Settings } from '../model'
import { fontFamily } from '../fonts'
import { useEffect, useState, useRef, type ReactNode } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import FontPicker from './FontPicker'
import HeadingStyles from './HeadingStyles'

export default function Appearance({
  open,
  onOpenChange,
  value,
  onChange,
  initialCategory = 'appearance',
  syncSettings,
  mobile,
}: {
  mobile?: { category?: SettingsCategory; onCategory: (category: SettingsCategory) => void }
  initialCategory?: 'appearance' | 'sync'
  syncSettings?: ReactNode
  open: boolean
  onOpenChange: (v: boolean) => void
  value: Settings
  onChange: (v: Settings) => void
}) {
  const [category, setCategory] = useState('appearance')
  const [query, setQuery] = useState('')
  const [shortcutQuery, setShortcutQuery] = useState('')
  const contentRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (open) {
      setCategory(initialCategory)
      setQuery('')
      setShortcutQuery('')
    }
  }, [open, initialCategory])
  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0
  }, [category, query])
  const motionActive = useMotionEnabled()
  const reducedMotion = useReducedMotion()
  const [installed, setInstalled] = useState<string[]>([])
  const [fontStatus, setFontStatus] = useState('')
  useEffect(() => {
    if (!open || mobile) return
    let cancelled = false
    if (!isTauri()) {
      setFontStatus('Open the Mac app to choose installed fonts.')
      return
    }
    setFontStatus('Loading installed fonts…')
    invoke<string[]>('installed_fonts')
      .then((names) => {
        if (cancelled) return
        const sorted = [...new Set(names)].sort((a, b) => a.localeCompare(b))
        setInstalled(sorted)
        setFontStatus(sorted.length ? '' : 'No installed fonts were found.')
      })
      .catch(() => {
        if (!cancelled)
          setFontStatus('Could not load installed fonts. Reopen Settings to try again.')
      })
    return () => {
      cancelled = true
    }
  }, [open, !!mobile])
  const set = <K extends keyof Settings>(key: K, next: Settings[K]) =>
    onChange({ ...value, [key]: next })
  const categories = [
    { id: 'appearance', label: 'Appearance', icon: Palette },
    { id: 'typography', label: 'Typography', icon: Type },
    { id: 'editor', label: 'Editor', icon: TextCursorInput },
    { id: 'shortcuts', label: 'Keyboard shortcuts', icon: Keyboard },
    ...(syncSettings ? [{ id: 'sync', label: 'Sync', icon: RefreshCw }] : []),
  ]
  const items = [
    ...(syncSettings
      ? [
          {
            id: 'sync-connection',
            category: 'sync',
            group: 'Connection',
            search: 'Sync connection server URL device token Keychain',
            content: syncSettings,
          },
        ]
      : []),
    {
      id: 'app-style',
      category: 'appearance',
      group: 'Style',
      search: 'App style Default Modern cards Connected and simple Separate panels and notes',
      content: (
        <>
          <fieldset className="app-style-options">
            <legend>App style</legend>
            {(['default', 'cards'] as const).map((style) => (
              <label key={style} className="app-style-option">
                <input
                  type="radio"
                  name="app-style"
                  value={style}
                  checked={value.appStyle === style}
                  onChange={() => set('appStyle', style)}
                />
                <span className={`app-style-preview preview-${style}`} aria-hidden="true">
                  <span className="preview-sidebar" />
                  <span className="preview-list">
                    <i />
                    <i />
                    <i />
                  </span>
                  <span className="preview-editor">
                    <i />
                    <i />
                    <i />
                  </span>
                </span>
                <span className="app-style-label">
                  {style === 'default' ? 'Default' : 'Modern cards'}
                </span>
                <small>
                  {style === 'default' ? 'Connected and simple' : 'Separate panels and notes'}
                </small>
              </label>
            ))}
          </fieldset>
        </>
      ),
    },
    {
      id: 'Theme',
      category: 'appearance',
      group: 'Style',
      search: 'Theme ',
      content: (
        <>
          <label className="setting-row">
            <span>Theme</span>
            <select
              aria-label="Theme"
              value={value.theme}
              onChange={(e) => set('theme', e.target.value as Settings['theme'])}
            >
              <option value="classic">Classic</option>
              <option value="zen">Zen</option>
              <option value="financial">Financial</option>
              <option value="tiktok">tiktok</option>
              <option value="catppuccin">Catppuccin</option>
              <option value="lastchat">LastChat</option>
              <option value="qrafthive">qrafthive</option>
              <option value="aster">Aster</option>
            </select>
          </label>
        </>
      ),
    },
    {
      id: 'color-mode',
      category: 'appearance',
      group: 'Style',
      search: 'Color mode Light Dark',
      content: (
        <>
          <div>
            <h4>Color mode</h4>{' '}
            <div className="theme-options">
              <button
                aria-pressed={!value.dark}
                className={!value.dark ? 'selected' : ''}
                onClick={() => set('dark', false)}
              >
                <div
                  className="theme-preview light-preview"
                  data-theme="light"
                  data-palette={value.theme}
                >
                  <span />
                  <span />
                  <span />
                </div>
                <Sun size={16} /> Light
              </button>
              <button
                aria-pressed={value.dark}
                className={value.dark ? 'selected' : ''}
                onClick={() => set('dark', true)}
              >
                <div
                  className="theme-preview dark-preview"
                  data-theme="dark"
                  data-palette={value.theme}
                >
                  <span />
                  <span />
                  <span />
                </div>
                <Moon size={16} /> Dark
              </button>
            </div>
          </div>
        </>
      ),
    },
    {
      id: 'Enable animations',
      category: 'appearance',
      group: 'Motion',
      search:
        'Enable animations Animate panels menus controls scrolling and the writing cursor Respects Reduce Motion on this device',
      content: (
        <>
          <label className="setting-row">
            <span>
              Enable animations
              <small>
                Animate panels, menus, controls, scrolling, and the writing cursor. Respects Reduce
                Motion on this device.
              </small>
            </span>
            <input
              type="checkbox"
              role="switch"
              aria-label="Enable animations"
              checked={value.animationsEnabled}
              onChange={(event) => set('animationsEnabled', event.target.checked)}
            />
          </label>
          {reducedMotion && (
            <p className="muted" role="status">
              Animations are currently disabled by Reduce Motion on this device.
            </p>
          )}
        </>
      ),
    },
    {
      id: 'font-presets',
      category: 'typography',
      group: 'Fonts',
      search: 'Theme font presets Use fonts Different jobs Different fonts',
      content: (
        <>
          {value.theme !== 'classic' && value.theme !== 'aster' && (
            <button
              className="zen-fonts"
              onClick={() =>
                onChange({
                  ...value,
                  uiFont:
                    value.theme === 'qrafthive'
                      ? 'font:Outfit'
                      : value.theme === 'lastchat'
                        ? 'font:Google Sans Flex'
                        : value.theme === 'tiktok'
                          ? 'font:TikTok Sans'
                          : 'font:Inter',
                  titleFont:
                    value.theme === 'qrafthive'
                      ? 'font:Merriweather'
                      : value.theme === 'lastchat'
                        ? 'font:Google Sans Flex'
                        : value.theme === 'zen'
                          ? 'font:Playfair Display'
                          : value.theme === 'catppuccin'
                            ? 'font:New York'
                            : 'georgia',
                  noteFont:
                    value.theme === 'qrafthive'
                      ? 'font:Merriweather'
                      : value.theme === 'lastchat'
                        ? 'font:Google Sans Flex'
                        : value.theme === 'zen'
                          ? 'font:Playfair Display'
                          : value.theme === 'catppuccin'
                            ? 'font:New York'
                            : 'georgia',
                  codeFont:
                    value.theme === 'qrafthive'
                      ? 'font:JetBrains Mono'
                      : value.theme === 'lastchat'
                        ? 'font:Google Sans Code'
                        : value.theme === 'zen'
                          ? 'font:JetBrains Mono'
                          : value.theme === 'tiktok'
                            ? 'font:Roboto'
                            : 'font:Fira Code',
                })
              }
            >
              Use{' '}
              {value.theme === 'qrafthive'
                ? 'qrafthive'
                : value.theme === 'lastchat'
                  ? 'LastChat'
                  : value.theme === 'zen'
                    ? 'Zen'
                    : value.theme === 'tiktok'
                      ? 'tiktok'
                      : value.theme === 'catppuccin'
                        ? 'Catppuccin'
                        : 'Financial'}{' '}
              fonts
            </button>
          )}
          <p className="muted small">Different jobs. Different fonts.</p>
          {fontStatus && (
            <p className="muted small" role="status">
              {fontStatus}
            </p>
          )}
        </>
      ),
    },
    {
      id: 'Interface font',
      category: 'typography',
      group: 'Fonts',
      search: 'Interface font Navigation menus and settings',
      content: (
        <>
          <label className="setting-row">
            <span>
              Interface font<small>Navigation, menus, and settings</small>
            </span>
            <FontPicker
              label="Interface font"
              value={value.uiFont}
              presetOptions={[
                { value: 'system', label: 'System Sans' },
                { value: 'helvetica', label: 'Helvetica Neue' },
                { value: 'avenir', label: 'Avenir Next' },
              ]}
              installed={installed}
              dark={value.dark}
              palette={value.theme}
              onChange={(next) => set('uiFont', next)}
            />
          </label>
        </>
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
          installed={installed}
          dark={value.dark}
          palette={value.theme}
          mobile={!!mobile}
          onChange={(headingStyles) => set('headingStyles', headingStyles)}
        />
      ),
    },
    {
      id: 'Note title font',
      category: 'typography',
      group: 'Fonts',
      search: 'Note title font Title at the top of each note',
      content: (
        <>
          <label className="setting-row">
            <span>
              Note title font<small>The title at the top of each note</small>
            </span>
            <FontPicker
              label="Note title font"
              value={value.titleFont}
              presetOptions={[
                { value: 'georgia', label: 'Georgia' },
                { value: 'system', label: 'System Sans' },
                { value: 'palatino', label: 'Palatino' },
                { value: 'avenir', label: 'Avenir Next' },
              ]}
              installed={installed}
              dark={value.dark}
              palette={value.theme}
              onChange={(next) => set('titleFont', next)}
            />
          </label>
        </>
      ),
    },
    {
      id: 'Note font',
      category: 'typography',
      group: 'Fonts',
      search: 'Note font Headings and note content',
      content: (
        <>
          <label className="setting-row">
            <span>
              Note font<small>Headings and note content</small>
            </span>
            <FontPicker
              label="Note font"
              value={value.noteFont}
              presetOptions={[
                { value: 'georgia', label: 'Georgia' },
                { value: 'system', label: 'System Sans' },
                { value: 'palatino', label: 'Palatino' },
                { value: 'avenir', label: 'Avenir Next' },
              ]}
              installed={installed}
              dark={value.dark}
              palette={value.theme}
              onChange={(next) => set('noteFont', next)}
            />
          </label>
        </>
      ),
    },
    {
      id: 'Code font',
      category: 'typography',
      group: 'Fonts',
      search: 'Code font Code blocks and inline code',
      content: (
        <>
          <label className="setting-row">
            <span>
              Code font<small>Code blocks and inline code</small>
            </span>
            <FontPicker
              label="Code font"
              value={value.codeFont}
              presetOptions={[
                { value: 'menlo', label: 'Menlo' },
                { value: 'monaco', label: 'Monaco' },
                { value: 'courier', label: 'Courier New' },
              ]}
              installed={installed}
              dark={value.dark}
              palette={value.theme}
              onChange={(next) => set('codeFont', next)}
            />
          </label>
        </>
      ),
    },
    {
      id: 'Note font size',
      category: 'typography',
      group: 'Size',
      search: 'Note font size  Note size',
      content: (
        <>
          <label className="setting-row">
            <span>
              Note size<small>{value.size} px</small>
            </span>
            <input
              aria-label="Note font size"
              type="range"
              min="14"
              max="23"
              value={value.size}
              onChange={(e) => set('size', Number(e.target.value))}
            />
          </label>
        </>
      ),
    },
    {
      id: 'Writing width',
      category: 'editor',
      group: 'Writing',
      search: 'Writing width ',
      content: (
        <>
          <label className="setting-row">
            <span>
              Writing width<small>{value.width}%</small>
            </span>
            <input
              aria-label="Writing width"
              type="range"
              min="40"
              max="100"
              step="1"
              aria-valuetext={`${value.width}%`}
              value={value.width}
              onChange={(e) => set('width', Number(e.target.value))}
            />
          </label>
        </>
      ),
    },
    {
      id: 'Line spacing',
      category: 'editor',
      group: 'Writing',
      search: 'Line spacing ',
      content: (
        <>
          <label className="setting-row">
            <span>
              Line spacing<small>{value.lineSpacing}×</small>
            </span>
            <input
              aria-label="Line spacing"
              type="range"
              min="0.5"
              max="2.5"
              step="0.1"
              aria-valuetext={`${value.lineSpacing}×`}
              value={value.lineSpacing}
              onChange={(e) => set('lineSpacing', Number(e.target.value))}
            />
          </label>
        </>
      ),
    },
    {
      id: 'Paragraph spacing',
      category: 'editor',
      group: 'Writing',
      search: 'Paragraph spacing ',
      content: (
        <>
          <label className="setting-row">
            <span>
              Paragraph spacing<small>{value.paragraphSpacing} px</small>
            </span>
            <input
              aria-label="Paragraph spacing"
              type="range"
              min="0"
              max="32"
              step="1"
              aria-valuetext={`${value.paragraphSpacing} px`}
              value={value.paragraphSpacing}
              onChange={(e) => set('paragraphSpacing', Number(e.target.value))}
            />
          </label>
        </>
      ),
    },
    {
      id: 'List item spacing',
      category: 'editor',
      group: 'Writing',
      search: 'List item spacing ',
      content: (
        <>
          <label className="setting-row">
            <span>
              List item spacing<small>{value.listItemSpacing} px</small>
            </span>
            <input
              aria-label="List item spacing"
              type="range"
              min="-8"
              max="32"
              step="1"
              aria-valuetext={`${value.listItemSpacing} px`}
              value={value.listItemSpacing}
              onChange={(e) => set('listItemSpacing', Number(e.target.value))}
            />
          </label>
        </>
      ),
    },
    {
      id: 'Space at the bottom of the editor',
      category: 'editor',
      group: 'Writing',
      search: 'Space at the bottom of the editor ',
      content: (
        <>
          <label className="setting-row">
            <span>
              Space at the bottom of the editor<small>{value.editorBottomSpace} px</small>
            </span>
            <input
              aria-label="Space at the bottom of the editor"
              type="range"
              min="0"
              max="400"
              step="8"
              aria-valuetext={`${value.editorBottomSpace} px`}
              value={value.editorBottomSpace}
              onChange={(e) => set('editorBottomSpace', Number(e.target.value))}
            />
          </label>
        </>
      ),
    },
    {
      id: 'Cursor style',
      category: 'editor',
      group: 'Cursor',
      search: 'Cursor style How the insertion point is drawn in notes',
      content: (
        <>
          <label className="setting-row">
            <span>
              Cursor style<small>How the insertion point is drawn in notes</small>
            </span>
            <select
              aria-label="Cursor style"
              value={value.cursorStyle}
              onChange={(e) => set('cursorStyle', e.target.value as Settings['cursorStyle'])}
            >
              <option value="line">Line (Default)</option>
              <option value="block">Block</option>
              <option value="underline">Underline</option>
              <option value="line-thin">Line thin</option>
              <option value="block-outline">Block outline</option>
              <option value="underline-thin">Underline thin</option>
            </select>
          </label>
        </>
      ),
    },
    {
      id: 'Cursor blinking',
      category: 'editor',
      group: 'Cursor',
      search: 'Cursor blinking How the insertion point appears and disappears',
      content: (
        <>
          <label className="setting-row">
            <span>
              Cursor blinking<small>How the insertion point appears and disappears</small>
            </span>
            <select
              aria-label="Cursor blinking"
              value={value.cursorBlinking}
              onChange={(e) => set('cursorBlinking', e.target.value as Settings['cursorBlinking'])}
            >
              <option value="blinking">Blinking (Default)</option>
              <option value="smooth">Smooth</option>
              <option value="phase">Phase</option>
              <option value="expand">Expand</option>
              <option value="solid">Solid (No blink)</option>
            </select>
          </label>
        </>
      ),
    },
    {
      id: 'Smooth caret animation',
      category: 'editor',
      group: 'Cursor',
      search: 'Smooth caret animation Move fluidly while typing and navigating nearby text',
      content: (
        <>
          <label className="setting-row">
            <span>
              Smooth caret animation
              <small>Move fluidly while typing and navigating nearby text</small>
            </span>
            <input
              aria-label="Smooth caret animation"
              type="checkbox"
              role="switch"
              checked={value.cursorSmoothCaretAnimation === 'on'}
              onChange={(e) => set('cursorSmoothCaretAnimation', e.target.checked ? 'on' : 'off')}
            />
          </label>
        </>
      ),
    },
    {
      id: 'font-preview',
      category: 'typography',
      group: 'Preview',
      search: 'Font preview Note font Note size',
      content: (
        <>
          <div className="font-preview">
            <Type size={18} />
            <span
              style={{
                fontFamily: fontFamily(value.noteFont),
                fontSize: value.size,
              }}
            >
              A little room to think.
            </span>
          </div>
        </>
      ),
    },
  ]
  const search = query.trim().toLocaleLowerCase()
  const excludedMobile = new Set([
    'app-style',
    'font-presets',
    'Writing width',
    'Cursor style',
    'Cursor blinking',
    'Smooth caret animation',
  ])
  const mobileFontKeys: Record<string, 'uiFont' | 'titleFont' | 'noteFont' | 'codeFont'> = {
    'Interface font': 'uiFont',
    'Note title font': 'titleFont',
    'Note font': 'noteFont',
    'Code font': 'codeFont',
  }
  const available = mobile
    ? items
        .filter((item) => !excludedMobile.has(item.id))
        .map((item) => {
          const key = mobileFontKeys[item.id]
          return key
            ? {
                ...item,
                content: (
                  <label className="setting-row">
                    <span>{item.id}</span>
                    <select
                      aria-label={item.id}
                      value={value[key]}
                      onChange={(e) => set(key, e.target.value)}
                    >
                      <option value="system">System sans</option>
                      <option value="georgia">System serif</option>
                      <option value="menlo">System monospace</option>
                    </select>
                  </label>
                ),
              }
            : item
        })
    : items
  const visible = available.filter((item) =>
    search
      ? item.search.toLocaleLowerCase().includes(search)
      : item.category === (mobile ? mobile.category : category),
  )
  if (mobile)
    return (
      <div className="mobile-settings grouped-settings">
        <div className="settings-search text-field-shell">
          <Search size={18} />
          <input
            className="text-field"
            aria-label="Search settings"
            placeholder="Search settings…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button aria-label="Clear settings search" onClick={() => setQuery('')}>
              <X size={18} />
            </button>
          )}
        </div>
        {!mobile.category && !search ? (
          <nav aria-label="Settings categories" className="mobile-settings-categories">
            {categories
              .filter((cat) => cat.id !== 'shortcuts')
              .map(({ id, label, icon: Icon }) => (
                <button key={id} onClick={() => mobile.onCategory(id as SettingsCategory)}>
                  <Icon size={21} />
                  <span>{label}</span>
                  <ChevronRight size={19} />
                </button>
              ))}
          </nav>
        ) : (
          <div className="settings-content" ref={contentRef}>
            {visible.length === 0 && <p role="status">No settings found.</p>}
            {search && !mobile.category
              ? visible.map((item) => (
                  <button
                    className="mobile-setting-result"
                    key={item.id}
                    onClick={() => {
                      setQuery('')
                      mobile.onCategory(item.category as SettingsCategory)
                    }}
                  >
                    <span>{item.id}</span>
                    <ChevronRight size={18} />
                  </button>
                ))
              : categories
                  .filter((cat) => visible.some((item) => item.category === cat.id))
                  .map((cat) => (
                    <section key={cat.id} aria-label={cat.label}>
                      {[
                        ...new Set(
                          visible
                            .filter((item) => item.category === cat.id)
                            .map((item) => item.group),
                        ),
                      ].map((group) => (
                        <section className="settings-section" key={group} aria-label={group}>
                          <h3>{group}</h3>
                          <div className="settings-group">
                            {visible
                              .filter((item) => item.category === cat.id && item.group === group)
                              .map((item) => (
                                <div className="settings-item" key={item.id}>
                                  {item.content}
                                </div>
                              ))}
                          </div>
                        </section>
                      ))}
                    </section>
                  ))}
          </div>
        )}
      </div>
    )

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {(open || motionActive) && (
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content
            onEscapeKeyDown={(event) => {
              if (document.querySelector('.shortcut-recording')) event.preventDefault()
            }}
            onOpenAutoFocus={() => {
              returnFocusRef.current =
                document.activeElement instanceof HTMLElement ? document.activeElement : null
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              returnFocusRef.current?.focus()
            }}
            inert={!open}
            className="settings-dialog grouped-settings"
            style={{ fontFamily: fontFamily(value.uiFont) }}
            data-theme={value.dark ? 'dark' : 'light'}
            data-palette={value.theme}
          >
            <header className="settings-header">
              <Dialog.Title>Settings</Dialog.Title>
              <Dialog.Description className="settings-sr-only">
                Customize appearance, typography, your editor, and sync. Appearance and editor
                changes save automatically.
              </Dialog.Description>
              <Dialog.Close className="icon-button" aria-label="Close settings">
                <X size={19} />
              </Dialog.Close>
            </header>
            <div className="settings-layout">
              <aside className="settings-sidebar">
                <div className="settings-search text-field-shell">
                  <Search size={16} aria-hidden="true" />
                  <input
                    ref={searchRef}
                    className="text-field"
                    aria-label="Search settings"
                    placeholder="Search settings…"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                  {query && (
                    <button
                      className="icon-button"
                      aria-label="Clear settings search"
                      onClick={() => {
                        setQuery('')
                        searchRef.current?.focus()
                      }}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
                <nav aria-label="Settings categories">
                  <div className="settings-nav-label">Options</div>
                  {categories.map(({ id, label, icon: Icon }) => (
                    <button
                      key={id}
                      aria-current={!search && category === id ? 'page' : undefined}
                      onClick={() => {
                        setCategory(id)
                        setQuery('')
                      }}
                    >
                      <Icon size={17} aria-hidden="true" />
                      {label}
                    </button>
                  ))}
                </nav>
              </aside>
              <div className="settings-content" ref={contentRef}>
                {search && <h2 className="settings-results-title">Search results</h2>}
                {category === 'shortcuts' && !search && (
                  <>
                    <h2>Keyboard shortcuts</h2>
                    <input
                      className="text-field shortcut-search"
                      aria-label="Search shortcuts"
                      placeholder="Search shortcuts…"
                      value={shortcutQuery}
                      onChange={(e) => setShortcutQuery(e.target.value)}
                    />
                    <KeyboardShortcuts
                      value={value.shortcuts ?? {}}
                      onChange={(next) => set('shortcuts', next)}
                      query={shortcutQuery}
                    />
                  </>
                )}
                {search &&
                  shortcutCommands.some((c) =>
                    `${c.label} ${c.description} ${c.category} keyboard shortcuts`
                      .toLowerCase()
                      .includes(search),
                  ) && (
                    <KeyboardShortcuts
                      value={value.shortcuts ?? {}}
                      onChange={(next) => set('shortcuts', next)}
                      query={search}
                    />
                  )}
                {visible.length === 0 &&
                  (search
                    ? !shortcutCommands.some((c) =>
                        `${c.label} ${c.description} ${c.category} keyboard shortcuts`
                          .toLowerCase()
                          .includes(search),
                      )
                    : category !== 'shortcuts') && (
                    <div className="settings-empty" role="status">
                      <Search size={24} aria-hidden="true" />
                      <h3>No settings found</h3>
                      <p>Try another setting name, such as “font” or “cursor”.</p>
                    </div>
                  )}
                {categories
                  .filter((cat) => visible.some((item) => item.category === cat.id))
                  .map((cat) => (
                    <section key={cat.id} aria-label={cat.label}>
                      <h2>{cat.label}</h2>
                      {[
                        ...new Set(
                          visible
                            .filter((item) => item.category === cat.id)
                            .map((item) => item.group),
                        ),
                      ].map((group) => (
                        <section className="settings-section" key={group} aria-label={group}>
                          <h3>{group}</h3>
                          <div className="settings-group">
                            {visible
                              .filter((item) => item.category === cat.id && item.group === group)
                              .map((item) => (
                                <div className="settings-item" key={item.id}>
                                  {item.content}
                                </div>
                              ))}
                          </div>
                        </section>
                      ))}
                    </section>
                  ))}
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      )}
    </Dialog.Root>
  )
}
