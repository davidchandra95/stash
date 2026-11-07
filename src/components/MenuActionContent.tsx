import { Check, type IconComponent } from '../icons'

export default function MenuActionContent({
  icon: Icon,
  label,
  color,
  checked,
}: {
  icon: IconComponent
  label: string
  /** Shows a swatch of this CSS color in place of the icon. */
  color?: string
  /** Leaves a check column; true shows the checkmark. */
  checked?: boolean
}) {
  return (
    <>
      {checked !== undefined && (
        <span className="menu-check" aria-hidden="true">
          {checked && <Check />}
        </span>
      )}
      {color ? (
        <span className="menu-swatch" style={{ background: color }} aria-hidden="true" />
      ) : (
        <Icon className="menu-icon" aria-hidden="true" />
      )}
      <span className="menu-text">{label}</span>
    </>
  )
}
