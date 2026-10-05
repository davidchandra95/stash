import AppTooltip from '../components/AppTooltip'
import { useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { ChevronDown, ChevronRight } from '../icons'

export type PdfOutlineItems = NonNullable<Awaited<ReturnType<PDFDocumentProxy['getOutline']>>>
export type PdfOutlineDestination = PdfOutlineItems[number]['dest']

export function PdfOutline({
  items,
  disabled,
  onNavigate,
}: {
  items: PdfOutlineItems
  disabled: boolean
  onNavigate: (destination: PdfOutlineDestination) => void
}) {
  return (
    <ul className="pdf-outline-list">
      {items.map((item, index) => (
        <OutlineItem key={index} item={item} disabled={disabled} onNavigate={onNavigate} />
      ))}
    </ul>
  )
}

function OutlineItem({
  item,
  disabled,
  onNavigate,
}: {
  item: PdfOutlineItems[number]
  disabled: boolean
  onNavigate: (destination: PdfOutlineDestination) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const title = item.title.trim() || 'Untitled section'
  return (
    <li>
      <div className="pdf-outline-row">
        {item.items.length ? (
          <button
            className="pdf-outline-disclosure"
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${title}`}
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <ChevronDown /> : <ChevronRight />}
          </button>
        ) : (
          <span className="pdf-outline-spacer" />
        )}
        <AppTooltip label={title} disabled={disabled || !item.dest}>
          <button
            className="pdf-outline-title"
            disabled={disabled || !item.dest}
            onClick={() => onNavigate(item.dest)}
          >
            {title}
          </button>
        </AppTooltip>
      </div>
      {item.items.length > 0 && expanded && (
        <PdfOutline items={item.items} disabled={disabled} onNavigate={onNavigate} />
      )}
    </li>
  )
}
