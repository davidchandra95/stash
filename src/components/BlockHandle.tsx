import * as Dropdown from '@radix-ui/react-dropdown-menu'
import type { Editor } from '@tiptap/core'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PointerEvent as ReactPointerEvent } from 'react'
import AppTooltip from './AppTooltip'
import MenuActionContent from './MenuActionContent'
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ChevronRight,
  Code2,
  Copy,
  GripVertical,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Highlighter,
  ImagePlus,
  IndentDecrease,
  IndentIncrease,
  List,
  ListChecks,
  ListCollapse,
  ListOrdered,
  Minus,
  Palette,
  PenLine,
  Plus,
  Quote,
  Scissors,
  Table2,
  Trash2,
  Type,
  type IconComponent,
} from '../icons'
import {
  blockAtElement,
  blockKind,
  collapseSelection,
  copyBlock,
  deleteBlock,
  dropTargets,
  highlightBlock,
  insertBlockBelow,
  moveBlock,
  nearestDrop,
  selectBlockText,
  turnBlockInto,
  type Block,
  type BlockKind,
  type DropTarget,
} from '../editor/blocks'
import { runCommand } from '../editor/commands'
import { isMarkdownEditor, markdownCommandAllowed } from '../editor/markdownContext'
import { highlightColors, inkColors } from '../editor/slashOptions'
import { holdDragCursor } from '../dragCursor'

