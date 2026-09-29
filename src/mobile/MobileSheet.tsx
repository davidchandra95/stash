import type { ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from '../icons'

export default function MobileSheet({
  title,
  close,
  children,
  drawer,
  dark,
  palette,
}: {
  title: string
  close: () => void
  children: ReactNode
  drawer?: boolean
  dark: boolean
  palette: string
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
          data-theme={dark ? 'dark' : 'light'}
          data-palette={palette}
          onOpenAutoFocus={(e) => {
            e.preventDefault()
          }}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <header>
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close aria-label={`Close ${title}`}>
              <X size={22} />
            </Dialog.Close>
          </header>
          <Dialog.Description className="settings-sr-only">
            {drawer ? 'Choose a library view or notebook.' : `${title} options`}
          </Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
