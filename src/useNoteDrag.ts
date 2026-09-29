import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'
import type { Note } from './model'
import { moveNote } from './noteOrder'
import type { MoveTarget } from './notebookMove'

type Session = {
  id: string
  pointerId: number
  pointerType: string
  startX: number
  startY: number
  x: number
  y: number
  started: number
  active: boolean
  element: HTMLElement
  ghost?: HTMLElement
  hint?: HTMLElement
  target?: MoveTarget
  offsetX: number
  offsetY: number
  frame: number
  original: Note[]
  preview: Note[]
}
export function useNoteDrag({
  rows,
  notes,
  identity,
  disabled,
  animate,
  commit,
  resolveTarget,
  dropNotebook,
}: {
  rows: RefObject<HTMLDivElement | null>
  notes: Note[]
  identity: string
  disabled: boolean
  animate: () => void
  commit: (notes: Note[]) => void
  resolveTarget?: (noteId: string, notebookId: string) => MoveTarget
  dropNotebook?: (noteId: string, notebookId: string) => void
}) {
  const [preview, setPreview] = useState<Note[] | null>(null)
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [target, setTarget] = useState<MoveTarget | null>(null)
  const session = useRef<Session | null>(null)
  const suppressClick = useRef(false)
  const latest = useRef({ notes, animate, commit, resolveTarget, dropNotebook })
  latest.current = { notes, animate, commit, resolveTarget, dropNotebook }
  useEffect(() => {
    const finish = (accept = false, notebook?: MoveTarget) => {
      const s = session.current
      if (!s) return
      session.current = null
      cancelAnimationFrame(s.frame)
      s.ghost?.remove()
      if (s.element.hasPointerCapture?.(s.pointerId)) s.element.releasePointerCapture(s.pointerId)
      if (s.active) {
        suppressClick.current = true
        latest.current.animate()
        if (notebook?.allowed) latest.current.dropNotebook?.(s.id, notebook.id)
        else if (accept && !notebook && s.preview.some((n, i) => n.id !== s.original[i].id))
          latest.current.commit(s.preview)
      }
      setTarget(null)
      setPreview(null)
      setDraggedId(null)
    }
    const inside = (x: number, y: number) => {
      const rect = rows.current?.getBoundingClientRect()
      return rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
    }
    const hitTarget = (id: string, x: number, y: number) => {
      const row = document.elementFromPoint?.(x, y)?.closest<HTMLElement>('[data-notebook-drop-id]')
      return row?.dataset.notebookDropId && latest.current.resolveTarget
        ? latest.current.resolveTarget(id, row.dataset.notebookDropId)
        : undefined
    }
    const update = () => {
      const s = session.current,
        container = rows.current
      if (!s?.active || !container) return
      if (s.ghost) {
        s.ghost.style.left = `${Math.max(8, Math.min(s.x - s.offsetX, window.innerWidth - s.ghost.offsetWidth - 8))}px`
        s.ghost.style.top = `${Math.max(8, Math.min(s.y - s.offsetY, window.innerHeight - s.ghost.offsetHeight - 8))}px`
      }
      const target = hitTarget(s.id, s.x, s.y)
      if (
        target?.id !== s.target?.id ||
        target?.hint !== s.target?.hint ||
        target?.allowed !== s.target?.allowed
      ) {
        s.target = target
        setTarget(target ?? null)
        if (s.hint) s.hint.textContent = target ? `↪ ${target.hint}` : 'Drag to a notebook to move'
        s.ghost?.classList.toggle('note-drag-unavailable', !!target && !target.allowed)
      }
      const sidebar = document.elementFromPoint?.(s.x, s.y)?.closest<HTMLElement>('.sidebar')
      if (sidebar) {
        const rect = sidebar.getBoundingClientRect()
        sidebar.scrollTop +=
          s.y < rect.top + 36
            ? -Math.min(12, (rect.top + 36 - s.y) / 3)
            : s.y > rect.bottom - 36
              ? Math.min(12, (s.y - rect.bottom + 36) / 3)
              : 0
      }
      if (!target && inside(s.x, s.y)) {
        const rect = container.getBoundingClientRect()
        const edge = 36
        const speed =
          s.y < rect.top + edge
            ? -Math.min(12, (rect.top + edge - s.y) / 3)
            : s.y > rect.bottom - edge
              ? Math.min(12, (s.y - rect.bottom + edge) / 3)
              : 0
        container.scrollTop += speed
        const cards = [...container.querySelectorAll<HTMLElement>('[data-note-id]')]
        // Layout offsets do not change during presentation animations.
        const candidate = cards.find((card) => {
          const top = rect.top + card.offsetTop - container.scrollTop
          return s.y >= top && s.y < top + card.offsetHeight
        })
        const target = candidate?.dataset.noteId
        if (target && target !== s.id) {
          const next = moveNote(s.preview, s.id, target)
          if (next !== s.preview) {
            latest.current.animate()
            s.preview = next
            setPreview(next)
          }
        }
      }
      s.frame = requestAnimationFrame(update)
    }
    const move = (event: PointerEvent) => {
      const s = session.current
      if (!s || event.pointerId !== s.pointerId) return
      s.x = event.clientX
      s.y = event.clientY
      if (!s.active) {
        const distance = Math.hypot(s.x - s.startX, s.y - s.startY)
        if (distance < 4) return
        // Keep waiting if the first movement arrives before the hold threshold.
        // Releasing early still cancels; a later movement can start the drag.
        if (performance.now() - s.started < 10) return
        const card = rows.current?.querySelector<HTMLElement>(
          `[data-note-id="${CSS.escape(s.id)}"]`,
        )
        if (!card) {
          finish()
          return
        }
        s.active = true
        s.element.setPointerCapture?.(s.pointerId)
        s.ghost = card.cloneNode(true) as HTMLElement
        s.ghost.removeAttribute('data-note-id')
        s.ghost.removeAttribute('data-motion-key')
        s.ghost.removeAttribute('id')
        s.ghost.setAttribute('aria-hidden', 'true')
        s.ghost.setAttribute('tabindex', '-1')
        s.ghost.classList.add('note-drag-ghost')
        s.ghost.style.width = `${card.getBoundingClientRect().width}px`
        if (latest.current.resolveTarget) {
          s.hint = document.createElement('span')
          s.hint.className = 'note-drag-hint'
          s.hint.textContent = 'Drag to a notebook to move'
          s.ghost.append(s.hint)
        }
        // Keep the ghost under the themed app, outside scrolling/animated rows.
        ;(rows.current?.closest('.app') ?? rows.current)?.append(s.ghost)
        setDraggedId(s.id)
        setPreview(s.preview)
      }
      cancelAnimationFrame(s.frame)
      update()
      event.preventDefault()
    }
    const up = (event: PointerEvent) => {
      if (session.current?.pointerId === event.pointerId)
        finish(
          !!inside(event.clientX, event.clientY),
          hitTarget(session.current.id, event.clientX, event.clientY),
        )
    }
    // A mouse release must also clean up if native pointer capture was lost.
    const mouseUp = (event: MouseEvent) => {
      const s = session.current
      if (s?.pointerType === 'mouse' && event.button === 0)
        finish(
          !!inside(event.clientX, event.clientY),
          hitTarget(s.id, event.clientX, event.clientY),
        )
    }
    const click = (event: MouseEvent) => {
      if (!suppressClick.current) return
      suppressClick.current = false
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    const down = () => {
      if (!session.current) suppressClick.current = false
    }
    const cancel = () => finish()
    const key = (event: KeyboardEvent) => {
      if (!session.current) suppressClick.current = false
      if (event.key === 'Escape' && session.current) {
        event.preventDefault()
        finish()
      }
    }
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('mouseup', mouseUp)
    window.addEventListener('click', click, true)
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('blur', cancel)
    window.addEventListener('keydown', key)
    return () => {
      finish()
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('mouseup', mouseUp)
      window.removeEventListener('click', click, true)
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('blur', cancel)
      window.removeEventListener('keydown', key)
    }
  }, [identity, disabled, rows])
  return {
    preview,
    draggedId,
    target,
    onPointerDown: (event: ReactPointerEvent<HTMLElement>, id: string) => {
      suppressClick.current = false
      if (
        disabled ||
        event.button !== 0 ||
        event.pointerType === 'touch' ||
        event.metaKey ||
        event.ctrlKey
      )
        return
      const rect = event.currentTarget.getBoundingClientRect()
      session.current = {
        id,
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        startX: event.clientX,
        startY: event.clientY,
        x: event.clientX,
        y: event.clientY,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
        started: performance.now(),
        active: false,
        element: rows.current!,
        frame: 0,
        original: latest.current.notes,
        preview: latest.current.notes,
      }
    },
    consumeClick: () => {
      const suppressed = suppressClick.current
      suppressClick.current = false
      return suppressed
    },
  }
}
