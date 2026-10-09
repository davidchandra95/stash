import { useTabDrag } from './useTabDrag'
import AppTooltip from './AppTooltip'
import { useEffect, useRef, useState } from 'react'
import NoteContextMenu from './NoteContextMenu'
import { constrainTabIndex } from '../workspace'
import type { CSSProperties } from 'react'
import { FileText, Pin, PinOff, X } from '../icons'
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
  onReorderTab,
  onPinTab,
  dark = false,
  palette = 'default',
  menuStyle = {},
}: {
  notes: Pick<Note, 'id' | 'title'>[]
  documents?: { id: string; name: string }[]
  tabs: { id: string; noteId?: string; documentId?: string; preview?: boolean; pinned?: boolean }[]
  activeTabId: string | null
  disabled: boolean
  dark?: boolean
  palette?: string
  menuStyle?: CSSProperties
  onPinTab: (id: string, pinned: boolean) => void
  onSelectTab: (id: string) => void
  onCloseTab: (id: string) => void
  onKeepOpenTab: (id: string) => void
  onReorderTab: (id: string, targetIndex: number) => void
}) {
  const tabsRef = useRef<HTMLDivElement>(null)
  const [announcement, setAnnouncement] = useState('')
  const reorder = (id: string, index: number) => {
    index = constrainTabIndex(tabs, id, index)
    if (tabs.findIndex((tab) => tab.id === id) === index) return
    onReorderTab(id, index)
    setAnnouncement(`Tab moved to position ${index + 1} of ${tabs.length}`)
  }
  const drag = useTabDrag(tabsRef, JSON.stringify(tabs), disabled, reorder, (id, index) =>
    constrainTabIndex(tabs, id, index),
  )
  const shortcutLabel = useShortcutLabel()
  const close = (id: string) => {
    onCloseTab(id)
    requestAnimationFrame(() =>
      (
        document.querySelector<HTMLElement>('.note-tabs [aria-selected="true"]') ??
        document.querySelector<HTMLElement>('[aria-label="New note"]')
      )?.focus(),
    )
  }
  const hasTabs = tabs.length > 0
  useEffect(() => {
    if (drag.session.current?.active) return
    tabsRef.current
      ?.querySelector('.note-tab.active')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeTabId, JSON.stringify(tabs.map((tab) => [tab.id, tab.pinned]))])
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
        : new ResizeObserver(() => {
            if (drag.session.current?.active) return
            strip
              .querySelector('.note-tab.active')
              ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
          })
    observer?.observe(strip)
    return () => {
      strip.removeEventListener('wheel', wheel)
      observer?.disconnect()
    }
  }, [hasTabs])
  if (!hasTabs) return null
  return (
    <>
      <div
        className={`note-tabs ${drag.visual ? 'is-reordering' : ''}`}
        ref={tabsRef}
        role="tablist"
        aria-label="Open documents"
        onClickCapture={(event) => {
          if (drag.suppressClick.current) {
            event.preventDefault()
            event.stopPropagation()
          }
        }}
        onDoubleClickCapture={(event) => {
          if (drag.suppressClick.current) {
            event.preventDefault()
            event.stopPropagation()
          }
        }}
        onPointerDownCapture={() => {
          drag.suppressClick.current = false
        }}
        onKeyDown={(event) => {
          if (!(event.target as HTMLElement).closest('.note-tab')) return
          drag.suppressClick.current = false
          if (disabled || drag.session.current?.active) return
          if (
            event.ctrlKey &&
            event.shiftKey &&
            !event.altKey &&
            !event.metaKey &&
            (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
          ) {
            const button = (event.target as HTMLElement).closest<HTMLElement>('[role="tab"]')
            if (!button) return
            event.preventDefault()
            const id = button.closest<HTMLElement>('[data-tab-id]')!.dataset.tabId!
            const index = tabs.findIndex((tab) => tab.id === id)
            const target = index + (event.key === 'ArrowLeft' ? -1 : 1)
            if (target >= 0 && target < tabs.length) {
              reorder(id, target)
              requestAnimationFrame(() =>
                button.scrollIntoView({ block: 'nearest', inline: 'nearest' }),
              )
            }
            return
          }
          if (event.ctrlKey || event.shiftKey || event.metaKey || event.altKey) return
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
            <NoteContextMenu
              key={tab.id}
              dark={dark}
              palette={palette}
              style={menuStyle}
              disabled={disabled || !!drag.visual}
              actions={[
                {
                  label: tab.pinned ? 'Unpin tab' : 'Pin tab',
                  icon: tab.pinned ? PinOff : Pin,
                  run: () => onPinTab(tab.id, !tab.pinned),
                },
                { label: 'Close', icon: X, run: () => close(tab.id) },
              ]}
            >
              <div
                className={`note-tab ${tab.pinned ? 'pinned' : ''} ${activeTabId === tab.id ? 'active' : ''} ${tab.preview ? 'preview' : ''} ${drag.visual?.id === tab.id ? 'is-dragged' : ''}`}
                data-tab-id={tab.id}
                style={
                  drag.visual
                    ? { transform: `translateX(${drag.visual.offsets[tab.id] ?? 0}px)` }
                    : undefined
                }
                key={tab.id}
              >
                <AppTooltip
                  shortcut="Ctrl+Shift+Left/Right to move"
                  label={tab.preview ? `${title} - Preview (double-click to keep open)` : title}
                  disabled={disabled}
                  suppressed={!!drag.visual}
                >
                  <button
                    role="tab"
                    aria-description={`${tab.pinned ? 'Pinned. ' : ''}Drag to rearrange within this group, or press Control+Shift+Left or Right.`}
                    onPointerDown={(event) => drag.start(event, tab.id)}
                    aria-selected={activeTabId === tab.id}
                    tabIndex={activeTabId === tab.id ? 0 : -1}
                    disabled={disabled}
                    onClick={() => onSelectTab?.(tab.id)}
                    onDoubleClick={() => onKeepOpenTab?.(tab.id)}
                    onKeyDown={(event) => {
                      if (disabled || drag.session.current?.active) return
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
                  suppressed={!!drag.visual}
                  label={`${tab.pinned ? 'Unpin' : 'Close'} ${title}`}
                  shortcut={tab.pinned ? undefined : shortcutLabel('close-tab')}
                  disabled={disabled}
                >
                  <button
                    className="tab-close"
                    disabled={disabled}
                    aria-label={`${tab.pinned ? 'Unpin' : 'Close'} ${title}`}
                    onClick={() => {
                      if (tab.pinned) onPinTab(tab.id, false)
                      else close(tab.id)
                    }}
                  >
                    {tab.pinned ? <Pin size={13} /> : <X size={13} />}
                  </button>
                </AppTooltip>
              </div>
            </NoteContextMenu>
          )
        })}
      </div>
      <span
        className="tab-reorder-announcement"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {announcement}
      </span>
    </>
  )
}
