import { PdfToolbarButton, PdfTooltip } from './PdfTooltip'
import { PdfFindController, type PdfSearchResult } from './find'
import { PdfOutline, type PdfOutlineItems, type PdfOutlineDestination } from './PdfOutline'
import { readPdfSelection } from './selection'
import type { PdfSelection } from './citations'
import { useEffect, useLayoutEffect, useId, useRef, useState, type ReactNode } from 'react'
import {
  getDocument,
  GlobalWorkerOptions,
  PDFDataRangeTransport,
  type PDFDocumentLoadingTask,
} from 'pdfjs-dist/legacy/build/pdf.mjs'
import { EventBus, PDFViewer, PDFLinkService } from 'pdfjs-dist/legacy/web/pdf_viewer.mjs'
import { installPdfStreamIterator } from './compatibility'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import 'pdfjs-dist/legacy/web/pdf_viewer.css'
import './pdf.css'
import type { PdfNavigation, PdfReading, PdfSource } from './model'
import { useShortcutActions } from '../useShortcuts'
import { useContentsResize } from '../useContentsResize'
import {
  Search,
  X,
  ChevronRight,
  Plus,
  Minus,
  List,
  ChevronLeft,
  ChevronsLeft,
  ChevronsRight,
  Scan,
  MoveVertical,
  MoveHorizontal,
  Link2,
  Quote,
} from '../icons'

installPdfStreamIterator()
GlobalWorkerOptions.workerSrc = workerUrl
const zoomLevels = [25, 50, 75, 100, 125, 150, 200, 300, 400, 500]
const fitScales = { page: 'page-fit', height: 'page-height', width: 'page-width' }
const clamp = (n: number) => Math.max(0, Math.min(1, n))

