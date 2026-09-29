import { useRef, type ReactNode } from 'react'
import * as Popover from '@radix-ui/react-popover'
import type { Appearance } from '../model'
import { fontFamily } from '../fonts'

export type PopoverAnchor = { left: number; top: number; width: number; height: number }
export type NotebookPopoverPosition = { anchor: PopoverAnchor; launcher: HTMLElement | null }

export default function NotebookPopover({
  anchor,
  launcher,
  noteId,
  appearance,
  close,
  title,
  className,
  children,
}: NotebookPopoverPosition & {
  noteId: string
  appearance: Appearance
  close: () => void
  title: string
  className: string
  children: ReactNode
}) {
  const content = useRef<HTMLDivElement>(null)
  const outside = useRef(false)
  const virtualAnchor = useRef({ getBoundingClientRect: () => new DOMRect() })
  virtualAnchor.current = {
    getBoundingClientRect: () => new DOMRect(anchor.left, anchor.top, anchor.width, anchor.height),
  }
  const restoreFocus = () => {
    const row = [...document.querySelectorAll<HTMLElement>('.note-row')].find(
      (el) => el.dataset.noteId === noteId,
    )
    const target = launcher?.isConnected
      ? launcher
      : (row ?? document.querySelector<HTMLElement>('[aria-label="Note actions"]'))
    target?.focus({ preventScroll: true })
  }
  return (
    <Popover.Root
      open
      modal={false}
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <Popover.Anchor virtualRef={virtualAnchor} />
      <Popover.Portal>
        <Popover.Content
          ref={content}
          className={`notebook-popover ${className}`}
          data-theme={appearance.dark ? 'dark' : 'light'}
          data-palette={appearance.theme}
          aria-label={title}
          side="bottom"
          align="start"
          sideOffset={5}
          collisionPadding={10}
          style={{ fontFamily: fontFamily(appearance.uiFont) }}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            const search = content.current?.querySelector<HTMLElement>(
              '[aria-label="Search notebooks"]',
            )
            const firstInput = content.current?.querySelector<HTMLElement>(
              'input:not(:disabled), button:not(:disabled)',
            )
            ;(search ?? firstInput)?.focus()
          }}
          onEscapeKeyDown={(event) => {
            event.preventDefault()
            restoreFocus()
            close()
          }}
          onPointerDownOutside={() => {
            outside.current = true
          }}
          onFocusOutside={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            // Do not steal focus from an outside target or a newly opened picker.
            if (!outside.current && document.activeElement === document.body) restoreFocus()
          }}
        >
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
