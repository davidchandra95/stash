import { useShortcutLabel } from '../useShortcuts'
import { useMotionEnabled } from '../motion'
import { useState, useContext } from 'react'
import { ShortcutContext } from '../useShortcuts'
import { bindingFor } from '../shortcuts'
import { showNativeContextMenu, usesNativeContextMenu } from '../nativeContextMenu'
import * as Context from '@radix-ui/react-context-menu'
import type { CSSProperties, ReactElement } from 'react'
import type { IconComponent } from '../icons'
import MenuActionContent from './MenuActionContent'
export type NoteAction = {
  shortcutId?: string
  label: string
  icon: IconComponent
  run: (launcher?: HTMLElement) => void
  separator?: boolean
  disabled?: boolean
}
export default function NoteContextMenu({
  children,
  actions,
  dark,
  palette,
  style,
  disabled,
}: {
  children: ReactElement
  actions: NoteAction[]
  dark: boolean
  palette: string
  style: CSSProperties
  disabled: boolean
}) {
  const overrides = useContext(ShortcutContext)
  const shortcutLabel = useShortcutLabel()
  const motionActive = useMotionEnabled()
  const [open, setOpen] = useState(false)
  return (
    <Context.Root onOpenChange={setOpen}>
      <Context.Trigger
        asChild
        disabled={disabled}
        onContextMenu={(event) => {
          if (disabled || !usesNativeContextMenu()) return
          event.preventDefault()
          const launcher = event.currentTarget
          launcher.dataset.state = 'open'
          void showNativeContextMenu(
            actions,
            launcher,
            { x: event.clientX, y: event.clientY },
            (id) => bindingFor(id, overrides),
          )
            .catch((error) => {
              console.error('Native context menu failed', error)
              window.alert('Could not open the context menu. Please try again.')
            })
            .finally(() => {
              delete launcher.dataset.state
            })
        }}
        onKeyDown={(event) => {
          if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') {
            event.preventDefault()
            const rect = event.currentTarget.getBoundingClientRect()
            event.currentTarget.dispatchEvent(
              new MouseEvent('contextmenu', {
                bubbles: true,
                clientX: rect.left + 24,
                clientY: rect.top + 20,
              }),
            )
          }
        }}
      >
        {children}
      </Context.Trigger>
      {(open || motionActive) && (
        <Context.Portal>
          <Context.Content
            inert={!open}
            onCloseAutoFocus={(event) => {
              if (document.querySelector('.notebook-popover')) event.preventDefault()
            }}
            className="workspace-action-menu note-actions-menu"
            style={style}
            data-theme={dark ? 'dark' : 'light'}
            data-palette={palette}
            collisionPadding={8}
          >
            {actions.map((action) => (
              <div key={action.label}>
                {action.separator && <Context.Separator />}
                <Context.Item
                  aria-label={action.label}
                  disabled={disabled || action.disabled}
                  onSelect={(event) => action.run(event.currentTarget as HTMLElement)}
                >
                  <MenuActionContent icon={action.icon} label={action.label} />
                  {action.shortcutId && shortcutLabel(action.shortcutId) !== 'Unassigned' && (
                    <kbd aria-hidden="true">{shortcutLabel(action.shortcutId)}</kbd>
                  )}
                </Context.Item>
              </div>
            ))}
          </Context.Content>
        </Context.Portal>
      )}
    </Context.Root>
  )
}
