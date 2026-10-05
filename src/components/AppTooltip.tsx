import * as Tooltip from '@radix-ui/react-tooltip'
import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useState,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react'
import { createRoot } from 'react-dom/client'

export function AppTooltipProvider({ children }: { children: ReactNode }) {
  return (
    <Tooltip.Provider delayDuration={700} skipDelayDuration={0}>
      {children}
    </Tooltip.Provider>
  )
}

function portalFor(trigger: HTMLElement | null) {
  // Modal portals must stay inside their interactive, themed surface.
  return (
    trigger?.closest<HTMLElement>(
      '[role="dialog"], [role="alertdialog"], [data-radix-popper-content-wrapper] > [data-theme], .app, .mobile-app',
    ) ?? document.body
  )
}

type TooltipLabel = {
  label?: string
  shortcut?: string
  side?: 'top' | 'bottom' | 'left' | 'right'
}

function TooltipContent({
  label,
  shortcut,
  side = 'bottom',
  trigger,
}: TooltipLabel & {
  trigger: HTMLElement | null
}) {
  return (
    <Tooltip.Portal container={portalFor(trigger)}>
      <Tooltip.Content
        className="app-tooltip"
        side={side}
        sideOffset={6}
        collisionPadding={8}
        hideWhenDetached
      >
        <span className="app-tooltip-label">{label}</span>
        {shortcut && shortcut !== 'Unassigned' && (
          <span className="app-tooltip-shortcut">{shortcut}</span>
        )}
      </Tooltip.Content>
    </Tooltip.Portal>
  )
}

export default function AppTooltip({
  label,
  shortcut,
  side,
  instant = false,
  disabled = false,
  children,
}: TooltipLabel & { instant?: boolean; disabled?: boolean; children: ReactElement }) {
  const [trigger, setTrigger] = useState<HTMLElement | null>(null)
  if (!label) return children
  return (
    // Keep timing local so an instant icon cannot skip another hint's delay.
    <Tooltip.Provider delayDuration={instant ? 0 : 700} skipDelayDuration={0}>
      <Tooltip.Root>
        <Tooltip.Trigger
          asChild
          ref={setTrigger}
          data-app-tooltip-trigger=""
          onPointerMove={(event) => {
            // A nested action's tooltip takes precedence over its row's hint.
            if (
              (event.target as Element).closest('[data-app-tooltip-trigger]') !==
              event.currentTarget
            )
              event.preventDefault()
          }}
          onFocus={(event) => {
            if (
              (event.target as Element).closest('[data-app-tooltip-trigger]') !==
              event.currentTarget
            )
              event.preventDefault()
          }}
        >
          {disabled ? <span className="app-tooltip-disabled">{children}</span> : children}
        </Tooltip.Trigger>
        <TooltipContent label={label} shortcut={shortcut} side={side} trigger={trigger} />
      </Tooltip.Root>
    </Tooltip.Provider>
  )
}

// ProseMirror owns these DOM elements. Attach Radix behavior without inserting
// wrappers or changing the node view's content, selection, or saved document.
const DomTrigger = forwardRef<HTMLElement, HTMLAttributes<HTMLElement> & { target: HTMLElement }>(
  function DomTrigger({ target, ...props }, ref) {
    useImperativeHandle(ref, () => target, [target])
    useLayoutEffect(() => {
      const events = {
        pointermove: props.onPointerMove,
        pointerleave: props.onPointerLeave,
        pointerdown: props.onPointerDown,
        focus: props.onFocus,
        blur: props.onBlur,
        click: props.onClick,
      }
      const cleanups: (() => void)[] = []
      for (const [name, handler] of Object.entries(events)) {
        if (!handler) continue
        const listener = (event: Event) => handler(event as never)
        target.addEventListener(name, listener)
        cleanups.push(() => target.removeEventListener(name, listener))
      }
      const description = props['aria-describedby']
      if (description) target.setAttribute('aria-describedby', description)
      return () => {
        cleanups.forEach((cleanup) => cleanup())
        if (target.getAttribute('aria-describedby') === description)
          target.removeAttribute('aria-describedby')
      }
    }, [
      target,
      props.onPointerMove,
      props.onPointerLeave,
      props.onPointerDown,
      props.onFocus,
      props.onBlur,
      props.onClick,
      props['aria-describedby'],
    ])
    return null
  },
)

export function attachDomTooltip(target: HTMLElement) {
  const root = createRoot(document.createElement('div'))
  let destroyed = false
  return {
    update(label: string) {
      if (destroyed) return
      root.render(
        <AppTooltipProvider>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <DomTrigger target={target} />
            </Tooltip.Trigger>
            <TooltipContent label={label} trigger={target} />
          </Tooltip.Root>
        </AppTooltipProvider>,
      )
    },
    destroy() {
      destroyed = true
      // Editor teardown can run during another React root's commit.
      queueMicrotask(() => root.unmount())
    },
  }
}
