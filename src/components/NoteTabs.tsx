import AppTooltip from './AppTooltip'
import { useEffect, useRef } from 'react'
import { FileText, X } from '../icons'
import type { Note } from '../model'
import { useShortcutLabel } from '../useShortcuts'

export default function NoteTabs({
  notes,
  documents = [],
  tabs,
  activeTabId,
  disabled,
  onSelectTab,
  onCloseTab,
  onKeepOpenTab,
}: {
  notes: Note[]
  documents?: { id: string; name: string }[]
  tabs: { id: string; noteId?: string; documentId?: string; preview?: boolean }[]
  activeTabId: string | null
  disabled: boolean
  onSelectTab: (id: string) => void
  onCloseTab: (id: string) => void
  onKeepOpenTab: (id: string) => void
}) {
  const tabsRef = useRef<HTMLDivElement>(null)
  const shortcutLabel = useShortcutLabel()
  const hasTabs = tabs.length > 0
  useEffect(() => {
    tabsRef.current
      ?.querySelector('.note-tab.active')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeTabId, tabs.length])
  useEffect(() => {
    const strip = tabsRef.current
    if (!strip) return
    const wheel = (event: WheelEvent) => {
      const mode = event.deltaMode
      // Leave horizontal trackpad input and zoom gestures to the browser.
      if (
        event.defaultPrevented ||
        !event.cancelable ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        !event.deltaY ||
        Math.abs(event.deltaX) >= Math.abs(event.deltaY) ||
        strip.scrollWidth <= strip.clientWidth
      )
        return
      const unit =
        mode === 1
          ? parseFloat(getComputedStyle(strip).lineHeight) || 16
          : mode === 2
            ? strip.clientWidth
            : 1
      event.preventDefault()
      strip.scrollLeft = Math.max(
        0,
        Math.min(strip.scrollWidth - strip.clientWidth, strip.scrollLeft + event.deltaY * unit),
      )
    }
    strip.addEventListener('wheel', wheel, { passive: false })
    const observer =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(() =>
            strip
              .querySelector('.note-tab.active')
              ?.scrollIntoView({ block: 'nearest', inline: 'nearest' }),
          )
    observer?.observe(strip)
    return () => {
      strip.removeEventListener('wheel', wheel)
      observer?.disconnect()
    }
  }, [hasTabs])
  if (!hasTabs) return null
  return (
    <div
      className="note-tabs"
      ref={tabsRef}
      role="tablist"
      aria-label="Open documents"
      onKeyDown={(event) => {
        if (disabled) return
        const index = tabs.findIndex((t) => t.id === activeTabId)
        let target: number | undefined
        if (event.key === 'ArrowRight') target = (index + 1) % tabs.length
        if (event.key === 'ArrowLeft') target = (index - 1 + tabs.length) % tabs.length
        if (event.key === 'Home') target = 0
        if (event.key === 'End') target = tabs.length - 1
        if (target !== undefined && tabs[target]) {
          event.preventDefault()
          onSelectTab?.(tabs[target].id)
          event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')[target]?.focus()
        }
      }}
    >
      {tabs.map((tab) => {
        const title = tab.documentId
          ? documents.find((d) => d.id === tab.documentId)?.name || 'Unavailable PDF'
          : notes.find((n) => n.id === tab.noteId)?.title || 'Untitled note'
        return (
          <div
            className={`note-tab ${activeTabId === tab.id ? 'active' : ''} ${tab.preview ? 'preview' : ''}`}
            key={tab.id}
          >
            <AppTooltip
              label={tab.preview ? `${title} - Preview (double-click to keep open)` : title}
              disabled={disabled}
            >
              <button
                role="tab"
                aria-selected={activeTabId === tab.id}
                tabIndex={activeTabId === tab.id ? 0 : -1}
                disabled={disabled}
                onClick={() => onSelectTab?.(tab.id)}
                onDoubleClick={() => onKeepOpenTab?.(tab.id)}
                onKeyDown={(event) => {
                  if (disabled) return
                  if (tab.preview && activeTabId === tab.id && event.key === 'Enter') {
                    event.preventDefault()
                    onKeepOpenTab?.(tab.id)
                  }
                }}
              >
                <FileText size={14} />
                <span>{title}</span>
              </button>
            </AppTooltip>
            <AppTooltip
              instant
              label={`Close ${title}`}
              shortcut={shortcutLabel('close-tab')}
              disabled={disabled}
            >
              <button
                className="tab-close"
                disabled={disabled}
                aria-label={`Close ${title}`}
                onClick={() => {
                  onCloseTab?.(tab.id)
                  requestAnimationFrame(() =>
                    (
                      document.querySelector<HTMLElement>('.note-tabs [aria-selected="true"]') ??
                      document.querySelector<HTMLElement>('[aria-label="New note"]')
                    )?.focus(),
                  )
                }}
              >
                <X size={13} />
              </button>
            </AppTooltip>
          </div>
        )
      })}
    </div>
  )
}
