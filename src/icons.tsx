import { invoke, isTauri } from '@tauri-apps/api/core'
import { forwardRef, useId } from 'react'
import type { LucideProps } from 'lucide-react'
import * as Lucide from 'lucide-react'
import { platform } from './platform'

export type IconComponent = Lucide.LucideIcon

const names = new Map<IconComponent, string>()
const images = new Map<string, string>()

function icon(Fallback: IconComponent, symbol: string): IconComponent {
  const Icon = forwardRef<SVGSVGElement, LucideProps>(function PlatformIcon(
    { size = 24, className, style, ...props },
    ref,
  ) {
    const maskId = `sf-${useId().replace(/:/g, '')}`
    const image = platform.platform === 'macos' && isTauri() ? images.get(symbol) : undefined
    if (!image)
      return <Fallback ref={ref} size={size} className={className} style={style} {...props} />
    return (
      <svg
        ref={ref}
        width={size}
        height={size}
        viewBox="0 0 24 24"
        className={className}
        style={style}
        {...props}
      >
        <defs>
          {/* WebKit needs the SVG alpha mask attribute to preserve the symbol shape. */}
          <mask
            id={maskId}
            {...{ 'mask-type': 'alpha' }}
            maskUnits="userSpaceOnUse"
            x="2"
            y="2"
            width="20"
            height="20"
          >
            <image
              href={image}
              x="2"
              y="2"
              width="20"
              height="20"
              preserveAspectRatio="xMidYMid meet"
            />
          </mask>
        </defs>
        <rect x="2" y="2" width="20" height="20" fill="currentColor" mask={`url(#${maskId})`} />
      </svg>
    )
  }) as IconComponent
  names.set(Icon, symbol)
  return Icon
}

export function sfSymbolFor(Icon: IconComponent): string | undefined {
  return names.get(Icon)
}

export async function initializeSymbols(): Promise<void> {
  if (platform.platform !== 'macos' || !isTauri()) return
  const rendered = await invoke<Record<string, string>>('render_symbols', {
    names: [...new Set(names.values())],
  })
  for (const [name, image] of Object.entries(rendered)) images.set(name, image)
}