export default function PdfReader({
  active = true,
  source,
  reading,
  target,
  onReading,
  registerCapture,
  disabled = false,
  captureDisabled = false,
  onCapture,
  toolbarActions,
  notesAction,
  contentsWidth,
  onContentsWidth,
}: {
  toolbarActions?: ReactNode
  notesAction?: ReactNode
  active?: boolean
  source: PdfSource
  reading: PdfReading
  target?: PdfNavigation
  onReading: (reading: PdfReading) => void
  registerCapture: (capture: () => void) => () => void
  disabled?: boolean
  captureDisabled?: boolean
  onCapture?: (page: number, selection?: PdfSelection) => Promise<boolean>
  contentsWidth?: number
  onContentsWidth: (width: number) => void
}) {
  const latest = useRef({ active, onReading })
  latest.current = { active, onReading }
  const consumedNavigation = useRef<PdfNavigation | undefined>(undefined)
  const resume = useRef<(() => void) | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const pagesRef = useRef<HTMLDivElement>(null)
  const controller = useRef<{
    viewer: PDFViewer
    find: PdfFindController
    link: PDFLinkService
    bus: EventBus
    capture: () => PdfReading
    restore: (state: PdfReading) => void
    navigate: (target: PdfNavigation) => void
  } | null>(null)
  const navigation = useRef(target)
  navigation.current = target
  const outlineId = useId()
  const outlineToggleRef = useRef<HTMLButtonElement>(null)
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [outline, setOutline] = useState<PdfOutlineItems | null>(null)
  const [outlineError, setOutlineError] = useState('')
  const [selection, setSelection] = useState<PdfSelection | null>(null)
  const retainedRange = useRef<Range | null>(null)
  const quotePending = useRef(false)
  const [status, setStatus] = useState('Loading PDF…')
  const [error, setError] = useState('')
  const [navigationError, setNavigationError] = useState('')
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(0)
  const [pageInput, setPageInput] = useState('1')
  const [scale, setScale] = useState(1)
  const [zoomMode, setZoomMode] = useState(reading.zoom)
  const [findOpen, setFindOpen] = useState(false)
  const contentsResize = useContentsResize({
    workspaceRef: bodyRef,
    savedWidth: contentsWidth ?? 240,
    disabled: disabled || !active || !outlineOpen,
    onCommit: onContentsWidth,
    side: 'left',
    reserveWidth: (width) => (findOpen && width > 720 ? 320 : 0),
  })
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState({ current: 0, total: 0 })
  const [results, setResults] = useState<PdfSearchResult[][]>([])
  const [searching, setSearching] = useState(false)
  const [noText, setNoText] = useState(false)
  const findRef = useRef<HTMLInputElement>(null)
  useShortcutActions(
    {
      find: () => {
        setFindOpen(true)
        requestAnimationFrame(() => findRef.current?.focus())
      },
    },
    disabled,
    undefined,
    active,
  )

  useEffect(() => {
    setOutline(null)
    setOutlineError('')
    setSelection(null)
    retainedRange.current = null
    setStatus('Loading PDF…')
    setError('')
    setNavigationError('')
    setNoText(false)
    setPages(0)
    setQuery('')
    setResults([])
    setSearching(false)
    setMatches({ current: 0, total: 0 })
    const container = containerRef.current!
    const host = pagesRef.current!
    const abort = new AbortController()
    let disposed = false
    let ready = false
    let restoring = false
    let reflowRange: Range | null = null
    const rangeIsHidden = (range: Range) =>
      [range.startContainer, range.endContainer].some((node) =>
        (node instanceof Element ? node : node.parentElement)?.closest('.textLayer[hidden]'),
      )
    let task: PDFDocumentLoadingTask | undefined
    let zoom = reading.zoom
    let resizeFrame = 0
    let restoreFrame = 0
    let outlineTimer: ReturnType<typeof setTimeout> | undefined
    let navigationFrame = 0
    let lastWidth = container.clientWidth
    let lastHeight = container.clientHeight
    let lastReading = { ...reading }
    const bus = new EventBus()
    const link = new PDFLinkService({ eventBus: bus })
    // Internal page links work; external document links are not opened by this reader.
    link.externalLinkEnabled = false
    const find = new PdfFindController({ eventBus: bus, linkService: link })
    const viewerOptions = {
      container,
      viewer: host,
      eventBus: bus,
      linkService: link,
      findController: find,
      annotationMode: 1,
      textLayerMode: 1,
      maxCanvasPixels: 8 * 1024 * 1024,
      imageResourcesPath: '/pdfjs/images/',
      abortSignal: abort.signal,
    }
    const viewer = new PDFViewer(viewerOptions)
    link.setViewer(viewer)
    const capture = (): PdfReading => {
      if (
        !latest.current.active ||
        !ready ||
        restoring ||
        !container.isConnected ||
        !container.clientHeight
      )
        return lastReading
      const number = viewer.currentPageNumber
      const div = viewer.getPageView(number - 1)?.div as HTMLElement | undefined
      if (!div?.clientWidth || !div.clientHeight) return lastReading
      lastReading = {
        page: number,
        x: clamp((container.scrollLeft - div.offsetLeft) / div.clientWidth),
        y: clamp((container.scrollTop - div.offsetTop) / div.clientHeight),
        zoom,
      }
      return lastReading
    }
    const publish = () => {
      if (ready && !restoring) latest.current.onReading(capture())
    }
    const restore = (state: PdfReading) => {
      if (disposed || !ready || !latest.current.active || !container.clientHeight) return
      restoring = true
      zoom = state.zoom
      lastReading = state
      viewer.currentPageNumber = Math.max(1, Math.min(viewer.pagesCount, state.page))
      setZoomMode(zoom)
      selectionChanged()
      const selectedRange = retainedRange.current
      viewer.currentScaleValue = typeof zoom === 'string' ? fitScales[zoom] : String(zoom)
      if (selectedRange && rangeIsHidden(selectedRange)) reflowRange = selectedRange
      cancelAnimationFrame(restoreFrame)
      restoreFrame = requestAnimationFrame(() => {
        if (disposed || !latest.current.active || !container.clientHeight) {
          restoring = false
          return
        }
        const div = viewer.getPageView(viewer.currentPageNumber - 1)?.div as HTMLElement | undefined
        if (div) {
          container.scrollTop = div.offsetTop + state.y * div.clientHeight
          container.scrollLeft = state.x === 0 ? 0 : div.offsetLeft + state.x * div.clientWidth
        }
        restoring = false
        viewer.update()
        publish()
      })
    }
    const clearOutlines = () =>
      host.querySelectorAll('.pdf-citation-region').forEach((el) => el.remove())
    const navigate = (target: PdfNavigation) => {
      if (!ready || disposed || !latest.current.active || !container.clientHeight) return
      if (consumedNavigation.current === target) return
      consumedNavigation.current = target
      if (!Number.isInteger(target.page) || target.page < 1 || target.page > viewer.pagesCount) {
        setNavigationError('This citation points to a page that is not in this PDF.')
        return
      }
      for (const region of target.regions ?? []) {
        const view = viewer.getPageView(region.page - 1)
        const bounds = view?.pdfPage?.view
        if (
          !bounds ||
          region.rects.some(
            (r) =>
              r.length !== 4 ||
              r.some((n) => !Number.isFinite(n)) ||
              r[0] < bounds[0] - 2 ||
              r[1] < bounds[1] - 2 ||
              r[2] > bounds[2] + 2 ||
              r[3] > bounds[3] + 2 ||
              r[0] >= r[2] ||
              r[1] >= r[3],
          )
        ) {
          setNavigationError('This citation contains a region outside its PDF page.')
          return
        }
      }
      setNavigationError('')
      clearTimeout(outlineTimer)
      clearOutlines()
      restore({ ...capture(), page: target.page, x: target.x ?? 0, y: target.y ?? 0 })
      cancelAnimationFrame(navigationFrame)
      navigationFrame = requestAnimationFrame(() => {
        if (disposed || !latest.current.active || !container.clientHeight) return
        for (const region of target.regions ?? []) {
          const view = viewer.getPageView(region.page - 1)
          for (const rect of region.rects) {
            const [x1, y1] = view.viewport.convertToViewportPoint(rect[0], rect[1])
            const [x2, y2] = view.viewport.convertToViewportPoint(rect[2], rect[3])
            const outline = document.createElement('div')
            outline.className = 'pdf-citation-region'
            Object.assign(outline.style, {
              left: `${(Math.min(x1, x2) / view.viewport.width) * 100}%`,
              top: `${(Math.min(y1, y2) / view.viewport.height) * 100}%`,
              width: `${(Math.abs(x2 - x1) / view.viewport.width) * 100}%`,
              height: `${(Math.abs(y2 - y1) / view.viewport.height) * 100}%`,
            })
            view.div.append(outline)
          }
        }
        const first = host.querySelector<HTMLElement>('.pdf-citation-region')
        if (first) {
          const rect = first.getBoundingClientRect(),
            viewport = container.getBoundingClientRect()
          container.scrollTop += rect.top - viewport.top - 32
        }
        publish()
        outlineTimer = setTimeout(clearOutlines, 2200)
      })
    }
    controller.current = { viewer, find, link, bus, capture, restore, navigate }
    const selectionChanged = () => {
      if (!latest.current.active || !container.clientHeight) {
        reflowRange = null
        retainedRange.current = null
        setSelection(null)
        return
      }
      const current = window.getSelection()
      const result = readPdfSelection(current, host, viewer)
      if (result) {
        const range = current!.getRangeAt(0)
        const retained = retainedRange.current
        if (
          !retained ||
          retained.startContainer !== range.startContainer ||
          retained.startOffset !== range.startOffset ||
          retained.endContainer !== range.endContainer ||
          retained.endOffset !== range.endOffset
        ) {
          retainedRange.current = range.cloneRange()
        }
        setSelection(result)
      } else {
        // PDF.js temporarily collapses selection when hiding text during a scale update.
        const outside =
          current?.rangeCount &&
          !current.isCollapsed &&
          (!host.contains(current.getRangeAt(0).startContainer) ||
            !host.contains(current.getRangeAt(0).endContainer))
        if (!reflowRange || retainedRange.current !== reflowRange || outside) {
          reflowRange = null
          retainedRange.current = null
        }
        setSelection(null)
      }
    }
    document.addEventListener('selectionchange', selectionChanged)
    const cancelReflowSelection = () => {
      if (!reflowRange) return
      reflowRange = null
      retainedRange.current = null
      setSelection(null)
    }
    document.addEventListener('pointerdown', cancelReflowSelection, true)
    document.addEventListener('keydown', cancelReflowSelection, true)
    // Scale updates usually retain text nodes. Restore the range after PDF.js reflows them.
    const restoreSelection = () => {
      if (!reflowRange) {
        selectionChanged()
        return
      }
      const range = reflowRange
      if (rangeIsHidden(range)) return
      reflowRange = null
      if (
        latest.current.active &&
        container.clientHeight &&
        retainedRange.current === range &&
        range.startContainer.isConnected &&
        range.endContainer.isConnected &&
        !document.activeElement?.closest('.pdf-writing-pane')
      ) {
        const selected = window.getSelection()
        selected?.removeAllRanges()
        selected?.addRange(range)
      }
      selectionChanged()
    }
    bus.on('textlayerrendered', restoreSelection)
    const unregister = registerCapture(publish)
    bus.on('pagechanging', ({ pageNumber }: { pageNumber: number }) => {
      if (!disposed) {
        setPage(pageNumber)
        setPageInput(String(pageNumber))
      }
    })
    bus.on('scalechanging', ({ scale }: { scale: number }) => {
      if (!disposed) setScale(scale)
    })
    bus.on('updateviewarea', publish)
    bus.on(
      'updatefindmatchescount',
      ({ matchesCount }: { matchesCount: { current: number; total: number } }) => {
        if (!disposed) {
          setMatches(matchesCount)
          setResults([...find.results])
        }
      },
    )
    bus.on(
      'updatefindcontrolstate',
      ({
        state,
        matchesCount,
      }: {
        state: number
        matchesCount: { current: number; total: number }
      }) => {
        if (!disposed) {
          setSearching(state === 3)
          if (state !== 3) setResults([...find.results])
          setMatches(matchesCount)
        }
      },
    )
    bus.on('pagerendered', ({ error }: { error?: Error }) => {
      if (!disposed && error) setError(`Could not render this PDF page: ${error.message}`)
    })
    const fail = (reason: unknown) => {
      if (disposed) return
      const message = String(reason)
      setError(
        message.includes('Password')
          ? 'Password-protected PDFs are not supported yet.'
          : `Could not open this PDF. ${message}`,
      )
      setStatus('')
    }
    class SourceRange extends PDFDataRangeTransport {
      stopped = false
      requestDataRange(begin: number, end: number) {
        void source
          .read(begin, end)
          .then((bytes) => {
            if (!this.stopped && !disposed) this.onDataRange(begin, bytes)
          })
          .catch((error) => {
            fail(error)
            void task?.destroy()
            this.stopped = true
          })
      }
      abort() {
        this.stopped = true
      }
    }
    const range = new SourceRange(source.size, null, true)
    task = getDocument({
      range,
      rangeChunkSize: 128 * 1024,
      disableStream: true,
      disableAutoFetch: true,
      cMapUrl: '/pdfjs/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: '/pdfjs/standard_fonts/',
      wasmUrl: '/pdfjs/wasm/',
      iccUrl: '/pdfjs/iccs/',
    })
    task.onPassword = () => {
      fail('Password required')
      void task?.destroy()
    }
    void task.promise
      .then(async (pdf) => {
        if (disposed) return
        setPages(pdf.numPages)
        link.setDocument(pdf)
        void pdf
          .getOutline()
          .then((items) => {
            if (!disposed) setOutline(items ?? [])
          })
          .catch(() => {
            if (!disposed) setOutlineError('Could not load the table of contents.')
          })
        const initialized = new Promise<void>((resolve) => bus.on('pagesinit', resolve))
        viewer.setDocument(pdf)
        await initialized
        await viewer.pagesPromise
        if (disposed) return
        ready = true
        setStatus('')
        resume.current?.()
        // Confirm absence of text across every page before describing a PDF as unsearchable.
        for (let i = 1; i <= pdf.numPages && !disposed; i++) {
          const pdfPage = await pdf.getPage(i)
          if (disposed) return
          const text = await pdfPage.getTextContent()
          if (text.items.some((item) => 'str' in item && item.str.trim())) return
          await new Promise<void>((resolve) => setTimeout(resolve, 0))
        }
        if (!disposed) setNoText(true)
      })
      .catch(fail)
    resume.current = () => {
      const target = navigation.current
      if (target && consumedNavigation.current !== target) navigate(target)
      else restore(lastReading)
    }
    const observer = new ResizeObserver(() => {
      if (
        !latest.current.active ||
        !ready ||
        disposed ||
        !container.clientWidth ||
        !container.clientHeight ||
        (container.clientWidth === lastWidth && container.clientHeight === lastHeight)
      )
        return
      lastWidth = container.clientWidth
      lastHeight = container.clientHeight
      cancelAnimationFrame(resizeFrame)
      // Use the latest state: a toolbar action can change zoom before this frame runs.
      resizeFrame = requestAnimationFrame(() => resume.current?.())
    })
    observer.observe(container)
    return () => {
      if (ready) latest.current.onReading(lastReading)
      resume.current = null
      disposed = true
      ready = false
      unregister()
      document.removeEventListener('selectionchange', selectionChanged)
      document.removeEventListener('pointerdown', cancelReflowSelection, true)
      document.removeEventListener('keydown', cancelReflowSelection, true)
      clearTimeout(outlineTimer)
      cancelAnimationFrame(navigationFrame)
      observer.disconnect()
      cancelAnimationFrame(resizeFrame)
      cancelAnimationFrame(restoreFrame)
      abort.abort()
      bus.dispatch('findbarclose', {})
      viewer.setDocument(null)
      range.abort()
      void task?.destroy()
      controller.current = null
    }
  }, [source.id])

  useLayoutEffect(() => {
    if (active) resume.current?.()
    return () => {
      const ctl = controller.current
      if (ctl) latest.current.onReading(ctl.capture())
    }
  }, [active])

  useEffect(() => {
    if (active && target) controller.current?.navigate(target)
  }, [active, target])

  const search = (value: string, again = false, previous = false) => {
    if (!again) {
      setResults([])
      setMatches({ current: 0, total: 0 })
      if (controller.current) controller.current.find.results = []
    }
    controller.current?.bus.dispatch('find', {
      source: findRef.current,
      type: again ? 'again' : '',
      query: value,
      caseSensitive: false,
      entireWord: false,
      highlightAll: true,
      findPrevious: previous,
      matchDiacritics: false,
    })
  }
  useEffect(() => {
    // Closing PDF.js find hides its highlights. Restore them when the panel reopens.
    if (findOpen && query) search(query)
  }, [findOpen])

  const closeFind = () => {
    setFindOpen(false)
    controller.current?.bus.dispatch('findbarclose', {})
    containerRef.current?.focus()
  }
  const changeZoom = (zoom: PdfReading['zoom']) => {
    const ctl = controller.current
    if (ctl)
      ctl.restore({
        ...ctl.capture(),
        ...(zoom === 'page' ? { x: 0, y: 0 } : zoom === 'height' ? { y: 0 } : {}),
        zoom,
      })
  }
  const navigateOutline = (destination: PdfOutlineDestination) => {
    const ctl = controller.current
    if (!ctl || !destination) return
    setNavigationError('')
    void ctl.link.goToDestination(destination).catch(() => {
      if (controller.current === ctl) setNavigationError('Could not open this section in the PDF.')
    })
  }
  const closeOutline = () => {
    setOutlineOpen(false)
    outlineToggleRef.current?.focus()
  }
  const captureQuote = async (button: HTMLButtonElement) => {
    if (!onCapture || !active || quotePending.current || busy || captureDisabled) return
    const current = window.getSelection()
    const host = pagesRef.current
    const ctl = controller.current
    const selected = host && ctl ? readPdfSelection(current, host, ctl.viewer) : null
    if (!selected) {
      retainedRange.current = null
      setSelection(null)
      return
    }
    // Read the live range, even when selectionchange has not updated React yet.
    const range = current!.getRangeAt(0).cloneRange()
    retainedRange.current = range
    setSelection(selected)
    quotePending.current = true
    if (document.activeElement === button) containerRef.current?.focus({ preventScroll: true })
    try {
      const captured = await onCapture(selected.regions[0].page, selected)
      // A new selection or source opened while capturing belongs to the next action.
      if (!captured || retainedRange.current !== range) return
      retainedRange.current = null
      setSelection(null)
      const current = window.getSelection()
      if (current?.anchorNode && pagesRef.current?.contains(current.anchorNode))
        current.removeAllRanges()
    } finally {
      quotePending.current = false
    }
  }
  const busy = disabled || !!status || !!error
  return (
    <section
      className={`pdf-reader${contentsResize.resizing ? ' is-resizing-contents' : ''}`}
      aria-label="PDF reader"
      onKeyDown={(event) => {
        if (outlineOpen && !contentsResize.resizing && event.key === 'Escape') {
          event.stopPropagation()
          closeOutline()
        }
      }}
    >
      <div className="pdf-toolbar" aria-label="PDF controls">
        <PdfToolbarButton
          ref={outlineToggleRef}
          className="icon-button"
          aria-label="PDF table of contents"
          title="Table of contents"
          aria-expanded={outlineOpen}
          aria-controls={outlineId}
          disabled={busy}
          onClick={() => setOutlineOpen(!outlineOpen)}
        >
          <List />
        </PdfToolbarButton>
        {onCapture && (
          <>
            <PdfToolbarButton
              className="icon-button"
              aria-label="Add page reference"
              title="Add page reference"
              disabled={busy || captureDisabled}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onCapture(page)}
            >
              <Link2 />
            </PdfToolbarButton>
            <PdfToolbarButton
              className="icon-button"
              aria-label="Add quote to note"
              title="Add quote to note"
              disabled={!selection || busy || captureDisabled}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(event) => void captureQuote(event.currentTarget)}
            >
              <Quote />
            </PdfToolbarButton>
          </>
        )}
        {toolbarActions}
        <div className="pdf-toolbar-right">
          <PdfToolbarButton
            className="icon-button pdf-search-toggle"
            aria-label="Find in PDF"
            title="Find in PDF"
            aria-expanded={findOpen}
            disabled={busy}
            onClick={() => {
              setFindOpen(true)
              requestAnimationFrame(() => findRef.current?.focus())
            }}
          >
            <Search />
          </PdfToolbarButton>
          {notesAction}
        </div>
      </div>
      {status && (
        <p className="pdf-message" role="status">
          {status}
        </p>
      )}
      {error && (
        <p className="pdf-message" role="alert">
          {error}
        </p>
      )}
      {navigationError && (
        <p className="pdf-message" role="alert">
          {navigationError} <button onClick={() => setNavigationError('')}>Dismiss</button>
        </p>
      )}
      {noText && (
        <p className="pdf-message" role="status">
          No searchable text. You can read these pages, but text search and copy need embedded text.
          OCR is not available yet.
        </p>
      )}
      <div ref={bodyRef} className="pdf-reader-body" style={contentsResize.cssVariables}>
        {outlineOpen && (
          <aside
            id={outlineId}
            className="pdf-outline"
            aria-label="PDF table of contents"
            onKeyDown={(event) => {
              if (!contentsResize.resizing && event.key === 'Escape') {
                event.stopPropagation()
                closeOutline()
              }
            }}
          >
            <div className="pdf-outline-header">
              <strong>Table of contents</strong>
              <button
                className="icon-button"
                aria-label="Close PDF table of contents"
                onClick={closeOutline}
              >
                <X />
              </button>
            </div>
            <nav aria-label="PDF sections">
              {outlineError ? (
                <p className="pdf-message" role="status">
                  {outlineError}
                </p>
              ) : outline === null ? (
                <p className="pdf-message" role="status">
                  Loading contents…
                </p>
              ) : outline.length ? (
                <PdfOutline
                  key={source.id}
                  items={outline}
                  disabled={busy}
                  onNavigate={navigateOutline}
                />
              ) : (
                <p className="pdf-message">This PDF has no embedded table of contents.</p>
              )}
            </nav>
            <div {...contentsResize.dividerProps} aria-controls={outlineId} />
          </aside>
        )}
        <div className="pdf-scroll-shell">
          <div ref={containerRef} className="pdf-scroll" tabIndex={0} aria-label="PDF pages">
            <div ref={pagesRef} className="pdfViewer" />
          </div>
        </div>
        {findOpen && (
          <aside
            aria-label="PDF search results"
            className="pdf-search-panel"
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation()
                closeFind()
              }
            }}
          >
            <div className="pdf-find">
              <input
                ref={findRef}
                className="text-field"
                aria-label="Find in PDF"
                placeholder="Find in PDF…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  search(e.target.value)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    search(query, true, e.shiftKey)
                  }
                }}
              />
              <span role="status">
                {searching
                  ? 'Searching…'
                  : query
                    ? `${matches.current} of ${matches.total}`
                    : 'Find in PDF'}
              </span>
              <button
                className="icon-button"
                aria-label="Previous PDF match"
                disabled={busy || searching || !matches.total}
                onClick={() => search(query, true, true)}
              >
                <ChevronLeft />
              </button>
              <button
                className="icon-button"
                aria-label="Next PDF match"
                disabled={busy || searching || !matches.total}
                onClick={() => search(query, true)}
              >
                <ChevronRight />
              </button>
              <button className="icon-button" aria-label="Close PDF search" onClick={closeFind}>
                <X />
              </button>
            </div>
            <div className="pdf-search-results">
              {!query ? (
                <p className="pdf-message">Search this document to see all matches.</p>
              ) : !searching && !matches.total ? (
                <p className="pdf-message">No matches found.</p>
              ) : null}
              {query &&
                results.map((items, pageIndex) =>
                  items?.length ? (
                    <details key={pageIndex} open className="pdf-search-group">
                      <summary>
                        Page {pageIndex + 1}
                        <span>{items.length}</span>
                      </summary>
                      {items.map((result) => {
                        const active = controller.current?.find.selected
                        const selected =
                          active?.pageIdx === pageIndex && active.matchIdx === result.matchIndex
                        return (
                          <button
                            key={result.matchIndex}
                            className="pdf-search-result"
                            aria-current={selected ? 'true' : undefined}
                            disabled={busy || searching}
                            onClick={() => {
                              if (
                                controller.current?.find.prepareSelection(
                                  pageIndex,
                                  result.matchIndex,
                                )
                              )
                                search(query, true)
                            }}
                          >
                            {result.before}
                            <mark>{result.text}</mark>
                            {result.after}
                          </button>
                        )
                      })}
                    </details>
                  ) : null,
                )}
            </div>
          </aside>
        )}
      </div>
      <div className="pdf-bottom-toolbar" role="group" aria-label="PDF page and zoom controls">
        <div className="pdf-page-controls">
          {[
            { label: 'First page', number: 1, Icon: ChevronsLeft, blocked: page <= 1 },
            { label: 'Previous page', number: page - 1, Icon: ChevronLeft, blocked: page <= 1 },
          ].map(({ label, number, Icon, blocked }) => (
            <PdfToolbarButton
              tooltipSide="top"
              key={label}
              className="icon-button"
              aria-label={label}
              title={label}
              disabled={busy || blocked}
              onClick={() => {
                if (controller.current) controller.current.viewer.currentPageNumber = number
              }}
            >
              <Icon />
            </PdfToolbarButton>
          ))}
          <form
            onSubmit={(event) => {
              event.preventDefault()
              const value = Number(pageInput)
              if (controller.current && Number.isInteger(value) && value >= 1 && value <= pages)
                controller.current.viewer.currentPageNumber = value
              else setPageInput(String(page))
            }}
          >
            <input
              className="text-field"
              aria-label="PDF page"
              inputMode="numeric"
              value={pageInput}
              disabled={busy}
              onChange={(event) => setPageInput(event.target.value)}
            />
            <span>/ {pages || '…'}</span>
          </form>
          {[
            { label: 'Next page', number: page + 1, Icon: ChevronRight },
            { label: 'Last page', number: pages, Icon: ChevronsRight },
          ].map(({ label, number, Icon }) => (
            <PdfToolbarButton
              tooltipSide="top"
              key={label}
              className="icon-button"
              aria-label={label}
              title={label}
              disabled={busy || page >= pages}
              onClick={() => {
                if (controller.current) controller.current.viewer.currentPageNumber = number
              }}
            >
              <Icon />
            </PdfToolbarButton>
          ))}
        </div>
        <div className="pdf-zoom-controls">
          <PdfToolbarButton
            tooltipSide="top"
            className="icon-button"
            aria-label="Zoom out"
            title="Zoom out"
            disabled={busy || scale <= 0.25}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => changeZoom(Math.max(0.25, Math.min(5, scale / 1.2)))}
          >
            <Minus />
          </PdfToolbarButton>
          <PdfTooltip label="Zoom percentage" side="top" disabled={busy}>
            <select
              className="text-field"
              aria-label="PDF zoom"
              disabled={busy}
              value={String(scale)}
              onChange={(event) => changeZoom(Number(event.target.value))}
            >
              {!zoomLevels.some((percent) => percent / 100 === scale) && (
                <option value={String(scale)}>{Math.round(scale * 100)}%</option>
              )}
              {zoomLevels.map((percent) => (
                <option key={percent} value={String(percent / 100)}>
                  {percent}%
                </option>
              ))}
            </select>
          </PdfTooltip>
          <PdfToolbarButton
            tooltipSide="top"
            className="icon-button"
            aria-label="Zoom in"
            title="Zoom in"
            disabled={busy || scale >= 5}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => changeZoom(Math.min(5, Math.max(0.25, scale * 1.2)))}
          >
            <Plus />
          </PdfToolbarButton>
          <div className="pdf-fit-controls">
            {(
              [
                { label: 'Fit page', mode: 'page', Icon: Scan },
                { label: 'Fit height', mode: 'height', Icon: MoveVertical },
                { label: 'Fit width', mode: 'width', Icon: MoveHorizontal },
                { label: 'Actual size', mode: 1, Icon: null },
              ] as const
            ).map(({ label, mode, Icon }) => (
              <PdfToolbarButton
                tooltipSide="top"
                key={label}
                className="icon-button"
                aria-label={label}
                title={label}
                aria-pressed={zoomMode === mode}
                disabled={busy}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => changeZoom(mode)}
              >
                {Icon ? <Icon /> : <span className="pdf-actual-size">1:1</span>}
              </PdfToolbarButton>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
