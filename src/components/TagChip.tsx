import { Hash } from '../icons'
import type { Appearance } from '../model'
import { tagColorChoices, tagColorLabels, tagTone, type TagColor } from '../tags'
import NoteContextMenu, { type NoteAction } from './NoteContextMenu'

/** The menu that picks a tag's color: Automatic (from the tag's name) or one of the tones. */
export function tagColorActions(
  tag: string,
  appearance: Appearance,
  setAppearance: (next: Appearance) => void,
): NoteAction[] {
  const key = tag.toLowerCase()
  const current = appearance.tagColors[key]
  // Native menus need concrete colors, so read the tones the current theme resolves to.
  const styles = getComputedStyle(document.documentElement)
  const tone = (name: string) => styles.getPropertyValue(`--tone-${name}`).trim() || undefined
  const set = (next?: TagColor) => {
    const { [key]: _, ...rest } = appearance.tagColors
    setAppearance({ ...appearance, tagColors: next ? { ...rest, [key]: next } : rest })
  }
  return [
    {
      label: 'Automatic',
      icon: Hash,
      color: tone(tagTone(tag)),
      checked: !current,
      run: () => set(),
    },
    ...tagColorChoices.map((choice, index) => ({
      label: tagColorLabels[choice],
      icon: Hash,
      color: tone(choice),
      checked: current === choice,
      separator: index === 0,
      run: () => set(choice),
    })),
  ]
}

/** A sidebar tag chip; its context menu picks the tag's color. */
export default function TagChip({
  tag,
  selected,
  disabled = false,
  appearance,
  setAppearance,
  onSelect,
}: {
  tag: string
  selected: boolean
  disabled?: boolean
  appearance: Appearance
  setAppearance: (next: Appearance) => void
  onSelect: () => void
}) {
  return (
    <NoteContextMenu
      disabled={disabled}
      actions={() => tagColorActions(tag, appearance, setAppearance)}
    >
      <button
        className={`chip ${selected ? 'is-selected' : ''}`}
        data-tone={tagTone(tag)}
        data-tag={tag}
        aria-current={selected ? 'page' : undefined}
        disabled={disabled}
        onClick={onSelect}
      >
        #{tag}
      </button>
    </NoteContextMenu>
  )
}
