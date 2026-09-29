import {
  Archive,
  Book,
  Briefcase,
  Calendar,
  Camera,
  Coffee,
  Dumbbell,
  Flag,
  Folder,
  Gamepad2,
  Globe,
  GraduationCap,
  Heart,
  Home,
  Lightbulb,
  MapPin,
  Music,
  Notebook,
  Palette,
  PenLine,
  Plane,
  ShoppingBag,
  Star,
  Target,
  type IconComponent,
} from './icons'
import type { NotebookIcon } from './model'

export const notebookIconOptions: { id: NotebookIcon; label: string; icon: IconComponent }[] = [
  { id: 'notebook', label: 'Notebook', icon: Notebook },
  { id: 'book', label: 'Book', icon: Book },
  { id: 'folder', label: 'Folder', icon: Folder },
  { id: 'briefcase', label: 'Briefcase', icon: Briefcase },
  { id: 'graduationCap', label: 'Graduation cap', icon: GraduationCap },
  { id: 'home', label: 'Home', icon: Home },
  { id: 'heart', label: 'Heart', icon: Heart },
  { id: 'star', label: 'Star', icon: Star },
  { id: 'lightbulb', label: 'Lightbulb', icon: Lightbulb },
  { id: 'target', label: 'Target', icon: Target },
  { id: 'plane', label: 'Plane', icon: Plane },
  { id: 'archive', label: 'Archive', icon: Archive },
  { id: 'calendar', label: 'Calendar', icon: Calendar },
  { id: 'camera', label: 'Camera', icon: Camera },
  { id: 'coffee', label: 'Coffee', icon: Coffee },
  { id: 'dumbbell', label: 'Dumbbell', icon: Dumbbell },
  { id: 'flag', label: 'Flag', icon: Flag },
  { id: 'gamepad', label: 'Gamepad', icon: Gamepad2 },
  { id: 'globe', label: 'Globe', icon: Globe },
  { id: 'mapPin', label: 'Map pin', icon: MapPin },
  { id: 'music', label: 'Music', icon: Music },
  { id: 'palette', label: 'Palette', icon: Palette },
  { id: 'penLine', label: 'Pen', icon: PenLine },
  { id: 'shoppingBag', label: 'Shopping bag', icon: ShoppingBag },
]

const iconMap = new Map(notebookIconOptions.map((option) => [option.id, option.icon]))

export function isNotebookIcon(value: unknown): value is NotebookIcon {
  return typeof value === 'string' && iconMap.has(value as NotebookIcon)
}

export function NotebookIconGlyph({
  icon,
  color,
  size = 17,
  ...props
}: {
  icon?: NotebookIcon | string | null
  color?: string
  size?: number
  className?: string
  'aria-hidden'?: boolean
}) {
  const Icon = iconMap.get(icon as NotebookIcon) ?? Notebook
  return <Icon size={size} style={color ? { color } : undefined} {...props} />
}
