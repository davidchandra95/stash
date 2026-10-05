import AppTooltip from './AppTooltip'
import { fontFamily } from '../fonts'
import {
  defaultHeadingStyles,
  headingColorOptions,
  headingLevels,
  headingWeights,
  type HeadingLevel,
  type HeadingStyle,
  type HeadingStyles,
} from '../headingStyles'
import FontPicker from './FontPicker'

const desktopFonts = [
  { value: '', label: 'Use note font' },
  { value: 'georgia', label: 'Georgia' },
  { value: 'system', label: 'System Sans' },
  { value: 'palatino', label: 'Palatino' },
  { value: 'avenir', label: 'Avenir Next' },
]

const mobileFonts = [
  { value: '', label: 'Use note font' },
  { value: 'system', label: 'System sans' },
  { value: 'georgia', label: 'System serif' },
  { value: 'menlo', label: 'System monospace' },
]

const weightLabels: Record<(typeof headingWeights)[number], string> = {
  400: 'Regular',
  500: 'Medium',
  600: 'Semibold',
  700: 'Bold',
}

function fontLabel(value: string) {
  return value.startsWith('font:') ? value.slice(5) : value
}

export default function HeadingStyles({
  styles,
  noteFont,
  installed,
  dark,
  palette,
  mobile = false,
  onChange,
}: {
  styles: HeadingStyles
  noteFont: string
  installed: string[]
  dark: boolean
  palette: string
  mobile?: boolean
  onChange: (styles: HeadingStyles) => void
}) {
  const update = (level: HeadingLevel, patch: Partial<HeadingStyle>) =>
    onChange({ ...styles, [level]: { ...styles[level], ...patch } })
  const reset = (level: HeadingLevel) =>
    onChange({ ...styles, [level]: defaultHeadingStyles()[level] })

  return (
    <div className="heading-styles">
      {headingLevels.map((level) => {
        const style = styles[level]
        const label = level.toUpperCase()
        const currentFont = style.font ?? noteFont
        const mobileOptions = [
          ...mobileFonts,
          ...(style.font && !mobileFonts.some((option) => option.value === style.font)
            ? [{ value: style.font, label: fontLabel(style.font) }]
            : []),
        ]
        return (
          <details className="heading-style" key={level}>
            <summary>
              <span
                className={`heading-style-preview ${level}`}
                style={{
                  color: style.color ?? 'var(--text)',
                  fontFamily: fontFamily(currentFont),
                  fontStyle: style.italic ? 'italic' : 'normal',
                  fontWeight: style.weight,
                }}
              >
                {label}
              </span>
              <span className="heading-style-summary">Heading {label.slice(1)}</span>
            </summary>
            <div className="heading-style-controls">
              <label className="heading-style-control">
                <span>Font</span>
                {mobile ? (
                  <select
                    aria-label={`Heading ${label.slice(1)} font`}
                    value={style.font ?? ''}
                    onChange={(event) => update(level, { font: event.target.value || null })}
                  >
                    {mobileOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <FontPicker
                    label={`Heading ${label.slice(1)} font`}
                    value={style.font ?? ''}
                    inheritedFont={noteFont}
                    presetOptions={desktopFonts}
                    installed={installed}
                    dark={dark}
                    palette={palette}
                    onChange={(font) => update(level, { font: font || null })}
                  />
                )}
              </label>
              <label className="heading-style-control">
                <span>Weight</span>
                <select
                  aria-label={`Heading ${label.slice(1)} weight`}
                  value={style.weight}
                  onChange={(event) =>
                    update(level, { weight: Number(event.target.value) as HeadingStyle['weight'] })
                  }
                >
                  {headingWeights.map((weight) => (
                    <option value={weight} key={weight}>
                      {weightLabels[weight]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="heading-style-toggle">
                <span>Italic</span>
                <input
                  aria-label={`Heading ${label.slice(1)} italic`}
                  type="checkbox"
                  role="switch"
                  checked={style.italic}
                  onChange={(event) => update(level, { italic: event.target.checked })}
                />
              </label>
              <div
                className="heading-color-control"
                role="group"
                aria-label={`Heading ${label.slice(1)} color`}
              >
                <span>Color</span>
                <div className="heading-color-swatches">
                  {headingColorOptions.map((option) => (
                    <AppTooltip label={option.label} key={option.label}>
                      <button
                        type="button"
                        className="heading-color-swatch"
                        data-default={option.value === null || undefined}
                        aria-label={`Heading ${label.slice(1)} color: ${option.label}`}
                        aria-pressed={style.color === option.value}
                        style={option.value ? { backgroundColor: option.value } : undefined}

                        onClick={() => update(level, { color: option.value })}
                      />
                    </AppTooltip>
                  ))}
                </div>
                <label className="heading-custom-color">
                  <span className="settings-sr-only">
                    Custom color for Heading {label.slice(1)}
                  </span>
                  <input
                    aria-label={`Custom color for Heading ${label.slice(1)}`}
                    type="color"
                    value={style.color ?? '#000000'}
                    onChange={(event) => update(level, { color: event.target.value })}
                  />
                  <output>{style.color?.toUpperCase() ?? 'Theme default'}</output>
                </label>
              </div>
              <button type="button" className="heading-style-reset" onClick={() => reset(level)}>
                Reset Heading {label.slice(1)}
              </button>
            </div>
          </details>
        )
      })}
    </div>
  )
}
