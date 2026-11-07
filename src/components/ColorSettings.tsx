import type { CSSProperties } from 'react'
import { surfaceColors } from '../appearance'
import type { Appearance, SurfaceColor } from '../model'

type Props = { value: Appearance; onChange: (next: Appearance) => void }

/** The last accent swatch: opens the system color picker and selects the picked color. */
export function CustomAccentOption({ value, onChange }: Props) {
  const checked = value.accent === 'custom'
  return (
    <label
      className="accent-option is-custom"
      title="Custom color"
      style={{ '--swatch': value.customAccent } as CSSProperties}
    >
      <input
        type="color"
        role="radio"
        aria-label="Custom color"
        aria-checked={checked}
        value={value.customAccent}
        onClick={() => {
          if (!checked) onChange({ ...value, accent: 'custom' })
        }}
        onChange={(event) =>
          onChange({ ...value, accent: 'custom', customAccent: event.target.value.toLowerCase() })
        }
      />
    </label>
  )
}

export function SurfaceColorOptions({ value, onChange }: Props) {
  return (
    <span className="segmented" role="radiogroup" aria-label="Surface color">
      {(Object.keys(surfaceColors) as SurfaceColor[]).map((surface) => (
        <button
          key={surface}
          type="button"
          role="radio"
          aria-checked={value.surfaceColor === surface}
          onClick={() => onChange({ ...value, surfaceColor: surface })}
        >
          {surfaceColors[surface].label}
        </button>
      ))}
    </span>
  )
}
