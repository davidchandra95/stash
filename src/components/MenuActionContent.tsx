import type { IconComponent } from '../icons'

export default function MenuActionContent({
  icon: Icon,
  label,
}: {
  icon: IconComponent
  label: string
}) {
  return (
    <>
      <Icon className="menu-action-icon" aria-hidden="true" />
      <span className="menu-action-label">{label}</span>
    </>
  )
}
