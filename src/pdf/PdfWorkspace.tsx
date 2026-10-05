import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { PdfNotesPreferences } from '../workspace'
import { DocumentShortcutContext, focusDocument } from '../useShortcuts'

export default function PdfWorkspace({
  pdf,
  pdfActive = !!pdf,
  open,
  preferences,
  onPreferences,
  onFocus,
  children,
}: {
  pdfActive?: boolean
  pdf?: ReactNode
  open: boolean
  preferences: PdfNotesPreferences
  onPreferences: (patch: Partial<PdfNotesPreferences>) => void
  onFocus: (pane: 'pdf' | 'note') => void
  children: ReactNode
}) {
  const root = useRef<HTMLDivElement>(null)
  const drag = useRef<{ pointer: number; x: number; ratio: number } | null>(null)
  const [width, setWidth] = useState(0)
  const narrow = width < 728
  const paired = pdfActive && open
  const available = Math.max(1, width - 8)
  const minimum = Math.max(0.1, 360 / available)
  const maximum = Math.min(0.9, 1 - 360 / available)
  const ratio = Math.max(minimum, Math.min(maximum, preferences.ratio))
  useLayoutEffect(() => {
    if (!pdf) return
    const el = root.current!
    const observer = new ResizeObserver(() => setWidth(el.clientWidth))
    observer.observe(el)
    setWidth(el.clientWidth)
    return () => observer.disconnect()
  }, [!!pdf])
  const focus = (pane: 'pdf' | 'note') => {
    focusDocument(pane)
    onFocus(pane)
  }
  return (
    <div
      ref={root}
      className={`pdf-workspace ${paired ? 'paired' : ''} ${narrow ? 'compact' : ''}`}
    >
      {paired && narrow && (
        <div className="pdf-pane-switch" role="group" aria-label="Reading and writing">
          <button
            aria-pressed={preferences.pane === 'pdf'}
            onClick={() => {
              onPreferences({ pane: 'pdf' })
              focus('pdf')
            }}
          >
            PDF
          </button>
          <button
            aria-pressed={preferences.pane === 'note'}
            onClick={() => {
              onPreferences({ pane: 'note' })
              focus('note')
            }}
          >
            Notes
          </button>
        </div>
      )}
      <div className="pdf-workspace-panes">
        {pdf && (
          <DocumentShortcutContext.Provider value="pdf">
            <section
              className="pdf-reading-pane"
              aria-label="PDF document"
              hidden={!pdfActive || (paired && narrow && preferences.pane === 'note')}
              style={paired && !narrow ? { flex: `0 0 ${ratio * available}px` } : undefined}
              onFocusCapture={() => focus('pdf')}
              onPointerDownCapture={() => focus('pdf')}
            >
              {pdf}
            </section>
          </DocumentShortcutContext.Provider>
        )}
        {paired && !narrow && (
          <div
            className="pdf-split-divider"
            role="separator"
            tabIndex={0}
            aria-label="Resize PDF and notes"
            aria-orientation="vertical"
            aria-valuemin={Math.round(minimum * 100)}
            aria-valuemax={Math.round(maximum * 100)}
            aria-valuenow={Math.round(ratio * 100)}
            onKeyDown={(event) => {
              const next =
                event.key === 'ArrowLeft'
                  ? ratio - 0.03
                  : event.key === 'ArrowRight'
                    ? ratio + 0.03
                    : event.key === 'Home'
                      ? minimum
                      : event.key === 'End'
                        ? maximum
                        : null
              if (next === null) return
              event.preventDefault()
              onPreferences({ ratio: Math.max(minimum, Math.min(maximum, next)) })
            }}
            onPointerDown={(event) => {
              if (event.button !== 0) return
              drag.current = { pointer: event.pointerId, x: event.clientX, ratio }
              event.currentTarget.setPointerCapture(event.pointerId)
              event.currentTarget.focus({ preventScroll: true })
              event.preventDefault()
            }}
            onPointerMove={(event) => {
              const start = drag.current
              if (
                !start ||
                !(event.buttons & 1) ||
                start.pointer !== event.pointerId ||
                !event.currentTarget.hasPointerCapture(event.pointerId)
              )
                return
              const next = start.ratio + (event.clientX - start.x) / available
              onPreferences({ ratio: Math.max(minimum, Math.min(maximum, next)) })
            }}
            onPointerUp={(event) => {
              drag.current = null
              event.currentTarget.releasePointerCapture(event.pointerId)
            }}
            onLostPointerCapture={() => {
              drag.current = null
            }}
          />
        )}
        {(!pdfActive || open) && (
          <DocumentShortcutContext.Provider value="note">
            <section
              className="pdf-writing-pane"
              aria-label={pdfActive ? 'Companion note' : 'Note'}
              hidden={paired && narrow && preferences.pane === 'pdf'}
              onFocusCapture={() => focus('note')}
              onPointerDownCapture={() => focus('note')}
            >
              {children}
            </section>
          </DocumentShortcutContext.Provider>
        )}
      </div>
    </div>
  )
}
