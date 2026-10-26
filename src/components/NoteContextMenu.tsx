import AppTooltip from './AppTooltip'
import { useShortcutLabel } from '../useShortcuts'
import { useMotionEnabled } from '../motion'
import {
  forwardRef,
  useState,
  useContext,
  useEffect,
  useRef,
  type ComponentPropsWithoutRef,
  type ComponentRef,
} from 'react'
import { ShortcutContext } from '../useShortcuts'
import { bindingFor } from '../shortcuts'
import { showNativeContextMenu, usesNativeContextMenu } from '../nativeContextMenu'
import * as Context from '@radix-ui/react-context-menu'
import type { ReactElement } from 'react'
import type { IconComponent } from '../icons'
import MenuActionContent from './MenuActionContent'
// Tooltip.Trigger and Context.Trigger both use data-state. Let the context
// trigger own that attribute so menu tracking still controls row highlighting.
const ContextTooltipTrigger = forwardRef<
  ComponentRef<typeof Context.Trigger>,
  ComponentPropsWithoutRef<typeof Context.Trigger> & { 'data-state'?: string }
>(function ContextTooltipTrigger({ 'data-state': _, ...props }, ref) {
  return <Context.Trigger {...props} ref={ref} />
})
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
  disabled,
  tooltipLabel,
  onTrackingChange,
  onRestoreFocus,
}: {
  children: ReactElement
  /** A function is called only when the menu opens, so rows can skip building actions. */
  actions: NoteAction[] | (() => NoteAction[])
  disabled: boolean
  tooltipLabel?: string
  onTrackingChange?: (open: boolean) => void
  onRestoreFocus?: () => void
}) {
  const overrides = useContext(ShortcutContext)
  const shortcutLabel = useShortcutLabel()
  const motionActive = useMotionEnabled()
  const [open, setOpen] = useState(false)
  // Kept through the close animation.
  const openedActions = useRef<NoteAction[]>([])
  const trackingCallback = useRef(onTrackingChange)
  trackingCallback.current = onTrackingChange
  useEffect(() => () => trackingCallback.current?.(false), [])
  return (
    <Context.Root
      onOpenChange={(next) => {
        if (next && typeof actions === 'function') openedActions.current = actions()
        setOpen(next)
        // Closing content restores focus asynchronously. Retain its trigger
        // until onCloseAutoFocus has handed focus back to the virtual list.
        if (next) trackingCallback.current?.(true)
      }}
    >
      <AppTooltip label={tooltipLabel}>
        <ContextTooltipTrigger
          asChild
          disabled={disabled}
          onContextMenu={(event) => {
            if (disabled || !usesNativeContextMenu()) return
            event.preventDefault()
            const launcher = event.currentTarget
            launcher.dataset.state = 'open'
            // Native menu tracking does not open the Radix menu. Both paths must
            // retain their launcher while a virtual list moves past it.
            trackingCallback.current?.(true)
            void showNativeContextMenu(
              typeof actions === 'function' ? actions() : actions,
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
                trackingCallback.current?.(false)
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
        </ContextTooltipTrigger>
      </AppTooltip>
      {(open || motionActive) && (
        <Context.Portal>
          <Context.Content
            inert={!open}
            onCloseAutoFocus={(event) => {
              if (document.querySelector('.notebook-popover')) event.preventDefault()
              else if (onRestoreFocus) {
                event.preventDefault()
                onRestoreFocus()
              }
              trackingCallback.current?.(false)
            }}
            className="menu"
            collisionPadding={8}
          >
            {(typeof actions === 'function' ? openedActions.current : actions).map((action) => (
              <div key={action.label} role="none">
                {action.separator && <Context.Separator className="menu-separator" />}
                <Context.Item
                  className="menu-item"
                  aria-label={action.label}
                  disabled={disabled || action.disabled}
                  onSelect={(event) => action.run(event.currentTarget as HTMLElement)}
                >
                  <MenuActionContent icon={action.icon} label={action.label} />
                  {action.shortcutId && shortcutLabel(action.shortcutId) !== 'Unassigned' && (
                    <span className="menu-shortcut" aria-hidden="true">
                      {shortcutLabel(action.shortcutId)}
                    </span>
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
