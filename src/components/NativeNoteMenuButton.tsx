import { useContext, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { MoreHorizontal } from '../icons'
import { showNativeContextMenu } from '../nativeContextMenu'
import { bindingFor } from '../shortcuts'
import { ShortcutContext } from '../useShortcuts'
import type { NoteAction } from './NoteContextMenu'

export default function NativeNoteMenuButton({
  actions,
  disabled,
  onError,
  label = 'Note actions',
  className = 'icon-button',
  children = <MoreHorizontal size={21} />,
  ...props
}: Omit<ComponentProps<'button'>, 'children' | 'onError'> & {
  actions: NoteAction[]
  disabled: boolean
  onError: (error: { message: string; retry: () => void }) => void
  /** Accessible name; icon-only buttons rely on it. */
  label?: string
  children?: ReactNode
}) {
  const shortcuts = useContext(ShortcutContext)
  const button = useRef<HTMLButtonElement>(null)
  const tracking = useRef(false)
  const [open, setOpen] = useState(false)
  const show = () => {
    const launcher = button.current
    if (!launcher || disabled || tracking.current) return
    tracking.current = true
    setOpen(true)
    launcher.focus()
    const rect = launcher.getBoundingClientRect()
    void showNativeContextMenu(actions, launcher, { x: rect.left, y: rect.bottom + 7 }, (id) =>
      bindingFor(id, shortcuts),
    )
      .catch((error) =>
        onError({
          message: `Could not open ${label.toLowerCase()}: ${String(error)}`,
          retry: show,
        }),
      )
      .finally(() => {
        tracking.current = false
        setOpen(false)
      })
  }
  return (
    <button
      {...props}
      ref={button}
      type="button"
      className={className}
      aria-label={label}
      aria-haspopup="menu"
      aria-expanded={open}
      data-state={open ? 'open' : 'closed'}
      disabled={disabled}
      onClick={show}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          show()
        }
      }}
    >
      {children}
    </button>
  )
}
