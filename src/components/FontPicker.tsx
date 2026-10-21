import { useEffect, useRef, useState } from 'react'
import * as Dropdown from '@radix-ui/react-dropdown-menu'
import { Check, ChevronDown, Search } from '../icons'
import { fontFamily } from '../fonts'

export type FontOption = {
  value: string
  label: string
}

type FontPickerProps = {
  label: string
  value: string
  inheritedFont?: string
  presetOptions: FontOption[]
  installed: string[]
  onChange: (value: string) => void
}

function selectedLabel(value: string, options: FontOption[]): string {
  return (
    options.find((option) => option.value === value)?.label ??
    (value.startsWith('font:') ? value.slice(5) : value)
  )
}

export default function FontPicker({
  label,
  value,
  inheritedFont,
  presetOptions,
  installed,
  onChange,
}: FontPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const installedOptions = [...new Set(installed)].map((name) => ({
    value: `font:${name}`,
    label: name,
  }))
  const currentOption =
    value.startsWith('font:') && !installed.includes(value.slice(5))
      ? [{ value, label: value.slice(5) }]
      : []
  const groups = [
    ...(currentOption.length ? [{ label: 'Current selection', options: currentOption }] : []),
    { label: 'Presets', options: presetOptions },
    ...(installedOptions.length
      ? [{ label: 'Installed on this Mac', options: installedOptions }]
      : []),
  ]
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visibleGroups = groups
    .map((group) => ({
      ...group,
      options: group.options.filter(
        (option) =>
          !normalizedQuery ||
          `${option.label} ${option.value}`.toLocaleLowerCase().includes(normalizedQuery),
      ),
    }))
    .filter((group) => group.options.length)
  const allOptions = groups.flatMap((group) => group.options)
  const previewFont = (font: string) => fontFamily(font || inheritedFont || 'system')

  const changeOpen = (next: boolean) => {
    setOpen(next)
    if (!next) setQuery('')
  }

  useEffect(() => {
    if (!open) return
    const focusSearch = window.setTimeout(() => searchRef.current?.focus(), 0)
    return () => window.clearTimeout(focusSearch)
  }, [open])

  return (
    <span className="font-picker">
      <Dropdown.Root open={open} onOpenChange={changeOpen}>
        <Dropdown.Trigger
          ref={triggerRef}
          className="select font-picker-trigger"
          aria-label={label}
          style={{ fontFamily: previewFont(value) }}
        >
          <span>{selectedLabel(value, allOptions)}</span>
          <ChevronDown aria-hidden="true" />
        </Dropdown.Trigger>
        <Dropdown.Portal>
          <Dropdown.Content
            className="menu font-picker-dropdown"
            sideOffset={5}
            align="end"
            collisionPadding={8}
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              triggerRef.current?.focus()
            }}
          >
            <div className="font-picker-search field-shell">
              <Search aria-hidden="true" />
              <input
                ref={searchRef}
                aria-label={`Search ${label}`}
                placeholder="Search fonts…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    changeOpen(false)
                  } else {
                    event.stopPropagation()
                  }
                }}
                autoComplete="off"
              />
            </div>
            <div className="font-picker-list">
              {visibleGroups.length ? (
                <Dropdown.RadioGroup
                  value={value}
                  onValueChange={(next) => {
                    onChange(next)
                    changeOpen(false)
                  }}
                >
                  {visibleGroups.map((group) => (
                    <Dropdown.Group className="font-picker-group" key={group.label}>
                      <Dropdown.Label className="menu-label indented">{group.label}</Dropdown.Label>
                      {group.options.map((option) => (
                        <Dropdown.RadioItem
                          className="menu-item font-picker-option"
                          key={option.value}
                          value={option.value}
                          textValue={option.label}
                          data-font-value={option.value}
                        >
                          <span className="menu-check">
                            <Dropdown.ItemIndicator>
                              <Check aria-hidden="true" />
                            </Dropdown.ItemIndicator>
                          </span>
                          <span
                            className="menu-text font-picker-option-label"
                            style={{ fontFamily: previewFont(option.value) }}
                          >
                            {option.label}
                          </span>
                        </Dropdown.RadioItem>
                      ))}
                    </Dropdown.Group>
                  ))}
                </Dropdown.RadioGroup>
              ) : (
                <div className="menu-empty" role="status">
                  No fonts found.
                </div>
              )}
            </div>
          </Dropdown.Content>
        </Dropdown.Portal>
      </Dropdown.Root>
    </span>
  )
}
