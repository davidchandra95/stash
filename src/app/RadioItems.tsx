import * as Dropdown from '@radix-ui/react-dropdown-menu'
import { Check } from '../icons'

export default function RadioItems<T extends string>({
  labels,
  value,
  onChange,
  label,
}: {
  labels: Record<T, string>
  value: T
  onChange: (value: T) => void
  label: string
}) {
  return (
    <Dropdown.RadioGroup
      value={value}
      onValueChange={(next) => onChange(next as T)}
      aria-label={label}
    >
      {(Object.keys(labels) as T[]).map((key) => (
        <Dropdown.RadioItem key={key} value={key} className="menu-item">
          <span className="menu-check">
            <Dropdown.ItemIndicator>
              <Check aria-hidden="true" />
            </Dropdown.ItemIndicator>
          </span>
          <span className="menu-text">{labels[key]}</span>
        </Dropdown.RadioItem>
      ))}
    </Dropdown.RadioGroup>
  )
}
