import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { defaultRangeExtractor, observeElementRect, useVirtualizer } from '@tanstack/react-virtual'

export type VirtualNoteRowsApi = {
  /** Pointer coordinates become logical list positions, including unmounted rows. */
  hitTest: (clientY: number) => string | undefined
  focus: (id: string) => void
}

type RowControls = {
  onMenuTrackingChange: (open: boolean) => void
  restoreFocus: () => void
}
type Props<T extends { id: string }> = {
  items: readonly T[]
  scrollRef: RefObject<HTMLDivElement | null>
  apiRef?: RefObject<VirtualNoteRowsApi | null>
  retainedIds?: readonly (string | undefined | null)[]
  estimatedSize: number
  rowGap?: number
  geometryKey: string
  initialOffset?: number
  renderRow: (item: T, index: number, controls: RowControls) => ReactNode
}

/** This owns presentation only. The complete filtered sequence still owns order and actions. */
export default function VirtualNoteRows<T extends { id: string }>({
  items,
  scrollRef,
  apiRef,
  retainedIds = [],
  estimatedSize,
  rowGap = 0,
  geometryKey,
  initialOffset = 0,
  renderRow,
}: Props<T>) {
  const listRef = useRef<HTMLDivElement>(null)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [menuId, setMenuId] = useState<string | null>(null)
  const [pendingFocus, setPendingFocus] = useState<{ id: string; last: boolean } | null>(null)
  const [margin, setMargin] = useState(0)
  const indexById = useMemo(() => new Map(items.map((item, index) => [item.id, index])), [items])
  const retained = [...retainedIds, focusedId, menuId, pendingFocus?.id]
    .map((id) => (id ? indexById.get(id) : undefined))
    .filter((index): index is number => index !== undefined)
  const retainedKey = retained.join(',')
  const rangeExtractor = useCallback(
    (range: Parameters<typeof defaultRangeExtractor>[0]) =>
      [...new Set([...defaultRangeExtractor(range), ...retained])].sort((a, b) => a - b),
    // The value matters, not the caller's array identity.
    [retainedKey],
  )
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: useCallback((index: number) => items[index].id, [items]),
    estimateSize: () => estimatedSize,
    overscan: 5,
    scrollMargin: margin,
    initialOffset,
    // Also gives zero-layout test environments a bounded initial window.
    initialRect: { width: window.innerWidth, height: window.innerHeight },
    rangeExtractor,
    observeElementRect: (instance, callback) =>
      observeElementRect(instance, (rect) => {
        // Collapsed desktop panes keep their previous valid viewport and measurements.
        if (rect.width > 0 && rect.height > 0) callback(rect)
      }),
    measureElement: (element, entry, instance) => {
      const height = entry?.borderBoxSize?.[0]?.blockSize ?? element.getBoundingClientRect().height
      return height > 0 ? height : instance.options.estimateSize(Number(element.dataset.index))
    },
    scrollToFn: (offset, { adjustments = 0 }, instance) => {
      if (instance.scrollElement) instance.scrollElement.scrollTop = offset + adjustments
    },
  })
  const previousGeometry = useRef(geometryKey)
  // Reading layout forces a synchronous reflow, so the margin is measured only when content
  // above the list can have moved: new items or geometry, or a resize inside the scroller.
  const measureMargin = useCallback(() => {
    const scroll = scrollRef.current
    const list = listRef.current
    if (!scroll || !list || !scroll.clientWidth) return
    const nextMargin =
      list.getBoundingClientRect().top -
      scroll.getBoundingClientRect().top +
      scroll.scrollTop -
      scroll.clientTop
    setMargin((current) => (current === nextMargin ? current : nextMargin))
  }, [scrollRef])
  useLayoutEffect(() => {
    measureMargin()
    const scroll = scrollRef.current
    if (scroll && previousGeometry.current !== geometryKey) {
      previousGeometry.current = geometryKey
      const offset = scroll.scrollTop
      virtualizer.measure()
      scroll.scrollTop = offset
    }
  }, [measureMargin, geometryKey, items])
  useEffect(() => {
    const scroll = scrollRef.current
    if (!scroll || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measureMargin)
    observer.observe(scroll)
    for (const child of scroll.children) observer.observe(child)
    return () => observer.disconnect()
  }, [measureMargin, scrollRef, items])

  const requestFocus = (id: string, last = false) => {
    const index = indexById.get(id)
    if (index === undefined) return
    setPendingFocus({ id, last })
    virtualizer.scrollToIndex(index, { align: 'auto' })
  }
  // Stable per row, so memoized rows are not re-rendered by new callbacks.
  const latestRequestFocus = useRef(requestFocus)
  latestRequestFocus.current = requestFocus
  const controlsCache = useRef(new Map<string, RowControls>())
  const controlsFor = (id: string) => {
    let controls = controlsCache.current.get(id)
    if (!controls) {
      controls = {
        restoreFocus: () => latestRequestFocus.current(id),
        onMenuTrackingChange: (open) =>
          setMenuId((current) => (open ? id : current === id ? null : current)),
      }
      controlsCache.current.set(id, controls)
    }
    return controls
  }
  const virtualItems = virtualizer.getVirtualItems()
  useLayoutEffect(() => {
    const cache = controlsCache.current
    if (cache.size <= virtualItems.length * 2) return
    const visible = new Set(virtualItems.map((row) => items[row.index]?.id))
    for (const id of cache.keys()) if (!visible.has(id)) cache.delete(id)
  })

  useImperativeHandle(apiRef, () => ({
    focus: requestFocus,
    hitTest: (clientY) => {
      const scroll = scrollRef.current
      if (!scroll) return
      const offset =
        clientY - scroll.getBoundingClientRect().top - scroll.clientTop + scroll.scrollTop
      const row = virtualizer.getVirtualItemForOffset(offset)
      if (row && offset >= row.start && offset < row.end - rowGap) return items[row.index]?.id
    },
  }))
  useLayoutEffect(() => {
    if (!pendingFocus) return
    const slot = listRef.current?.querySelector<HTMLElement>(
      `[data-note-slot-id="${CSS.escape(pendingFocus.id)}"]`,
    )
    const controls = slot?.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]')
    const target = pendingFocus.last ? controls?.[controls.length - 1] : controls?.[0]
    if (target) {
      target.focus({ preventScroll: true })
      setPendingFocus(null)
    }
  })

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return
    const target = event.target as HTMLElement
    const slot = target.closest<HTMLElement>('[data-note-slot-id]')
    if (!slot?.dataset.noteSlotId) return
    const controls = [
      ...slot.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]'),
    ]
    const atBoundary = event.shiftKey ? target === controls[0] : target === controls.at(-1)
    if (!atBoundary) return
    const index = indexById.get(slot.dataset.noteSlotId)
    const next = index === undefined ? undefined : items[index + (event.shiftKey ? -1 : 1)]
    if (!next) return // The real list boundary keeps normal Tab focus movement.
    event.preventDefault()
    requestFocus(next.id, event.shiftKey)
  }

  return (
    <div
      ref={listRef}
      className="virtual-note-rows"
      role="list"
      aria-label="Notes"
      style={{ height: virtualizer.getTotalSize() }}
      onKeyDown={onKeyDown}
      onFocusCapture={(event) => {
        const slot = (event.target as HTMLElement).closest<HTMLElement>('[data-note-slot-id]')
        if (slot?.dataset.noteSlotId) setFocusedId(slot.dataset.noteSlotId)
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusedId(null)
      }}
    >
      {virtualItems.map((row) => {
        const item = items[row.index]
        return (
          <div
            key={item.id}
            ref={virtualizer.measureElement}
            className="virtual-note-slot"
            data-index={row.index}
            data-note-slot-id={item.id}
            role="listitem"
            aria-posinset={row.index + 1}
            aria-setsize={items.length}
            style={{ transform: `translateY(${row.start - margin}px)` }}
          >
            {renderRow(item, row.index, controlsFor(item.id))}
          </div>
        )
      })}
    </div>
  )
}
