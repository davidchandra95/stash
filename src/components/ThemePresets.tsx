import { useRef, useState, type CSSProperties } from 'react'
import { useResolvedDark } from '../appearance'
import { Pencil, Plus, Trash2 } from '../icons'
import type { Appearance, ThemePreset } from '../model'
import {
  applyPreset,
  builtInPresets,
  currentPreset,
  presetPreview,
  presetSettingsFrom,
} from '../themePresets'
import NoteContextMenu from './NoteContextMenu'

type Props = { value: Appearance; onChange: (next: Appearance) => void }

function NameField({
  initial,
  label,
  onDone,
}: {
  initial: string
  label: string
  onDone: (name: string | null) => void
}) {
  const [name, setName] = useState(initial)
  // Enter or Escape unmounts the field, which can also blur it: finish only once.
  const finished = useRef(false)
  const finish = (result: string | null) => {
    if (finished.current) return
    finished.current = true
    onDone(result)
  }
  return (
    <input
      className="field preset-name-field"
      aria-label={label}
      autoFocus
      maxLength={40}
      value={name}
      onChange={(event) => setName(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onBlur={() => finish(name.trim() || null)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') finish(name.trim() || null)
        else if (event.key === 'Escape') {
          event.stopPropagation()
          finish(null)
        }
      }}
    />
  )
}

/** Theme presets: built-in and saved looks as preview cards, plus saving the current look. */
export default function ThemePresets({ value, onChange }: Props) {
  // Auto presets preview in the system's current mode.
  const systemDark = useResolvedDark('system')
  const [editing, setEditing] = useState<string | null>(null)
  const current = currentPreset(value)
  const saved = value.themePresets
  const setSaved = (themePresets: ThemePreset[]) => onChange({ ...value, themePresets })

  const card = (preset: ThemePreset, custom: boolean) => {
    if (editing === preset.id)
      return (
        <span className="preset-card is-editing" key={preset.id}>
          <PresetPreview value={value} preset={preset} dark={systemDark} />
          <NameField
            initial={preset.name}
            label="Preset name"
            onDone={(name) => {
              setEditing(null)
              if (name)
                setSaved(saved.map((item) => (item.id === preset.id ? { ...item, name } : item)))
            }}
          />
        </span>
      )
    const button = (
      <button
        key={preset.id}
        type="button"
        role="radio"
        className="preset-card"
        aria-checked={current?.id === preset.id}
        onClick={() => onChange(applyPreset(value, preset))}
      >
        <PresetPreview value={value} preset={preset} dark={systemDark} />
        <span className="preset-name">{preset.name}</span>
      </button>
    )
    if (!custom) return button
    return (
      <NoteContextMenu
        key={preset.id}
        disabled={false}
        actions={[
          { label: 'Rename', icon: Pencil, run: () => setEditing(preset.id) },
          {
            label: 'Delete',
            icon: Trash2,
            run: () => setSaved(saved.filter((item) => item.id !== preset.id)),
          },
        ]}
      >
        {button}
      </NoteContextMenu>
    )
  }

  return (
    <div className="theme-presets">
      <span className="preset-cards" role="radiogroup" aria-label="Theme preset">
        {builtInPresets.map((preset) => card(preset, false))}
        {saved.map((preset) => card(preset, true))}
        {editing === 'new' ? (
          <span className="preset-card is-editing">
            <span className="preset-preview is-new" aria-hidden="true">
              <Plus />
            </span>
            <NameField
              initial={`My theme ${saved.length + 1}`}
              label="New preset name"
              onDone={(name) => {
                setEditing(null)
                if (name)
                  setSaved([
                    ...saved,
                    { id: crypto.randomUUID(), name, settings: presetSettingsFrom(value) },
                  ])
              }}
            />
          </span>
        ) : (
          <button type="button" className="preset-card" onClick={() => setEditing('new')}>
            <span className="preset-preview is-new" aria-hidden="true">
              <Plus />
            </span>
            <span className="preset-name">Save current</span>
          </button>
        )}
      </span>
    </div>
  )
}

function PresetPreview({
  value,
  preset,
  dark,
}: {
  value: Appearance
  preset: ThemePreset
  dark: boolean
}) {
  return (
    <span
      className="preset-preview"
      aria-hidden="true"
      style={presetPreview(value, preset, dark) as CSSProperties}
    >
      <span className="preset-preview-side">
        <i />
        <i />
        <i />
      </span>
      <span className="preset-preview-page">
        <i />
        <i />
        <i />
      </span>
    </span>
  )
}
