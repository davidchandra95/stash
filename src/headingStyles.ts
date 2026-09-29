import { fontFamily } from './fonts'

export const headingLevels = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const
export type HeadingLevel = (typeof headingLevels)[number]

export const headingWeights = [400, 500, 600, 700] as const
export type HeadingWeight = (typeof headingWeights)[number]

export type HeadingStyle = {
  font: string | null
  weight: HeadingWeight
  italic: boolean
  color: string | null
}

export type HeadingStyles = Record<HeadingLevel, HeadingStyle>

export const headingColorOptions: ReadonlyArray<{ label: string; value: string | null }> = [
  { label: 'Default', value: null },
  { label: 'Red', value: '#a83432' },
  { label: 'Orange', value: '#ad5b13' },
  { label: 'Yellow', value: '#7b6513' },
  { label: 'Green', value: '#387342' },
  { label: 'Blue', value: '#216f9c' },
  { label: 'Purple', value: '#7655ae' },
]

const defaultHeadingStyle = (): HeadingStyle => ({
  font: null,
  weight: 600,
  italic: false,
  color: null,
})

export function defaultHeadingStyles(): HeadingStyles {
  return {
    h1: defaultHeadingStyle(),
    h2: defaultHeadingStyle(),
    h3: defaultHeadingStyle(),
    h4: defaultHeadingStyle(),
    h5: defaultHeadingStyle(),
    h6: defaultHeadingStyle(),
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function validColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
}

function normalizeHeadingStyle(value: unknown): HeadingStyle {
  const style = record(value)
  const font = typeof style?.font === 'string' && style.font.trim() ? style.font : null
  const weight = headingWeights.includes(style?.weight as HeadingWeight)
    ? (style!.weight as HeadingWeight)
    : 600
  return {
    font,
    weight,
    italic: style?.italic === true,
    color: validColor(style?.color) ? style!.color : null,
  }
}

export function normalizeHeadingStyles(value: unknown): HeadingStyles {
  const styles = record(value)
  return Object.fromEntries(
    headingLevels.map((level) => [level, normalizeHeadingStyle(styles?.[level])]),
  ) as HeadingStyles
}

export function headingStyleVariables(
  styles: HeadingStyles,
  noteFont: string,
): Record<string, string> {
  return Object.fromEntries(
    headingLevels.flatMap((level) => {
      const style = styles[level]
      return [
        [`--heading-${level}-font`, fontFamily(style.font ?? noteFont)],
        [`--heading-${level}-weight`, String(style.weight)],
        [`--heading-${level}-style`, style.italic ? 'italic' : 'normal'],
        [`--heading-${level}-color`, style.color ?? 'var(--text)'],
      ]
    }),
  )
}
