import * as Dropdown from '@radix-ui/react-dropdown-menu'
import { RefreshCw, Settings2, Trash2, UserRound } from '../icons'
import { useRef } from 'react'
import MenuActionContent from './MenuActionContent'
import type { LibraryState } from '../storage/library'

export default function AccountMenu({
  state,
  trashCount,
  trashSelected,
  dark,
  palette,
  settingsTitle,
  onSync,
  onTrash,
  onSettings,
}: {
  state: LibraryState
  trashCount: number
  trashSelected: boolean
  dark: boolean
  palette: string
  settingsTitle: string
  onSync: () => void
  onTrash: () => void
  onSettings: () => void
}) {
  const blocked = state.quitting || state.syncing || state.converting
  const triggerRef = useRef<HTMLButtonElement>(null)
  const restoreFocusAfterEscape = useRef(false)

  return (
    <Dropdown.Root>
      <Dropdown.Trigger
        ref={triggerRef}
        className="account-trigger"
        aria-label="David account menu"
        disabled={blocked}
      >
        <span className="account-avatar" aria-hidden="true">
          <UserRound />
        </span>
        <span className="account-name">David</span>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          className="workspace-action-menu account-menu"
          data-theme={dark ? 'dark' : 'light'}
          data-palette={palette}
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={8}
          aria-label="Account menu"
          onEscapeKeyDown={() => {
            restoreFocusAfterEscape.current = true
          }}
          onCloseAutoFocus={(event) => {
            if (!restoreFocusAfterEscape.current) return
            event.preventDefault()
            restoreFocusAfterEscape.current = false
            triggerRef.current?.focus()
          }}
        >
          {!state.preview && (
            <Dropdown.Item onSelect={onSync}>
              <MenuActionContent icon={RefreshCw} label="Sync" />
            </Dropdown.Item>
          )}
          <Dropdown.Item aria-current={trashSelected ? 'page' : undefined} onSelect={onTrash}>
            <MenuActionContent icon={Trash2} label="Trash" />
            {trashCount > 0 && <span className="account-menu-count">{trashCount}</span>}
          </Dropdown.Item>
          <Dropdown.Item onSelect={onSettings} title={settingsTitle}>
            <MenuActionContent icon={Settings2} label="Settings" />
          </Dropdown.Item>
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  )
}