export const AlertTriangle = icon(Lucide.AlertTriangle, 'exclamationmark.triangle')
export const AlignLeft = icon(Lucide.AlignLeft, 'text.alignleft')
export const Archive = icon(Lucide.Archive, 'archivebox')
export const ArchiveRestore = icon(Lucide.ArchiveRestore, 'arrow.up.bin')
export const ArrowDown = icon(Lucide.ArrowDown, 'arrow.down')
export const ArrowDownWideNarrow = icon(Lucide.ArrowDownWideNarrow, 'line.3.horizontal.decrease')
export const ArrowLeft = icon(Lucide.ArrowLeft, 'arrow.left')
export const ArrowRight = icon(Lucide.ArrowRight, 'arrow.right')
export const ArrowUp = icon(Lucide.ArrowUp, 'arrow.up')
export const Bold = icon(Lucide.Bold, 'bold')
export const Book = icon(Lucide.Book, 'book')
export const BookOpen = icon(Lucide.BookOpen, 'book.pages')
export const Briefcase = icon(Lucide.Briefcase, 'briefcase')
export const Calendar = icon(Lucide.Calendar, 'calendar')
export const CalendarDays = icon(Lucide.CalendarDays, 'calendar')
export const Camera = icon(Lucide.Camera, 'camera')
export const Check = icon(Lucide.Check, 'checkmark')
export const ChevronDown = icon(Lucide.ChevronDown, 'chevron.down')
export const ChevronRight = icon(Lucide.ChevronRight, 'chevron.right')
export const Code = icon(Lucide.Code, 'chevron.left.forwardslash.chevron.right')
export const Code2 = icon(Lucide.Code2, 'chevron.left.forwardslash.chevron.right')
export const Coffee = icon(Lucide.Coffee, 'cup.and.saucer')
export const Copy = icon(Lucide.Copy, 'doc.on.doc')
export const Dumbbell = icon(Lucide.Dumbbell, 'dumbbell')
export const ExternalLink = icon(Lucide.ExternalLink, 'arrow.up.right.square')
export const Feather = icon(Lucide.Feather, 'pencil.tip')
export const FilePlus2 = icon(Lucide.FilePlus2, 'square.and.pencil')
export const FileText = icon(Lucide.FileText, 'doc.text')
export const Files = icon(Lucide.Files, 'doc.on.doc')
export const Flag = icon(Lucide.Flag, 'flag')
export const Folder = icon(Lucide.Folder, 'folder')
export const FolderInput = icon(Lucide.FolderInput, 'folder')
export const FolderOpen = icon(Lucide.FolderOpen, 'folder')
export const FolderPlus = icon(Lucide.FolderPlus, 'folder.badge.plus')
export const Gamepad2 = icon(Lucide.Gamepad2, 'gamecontroller')
export const Globe = icon(Lucide.Globe, 'globe')
export const GraduationCap = icon(Lucide.GraduationCap, 'graduationcap')
export const Heart = icon(Lucide.Heart, 'heart')
export const Highlighter = icon(Lucide.Highlighter, 'highlighter')
export const Home = icon(Lucide.Home, 'house')
export const ImagePlus = icon(Lucide.ImagePlus, 'photo.badge.plus')
export const Inbox = icon(Lucide.Inbox, 'tray')
export const IndentDecrease = icon(Lucide.IndentDecrease, 'decrease.indent')
export const IndentIncrease = icon(Lucide.IndentIncrease, 'increase.indent')
export const Info = icon(Lucide.Info, 'info.circle')
export const Italic = icon(Lucide.Italic, 'italic')
export const Keyboard = icon(Lucide.Keyboard, 'keyboard')
export const Lightbulb = icon(Lucide.Lightbulb, 'lightbulb')
export const Link = icon(Lucide.Link, 'link')
export const Link2 = icon(Lucide.Link2, 'link')
export const List = icon(Lucide.List, 'list.bullet')
export const ListOrdered = icon(Lucide.ListOrdered, 'list.number')
export const ListTodo = icon(Lucide.ListTodo, 'checklist')
export const LoaderCircle = icon(Lucide.LoaderCircle, 'arrow.triangle.2.circlepath')
export const MapPin = icon(Lucide.MapPin, 'mappin')
export const Maximize2 = icon(Lucide.Maximize2, 'arrow.up.left.and.arrow.down.right')
export const Menu = icon(Lucide.Menu, 'line.3.horizontal')
export const Minimize2 = icon(Lucide.Minimize2, 'arrow.down.right.and.arrow.up.left')
export const Minus = icon(Lucide.Minus, 'minus')
export const Moon = icon(Lucide.Moon, 'moon')
export const MoreHorizontal = icon(Lucide.MoreHorizontal, 'ellipsis')
export const MoreVertical = icon(Lucide.MoreVertical, 'ellipsis')
export const Music = icon(Lucide.Music, 'music.note')
export const Notebook = icon(Lucide.Notebook, 'book.closed')
export const Palette = icon(Lucide.Palette, 'paintpalette')
export const PanelLeft = icon(Lucide.PanelLeft, 'sidebar.left')
export const PanelLeftClose = icon(Lucide.PanelLeftClose, 'sidebar.left')
export const PanelsTopLeft = icon(Lucide.PanelsTopLeft, 'square.split.2x2')
export const PenLine = icon(Lucide.PenLine, 'pencil.line')
export const Pencil = icon(Lucide.Pencil, 'pencil')
export const Pin = icon(Lucide.Pin, 'pin')
export const PinOff = icon(Lucide.PinOff, 'pin.slash')
export const Plane = icon(Lucide.Plane, 'airplane')
export const Plus = icon(Lucide.Plus, 'plus')
export const Quote = icon(Lucide.Quote, 'quote.opening')
export const Redo2 = icon(Lucide.Redo2, 'arrow.uturn.forward')
export const RefreshCw = icon(Lucide.RefreshCw, 'arrow.clockwise')
export const RotateCcw = icon(Lucide.RotateCcw, 'arrow.counterclockwise')
export const Search = icon(Lucide.Search, 'magnifyingglass')
export const Settings2 = icon(Lucide.Settings2, 'slider.horizontal.3')
export const ShoppingBag = icon(Lucide.ShoppingBag, 'bag')
export const SquareCheck = icon(Lucide.SquareCheck, 'checkmark.square')
export const SquarePen = icon(Lucide.SquarePen, 'square.and.pencil')
export const Star = icon(Lucide.Star, 'star')
export const StarOff = icon(Lucide.StarOff, 'star.slash')
export const Strikethrough = icon(Lucide.Strikethrough, 'strikethrough')
export const Subscript = icon(Lucide.Subscript, 'textformat.subscript')
export const Sun = icon(Lucide.Sun, 'sun.max')
export const Superscript = icon(Lucide.Superscript, 'textformat.superscript')
export const Table2 = icon(Lucide.Table2, 'tablecells')
export const Target = icon(Lucide.Target, 'scope')
export const TextCursorInput = icon(Lucide.TextCursorInput, 'text.cursor')
export const Trash2 = icon(Lucide.Trash2, 'trash')
export const Type = icon(Lucide.Type, 'textformat')
export const Underline = icon(Lucide.Underline, 'underline')
export const Undo2 = icon(Lucide.Undo2, 'arrow.uturn.backward')
export const Unlink2 = icon(Lucide.Unlink2, 'link')
export const UserRound = icon(Lucide.UserRound, 'person.crop.circle')
export const WrapText = icon(Lucide.WrapText, 'text.justify.left')
export const X = icon(Lucide.X, 'xmark')
