import AppTooltip from '../components/AppTooltip'
import { forwardRef, type ComponentPropsWithoutRef } from 'react'

export const PdfTooltip = AppTooltip

export const PdfToolbarButton = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<'button'> & {
    title: string
    shortcut?: string
    tooltipSide?: 'top' | 'bottom'
  }
>(function PdfToolbarButton({ title, shortcut, tooltipSide, onMouseDown, ...props }, ref) {
  return (
    <AppTooltip
      instant
      label={title}
      shortcut={shortcut}
      side={tooltipSide}
      disabled={props.disabled}
    >
      <button
        {...props}
        ref={ref}
        onMouseDown={(event) => {
          onMouseDown?.(event)
          // Toolbar activation must not collapse the selected PDF text.
          event.preventDefault()
        }}
      />
    </AppTooltip>
  )
})
