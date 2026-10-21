import type { ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from '../icons'

/** A bottom sheet, or the navigation drawer. Theme comes from <html data-theme>. */
export default function MobileSheet({
  title,
  close,
  children,
  drawer,
}: {
  title: string
  close: () => void
  children: ReactNode
  drawer?: boolean
}) {
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="mobile-scrim" />
        <Dialog.Content
          className={drawer ? 'mobile-drawer' : 'mobile-sheet'}
          onOpenAutoFocus={(e) => {
            e.preventDefault()
          }}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <header>
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close className="icon-btn" aria-label={`Close ${title}`}>
              <X aria-hidden="true" />
            </Dialog.Close>
          </header>
          <Dialog.Description className="sr-only">
            {drawer ? 'Choose a library view or notebook.' : `${title} options`}
          </Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