const kindIcons: Record<BlockKind, IconComponent> = {
  paragraph: Type,
  h1: Heading1,
  h2: Heading2,
  h3: Heading3,
  h4: Heading4,
  h5: Heading5,
  h6: Heading6,
  bullet: List,
  number: ListOrdered,
  task: ListChecks,
  quote: Quote,
  code: Code2,
  table: Table2,
  divider: Minus,
  section: ListCollapse,
  drawing: PenLine,
  block: ImagePlus,
}
const turnInto: { id: string; label: string; icon: IconComponent }[] = [
  { id: 'paragraph', label: 'Text', icon: Type },
  { id: 'h1', label: 'Heading 1', icon: Heading1 },
  { id: 'h2', label: 'Heading 2', icon: Heading2 },
  { id: 'h3', label: 'Heading 3', icon: Heading3 },
  { id: 'h4', label: 'Heading 4', icon: Heading4 },
  { id: 'number', label: 'Numbered list', icon: ListOrdered },
  { id: 'bullet', label: 'Bullet list', icon: List },
  { id: 'task', label: 'Checklist', icon: ListChecks },
  { id: 'code', label: 'Code block', icon: Code2 },
  { id: 'quote', label: 'Quote', icon: Quote },
  { id: 'wrap', label: 'Collapsible section', icon: ListCollapse },
]
const insertBelow: { id: string; label: string; icon: IconComponent }[] = [
  { id: 'paragraph', label: 'Text', icon: Type },
  { id: 'h1', label: 'Heading 1', icon: Heading1 },
  { id: 'h2', label: 'Heading 2', icon: Heading2 },
  { id: 'h3', label: 'Heading 3', icon: Heading3 },
  { id: 'bullet', label: 'Bullet list', icon: List },
  { id: 'number', label: 'Numbered list', icon: ListOrdered },
  { id: 'task', label: 'Checklist', icon: ListChecks },
  { id: 'quote', label: 'Quote', icon: Quote },
  { id: 'code', label: 'Code block', icon: Code2 },
  { id: 'table', label: 'Table', icon: Table2 },
  { id: 'divider', label: 'Divider', icon: Minus },
  { id: 'collapsible', label: 'Collapsible section', icon: ListCollapse },
]
const textBlocks = new Set<BlockKind>(['paragraph', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
const dragThreshold = 6

type Placement = { top: number; left: number }
type Indicator = { top: number; left: number; width: number }

/**
 * The handle beside the block under the pointer: its type, a grip to drag it, and a menu that
 * changes, formats, copies, deletes or adds blocks. Desktop only, since it follows the pointer.
 */
export default function BlockHandle({ editor }: { editor: Editor }) {
  const [block, setBlock] = useState<Block | null>(null)
  const [placement, setPlacement] = useState<Placement | null>(null)
  const [open, setOpen] = useState(false)
  const [indicator, setIndicator] = useState<Indicator | null>(null)
  const [dragging, setDragging] = useState(false)
  const handle = useRef<HTMLButtonElement>(null)
  const frozen = useRef(false)
  frozen.current = open || dragging
  const markdown = isMarkdownEditor(editor)
  const allowed = (id: string) => !markdown || markdownCommandAllowed(id)

  // Follow the pointer over the note, including the gutter left of the text.
  useEffect(() => {
    const view = editor.view
    const scroll = view.dom.closest<HTMLElement>('.note-scroll')
    if (!scroll) return
    const track = (event: MouseEvent) => {
      if (frozen.current || !editor.isEditable) return
      if (handle.current?.contains(event.target as Node)) return
      const bounds = view.dom.getBoundingClientRect()
      if (event.clientY < bounds.top || event.clientY > bounds.bottom) return setBlock(null)
      let target = event.target as Element | null
      if (!target || !view.dom.contains(target)) {
        const x = Math.min(Math.max(event.clientX, bounds.left + 4), bounds.right - 4)
        target = document.elementFromPoint(x, event.clientY)
        if (!target || !view.dom.contains(target)) return setBlock(null)
      }
      const next = target === view.dom ? null : blockAtElement(view, target)
      setBlock((old) =>
        old && next && old.pos === next.pos && old.node === next.node ? old : next,
      )
    }
    const leave = () => !frozen.current && setBlock(null)
    // Typing hides the handle until the pointer moves again.
    const typing = () => !frozen.current && setBlock(null)
    scroll.addEventListener('mousemove', track)
    scroll.addEventListener('mouseleave', leave)
    view.dom.addEventListener('keydown', typing)
    return () => {
      scroll.removeEventListener('mousemove', track)
      scroll.removeEventListener('mouseleave', leave)
      view.dom.removeEventListener('keydown', typing)
    }
  }, [editor])

  // Edits move or remove the hovered block.
  useEffect(() => {
    const update = () => {
      setBlock((old) => {
        if (!old) return old
        const node = editor.state.doc.nodeAt(old.pos)
        if (!node || node.type !== old.node.type) return null
        return node === old.node ? old : { ...old, node }
      })
    }
    editor.on('update', update)
    return () => void editor.off('update', update)
  }, [editor])

  // Shade the block the menu or drag acts on, like the selection it stands for.
  const active = (open || dragging) && block ? block.pos : null
  useEffect(() => highlightBlock(editor, active), [editor, active])
  useEffect(() => () => highlightBlock(editor, null), [editor])

  useLayoutEffect(() => {
    if (!block) return setPlacement(null)
    const view = editor.view
    const element = view.nodeDOM(block.pos)
    const body = view.dom.parentElement
    const scroll = view.dom.closest<HTMLElement>('.note-scroll')
    if (!(element instanceof HTMLElement) || !body || !scroll) return setPlacement(null)
    const rect = element.getBoundingClientRect()
    const origin = body.getBoundingClientRect()
    let middle = rect.top + 12
    try {
      // Measure the first line of text inside the block, past any wrapping containers.
      let node = block.node
      let pos = block.pos + 1
      while (!node.isTextblock && node.firstChild && !node.firstChild.isAtom) {
        node = node.firstChild
        pos += 1
      }
      if (node.isTextblock) {
        const line = view.coordsAtPos(pos)
        middle = (line.top + line.bottom) / 2
      }
    } catch {
      /* the block's first line is not measurable; use its top */
    }
    const width = 44
    const left = Math.max(
      rect.left - origin.left - 28 - width,
      scroll.getBoundingClientRect().left - origin.left + 2,
    )
    setPlacement({ top: middle - origin.top - 12, left })
  }, [block, editor])

  const body = editor.view.dom.parentElement
  if (!block || !placement || !body) return null
  const kind = blockKind(block)
  const KindIcon = kindIcons[kind]
  const numbered = kind.startsWith('h') && block.node.attrs.numbered
  const isText = textBlocks.has(kind) || block.listItem

  const act = (run: () => unknown) => {
    try {
      run()
    } catch (error) {
      console.error('Block action failed', error)
    }
  }

  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    // Keep Radix from opening on press; a press without a drag opens the menu on release.
    event.preventDefault()
    const start = { x: event.clientX, y: event.clientY }
    const button = event.currentTarget
    button.setPointerCapture(event.pointerId)
    let targets: DropTarget[] | null = null
    let target: DropTarget | undefined
    let release: (() => void) | undefined
    const body = editor.view.dom.parentElement!
    const move = (moveEvent: PointerEvent) => {
      if (!targets) {
        if (Math.hypot(moveEvent.clientX - start.x, moveEvent.clientY - start.y) < dragThreshold)
          return
        targets = dropTargets(editor.view, block)
        release = holdDragCursor()
        setDragging(true)
      }
      target = nearestDrop(targets, moveEvent.clientY)
      if (!target) return setIndicator(null)
      const origin = body.getBoundingClientRect()
      const right = editor.view.dom.getBoundingClientRect().right
      setIndicator({
        top: target.top - origin.top,
        left: target.left - origin.left,
        width: right - target.left,
      })
    }
    const end = (endEvent: PointerEvent) => {
      button.removeEventListener('pointermove', move)
      button.removeEventListener('pointerup', end)
      button.removeEventListener('pointercancel', end)
      release?.()
      setIndicator(null)
      setDragging(false)
      highlightBlock(editor, null)
      if (endEvent.type === 'pointercancel') return
      if (!targets) return setOpen(true)
      if (target) act(() => moveBlock(editor, block, target!.pos, target!.listItem))
      setBlock(null)
    }
    button.addEventListener('pointermove', move)
    button.addEventListener('pointerup', end)
    button.addEventListener('pointercancel', end)
  }

  const typeButton = ({ id, label, icon: Icon }: (typeof turnInto)[number]) => {
    const current = id === 'number' && /^h\d$/.test(kind) ? numbered : kind === id
    const name = id === 'number' && /^h\d$/.test(kind) ? 'Number heading' : label
    const disabled = !allowed(id === 'number' && /^h\d$/.test(kind) ? 'heading-number' : id)
    return (
      <AppTooltip key={id} instant label={name}>
        <Dropdown.Item
          className="block-type"
          aria-label={name}
          data-current={current || undefined}
          disabled={disabled}
          onSelect={() =>
            act(() => {
              turnBlockInto(editor, block, id)
              collapseSelection(editor)
            })
          }
        >
          <Icon aria-hidden="true" />
        </Dropdown.Item>
      </AppTooltip>
    )
  }
  const formatItem = (id: string, label: string, icon: IconComponent) => (
    <Dropdown.Item
      key={id}
      className="menu-item"
      disabled={!allowed(id)}
      onSelect={() =>
        act(() => {
          selectBlockText(editor, block)
          runCommand(editor, id)
          collapseSelection(editor)
        })
      }
    >
      <MenuActionContent icon={icon} label={label} />
    </Dropdown.Item>
  )
  const colorItem = (id: string, name: string, color: string | null, highlight: boolean) => (
    <Dropdown.Item
      key={id}
      className="menu-item"
      disabled={!allowed(id)}
      onSelect={() =>
        act(() => {
          selectBlockText(editor, block)
          runCommand(editor, id)
          collapseSelection(editor)
        })
      }
    >
      <span
        className="menu-icon block-color"
        data-highlight={highlight || undefined}
        style={color ? { [highlight ? 'background' : 'color']: color } : undefined}
        aria-hidden="true"
      >
        A
      </span>
      <span className="menu-text">{name}</span>
    </Dropdown.Item>
  )

  return createPortal(
    <>
      <Dropdown.Root open={open} onOpenChange={setOpen} modal={false}>
        <Dropdown.Trigger asChild>
          <button
            ref={handle}
            type="button"
            className="block-handle"
            data-open={open || undefined}
            style={{ top: placement.top, left: placement.left }}
            aria-label="Block actions"
            onPointerDown={startDrag}
            onMouseDown={(event) => event.preventDefault()}
          >
            <KindIcon className="block-handle-kind" aria-hidden="true" />
            <GripVertical className="block-handle-grip" aria-hidden="true" />
          </button>
        </Dropdown.Trigger>
        <Dropdown.Portal>
          <Dropdown.Content
            className="menu block-menu"
            side="left"
            align="start"
            sideOffset={6}
            collisionPadding={8}
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              editor.view.focus()
            }}
          >
            <Dropdown.Group className="block-types" aria-label="Turn into">
              {turnInto.map(typeButton)}
            </Dropdown.Group>
            <Dropdown.Separator className="menu-separator" />
            <Dropdown.Sub>
              <Dropdown.SubTrigger className="menu-item" disabled={!isText}>
                <MenuActionContent icon={AlignLeft} label="Align and Indent" />
                <ChevronRight aria-hidden="true" className="ui-icon menu-submenu-icon" />
              </Dropdown.SubTrigger>
              <Dropdown.Portal>
                <Dropdown.SubContent className="menu" sideOffset={4}>
                  {formatItem('align-left', 'Align left', AlignLeft)}
                  {formatItem('align-center', 'Align center', AlignCenter)}
                  {formatItem('align-right', 'Align right', AlignRight)}
                  {formatItem('align-justify', 'Justify', AlignJustify)}
                  {block.listItem && (
                    <>
                      <Dropdown.Separator className="menu-separator" />
                      {formatItem('indent', 'Indent', IndentIncrease)}
                      {formatItem('outdent', 'Outdent', IndentDecrease)}
                    </>
                  )}
                </Dropdown.SubContent>
              </Dropdown.Portal>
            </Dropdown.Sub>
            <Dropdown.Sub>
              <Dropdown.SubTrigger className="menu-item" disabled={!isText || markdown}>
                <MenuActionContent icon={Palette} label="Color Options" />
                <ChevronRight aria-hidden="true" className="ui-icon menu-submenu-icon" />
              </Dropdown.SubTrigger>
              <Dropdown.Portal>
                <Dropdown.SubContent className="menu" sideOffset={4}>
                  <Dropdown.Label className="menu-label">Text color</Dropdown.Label>
                  {inkColors.map(([name, color]) => colorItem(`ink-${name}`, name, color, false))}
                  <Dropdown.Separator className="menu-separator" />
                  <Dropdown.Label className="menu-label">
                    <Highlighter aria-hidden="true" className="ui-icon block-label-icon" />
                    Highlight
                  </Dropdown.Label>
                  {highlightColors.map(([name, color]) =>
                    colorItem(`highlight-${name}`, name, color, true),
                  )}
                </Dropdown.SubContent>
              </Dropdown.Portal>
            </Dropdown.Sub>
            <Dropdown.Separator className="menu-separator" />
            <Dropdown.Item
              className="menu-item"
              onSelect={() => act(() => copyBlock(editor, block, true))}
            >
              <MenuActionContent icon={Scissors} label="Cut" />
            </Dropdown.Item>
            <Dropdown.Item
              className="menu-item"
              onSelect={() => act(() => copyBlock(editor, block))}
            >
              <MenuActionContent icon={Copy} label="Copy" />
            </Dropdown.Item>
            <Dropdown.Item
              className="menu-item is-danger"
              onSelect={() => act(() => deleteBlock(editor, block))}
            >
              <MenuActionContent icon={Trash2} label="Delete" />
            </Dropdown.Item>
            <Dropdown.Separator className="menu-separator" />
            <Dropdown.Sub>
              <Dropdown.SubTrigger className="menu-item">
                <MenuActionContent icon={Plus} label="Insert Below" />
                <ChevronRight aria-hidden="true" className="ui-icon menu-submenu-icon" />
              </Dropdown.SubTrigger>
              <Dropdown.Portal>
                <Dropdown.SubContent className="menu" sideOffset={4}>
                  {insertBelow.map(({ id, label, icon }) => (
                    <Dropdown.Item
                      key={id}
                      className="menu-item"
                      disabled={!allowed(id)}
                      onSelect={() => act(() => insertBlockBelow(editor, block, id))}
                    >
                      <MenuActionContent icon={icon} label={label} />
                    </Dropdown.Item>
                  ))}
                </Dropdown.SubContent>
              </Dropdown.Portal>
            </Dropdown.Sub>
          </Dropdown.Content>
        </Dropdown.Portal>
      </Dropdown.Root>
      {indicator && (
        <div
          className="block-drop-indicator"
          style={{ top: indicator.top, left: indicator.left, width: indicator.width }}
          aria-hidden="true"
        />
      )}
    </>,
    body,
  )
}
