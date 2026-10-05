import AppTooltip from './AppTooltip'
import { useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import * as Dropdown from '@radix-ui/react-dropdown-menu'
import * as Popover from '@radix-ui/react-popover'
import { CommandManager, type Editor, type ChainedCommands } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import { TextSelection, type SelectionBookmark, type Transaction } from '@tiptap/pm/state'
import { captureLinkTarget, mapLinkTarget, type LinkTarget } from '../editor/links'
import { AlignLeft, Check, MoreHorizontal, Quote, X } from '../icons'
import { commands, runCommand } from '../editor/commands'
import { readImage } from '../editor/images'
import { ShortcutContext, useShortcutLabel } from '../useShortcuts'
import { bindingFor } from '../shortcuts'
import {
  cancelNativeContextMenu,
  showNativeContextMenu,
  usesNativeContextMenu,
  type NativeMenuAction,
} from '../nativeContextMenu'
import { fontFamily } from '../fonts'
import type { Appearance } from '../model'
import { defaultAppearance } from '../storage/library'
import {
  fitToolbar,
  toolbarTools,
  toolActive,
  alignmentIcons,
  type ToolbarTool,
  type WritingPicker,
} from './writingToolbar'
import WritingPickerContent from './WritingPickerContent'
import { writingMenuActions } from './writingMenuActions'
const pickerLabels: Record<WritingPicker, string> = {
  color: 'Text color',
  highlight: 'Highlight',
  alignment: 'Alignment',
  link: 'Link address',
  table: 'Table',
  sections: 'Sections',
  image: 'Image',
  quote: 'Quote background',
  error: 'Writing error',
}

export default function DesktopWritingToolbar({
  editor,
  readOnly,
  appearance = defaultAppearance,
}: {
  editor: Editor
  readOnly: boolean
  appearance?: Appearance
}) {
  useEditorState({ editor, selector: ({ editor: current }) => current.state })
  const shortcutLabel = useShortcutLabel()
  const shortcuts = useContext(ShortcutContext)
  const native = usesNativeContextMenu()
  const [nativeOpen, setNativeOpen] = useState<WritingPicker | 'overflow' | null>(null)
  const nativeSession = useRef<string | null>(null)
  const [hidden, setHidden] = useState(new Set<string>())
  const [overflow, setOverflow] = useState(false)
  const [picker, setPicker] = useState<WritingPicker | null>(null)
  const [url, setUrl] = useState('')
  const [linkTitle, setLinkTitle] = useState('')
  const linkTarget = useRef<LinkTarget | null>(null)
  const [rows, setRows] = useState(3)
  const [cols, setCols] = useState(3)
  const [error, setError] = useState('')
  const toolbar = useRef<HTMLDivElement>(null)
  const measure = useRef<HTMLDivElement>(null)
  const overflowButton = useRef<HTMLButtonElement>(null)
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const launcher = useRef<HTMLElement | null>(null)
  const content = useRef<HTMLDivElement>(null)
  const bookmark = useRef<SelectionBookmark | null>(null)
  const slash = useRef<{ from: number; to: number } | null>(null)
  const generation = useRef(0)
  const pendingPicker = useRef<WritingPicker | null>(null)
  const blocked = useRef(readOnly)
  blocked.current = readOnly
  const focusAfterClose = useRef<'trigger' | 'editor' | 'outside'>('trigger')
  const quote = editor.isActive('blockquote')
  const needsOverflow = hidden.size > 0 || quote
  const virtualAnchor = useRef({ getBoundingClientRect: () => new DOMRect() })
  virtualAnchor.current = {
    getBoundingClientRect: () =>
      (launcher.current?.isConnected
        ? launcher.current
        : toolbar.current
      )?.getBoundingClientRect() ?? new DOMRect(),
  }
  const floatingProps = {
    'data-theme': appearance.dark ? 'dark' : 'light',
    'data-palette': appearance.theme,
    style: {
      '--ui-font': fontFamily(appearance.uiFont),
      fontFamily: fontFamily(appearance.uiFont),
    } as CSSProperties,
  }
  const canRun = (id: string) => {
    const command = commands.find((command) => command.id === id)
    if (!command) return false
    if (!['bullet', 'number', 'task'].includes(id)) return command.run(editor.can().chain()).run()
    // Custom list commands inspect earlier changes in their chain.
    // A real isolated transaction models those changes without dispatching them.
    return command.run(new CommandManager({ editor }).createChain(editor.state.tr)).run()
  }
  const disabled = (tool: ToolbarTool) => {
    if (readOnly || !editor.isEditable) return true
    if (tool.picker) return false
    return !canRun(tool.id)
  }
  const fallbackLauncher = (next: WritingPicker | null) => {
    const id = next === 'color' ? 'format' : next
    return (
      (id ? buttons.current.get(id) : null) ??
      overflowButton.current ??
      toolbar.current?.querySelector<HTMLButtonElement>('button') ??
      null
    )
  }
  const capture = (element: HTMLElement | null) => {
    ++generation.current
    bookmark.current = editor.state.selection.getBookmark()
    slash.current = null
    launcher.current = element instanceof HTMLButtonElement ? element : fallbackLauncher(null)
    focusAfterClose.current = 'trigger'
    linkTarget.current = captureLinkTarget(editor)
    setUrl(linkTarget.current.href)
    setLinkTitle(linkTarget.current.title)
    setError('')
  }
  const close = (focus: 'trigger' | 'editor' | 'outside' = 'trigger') => {
    focusAfterClose.current = focus
    ++generation.current
    setPicker(null)
    setOverflow(false)
    bookmark.current = null
    linkTarget.current = null
    slash.current = null
    pendingPicker.current = null
    cancelNative()
  }
  const cancelNative = () => {
    const id = nativeSession.current
    nativeSession.current = null
    setNativeOpen(null)
    if (id)
      void cancelNativeContextMenu(id).catch((error) =>
        console.error('Could not dismiss writing menu', error),
      )
  }
  const restoreFocus = (event: Event) => {
    event.preventDefault()
    if (focusAfterClose.current === 'trigger' && !blocked.current) {
      const target = launcher.current?.isConnected ? launcher.current : fallbackLauncher(picker)
      target?.focus({ preventScroll: true })
    }
  }
  const openPicker = (next: WritingPicker, element: HTMLElement | null, saved = false) => {
    if (blocked.current || !editor.isEditable) return
    if (nativeSession.current) cancelNative()
    if (!saved) capture(element)
    else launcher.current = element ?? launcher.current
    setOverflow(false)
    if (native) {
      const actions = writingMenuActions(next, editor, apply, canRun)
      if (actions) {
        setPicker(null)
        launchNative(next, actions)
        return
      }
    }
    setPicker(next)
  }
  const launchNative = (key: WritingPicker | 'overflow', actions: NativeMenuAction[]) => {
    const trigger = launcher.current ?? fallbackLauncher(key === 'overflow' ? null : key)
    if (!trigger || nativeSession.current || blocked.current || !editor.isEditable) return
    const id = crypto.randomUUID()
    const version = generation.current
    let selected = false
    nativeSession.current = id
    setNativeOpen(key)
    trigger.focus({ preventScroll: true })
    const rect = trigger.getBoundingClientRect()
    const release = () => {
      if (nativeSession.current === id) {
        nativeSession.current = null
        setNativeOpen(null)
      }
    }
    void showNativeContextMenu(
      actions.map((action) => ({
        ...action,
        run: (element) => {
          if (
            version !== generation.current ||
            blocked.current ||
            editor.isDestroyed ||
            !editor.isEditable
          )
            return
          selected = true
          release()
          action.run(element)
        },
      })),
      // The toolbar stays connected if resizing moves the launcher into overflow.
      toolbar.current ?? trigger,
      { x: rect.left, y: rect.top - 8 },
      (shortcut) => bindingFor(shortcut, shortcuts),
      { above: true, trackingId: id },
    )
      .catch((error) => {
        if (version !== generation.current || blocked.current) return
        selected = true
        setError(`Could not open writing menu: ${String(error)}`)
        setPicker('error')
      })
      .finally(() => {
        release()
        if (!selected && version === generation.current && !blocked.current) {
          close('trigger')
          const target = trigger.isConnected
            ? trigger
            : fallbackLauncher(key === 'overflow' ? null : key)
          // Escape leaves focus on the launcher. An outside click may already
          // have focused the document or another field; preserve that focus.
          if (document.activeElement === trigger || document.activeElement === document.body)
            target?.focus({ preventScroll: true })
        }
      })
  }
  const openNativeOverflow = () => {
    if (blocked.current || nativeSession.current) return
    capture(overflowButton.current)
    setPicker(null)
    launchNative('overflow', [
      ...toolbarTools
        .filter((tool) => hidden.has(tool.id))
        .map((tool) => ({
          label: tool.label,
          icon:
            tool.id === 'alignment'
              ? (alignmentIcons[
                  (editor.getAttributes('paragraph').textAlign as keyof typeof alignmentIcons) ??
                    editor.getAttributes('heading').textAlign
                ] ?? AlignLeft)
              : tool.icon,
          shortcutId: tool.id,
          disabled: disabled(tool),
          checked: toolActive(editor, tool),
          run: () =>
            tool.picker ? openPicker(tool.picker, overflowButton.current, true) : execute(tool.id),
        })),
      ...(quote
        ? [
            {
              label: 'Quote background',
              icon: Quote,
              run: () => openPicker('quote', overflowButton.current, true),
            },
          ]
        : []),
    ])
  }
  const pickerFromOverflow = (next: WritingPicker) => {
    // Open only after Radix has released the overflow menu's focus scope.
    pendingPicker.current = next
    focusAfterClose.current = 'outside'
    setOverflow(false)
  }
  const apply = (action: (chain: ChainedCommands) => ChainedCommands) => {
    if (blocked.current || editor.isDestroyed || !editor.isEditable) return false
    const tr = editor.state.tr
    if (bookmark.current) tr.setSelection(bookmark.current.resolve(tr.doc))
    let chain = new CommandManager({ editor }).createChain(tr)
    if (slash.current) chain = chain.deleteRange(slash.current)
    if (!action(chain).run()) {
      setError('That action is not available at this selection.')
      if (native && !picker) setPicker('error')
      return false
    }
    editor.view.dispatch(tr)
    close('editor')
    editor.commands.focus()
    return true
  }
  const execute = (id: string) => {
    const command = commands.find((command) => command.id === id)
    if (command) apply(command.run)
  }

  const insertImageFiles = async (files: File[]) => {
    if (!files.length || blocked.current) return
    const version = generation.current
    try {
      const images = await Promise.all(
        files.map(async (file) => ({
          type: 'image',
          attrs: { src: await readImage(file), alt: file.name, width: 360 },
        })),
      )
      if (version === generation.current) apply((chain) => chain.insertContent(images))
    } catch {
      if (version === generation.current) setError('The image could not be read. Try another file.')
    }
  }

  useLayoutEffect(() => {
    const rack = measure.current
    const dock = toolbar.current?.parentElement
    if (!rack || !dock) return
    const update = () => {
      const available = dock.getBoundingClientRect().width
      if (!available) return
      const widths = Object.fromEntries(
        [...rack.querySelectorAll<HTMLElement>('[data-tool]')].map((node) => [
          node.dataset.tool!,
          node.getBoundingClientRect().width,
        ]),
      )
      const styles = getComputedStyle(rack)
      const padding = (parseFloat(styles.paddingLeft) || 0) + (parseFloat(styles.paddingRight) || 0)
      const coreWidth =
        padding +
        ['style', 'bold', 'italic', 'underline', 'undo', 'redo', 'overflow'].reduce(
          (sum, id) => sum + (widths[id] ?? 0),
          0,
        )
      // Keep the core controls reachable at the editor's minimum pane width.
      const gap = Math.min(
        parseFloat(styles.columnGap) || 0,
        Math.max(0, (available - coreWidth) / 6),
      )
      toolbar.current!.style.columnGap = `${gap}px`
      const next = fitToolbar(available, widths, gap, padding, quote)
      setHidden((previous) => ([...previous].join() === [...next].join() ? previous : next))
    }
    update()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(dock)
    observer?.observe(rack)
    rack.querySelectorAll<HTMLElement>('[data-tool]').forEach((node) => observer?.observe(node))
    window.addEventListener('resize', update)
    document.fonts?.addEventListener('loadingdone', update)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', update)
      document.fonts?.removeEventListener('loadingdone', update)
    }
  }, [quote])

  useEffect(() => {
    const dom = editor.view.dom
    const show = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string; range?: { from: number; to: number } }>)
        .detail
      const next = ({ link: 'link', image: 'image', format: 'color' } as const)[
        detail.id as 'link' | 'image' | 'format'
      ]
      if (!next || blocked.current) return
      openPicker(next, buttons.current.get(detail.id) ?? overflowButton.current ?? toolbar.current)
      slash.current = detail.range ?? null
      if (next === 'link' && detail.range) {
        linkTarget.current = captureLinkTarget(
          editor,
          TextSelection.create(editor.state.doc, detail.range.to),
        )
        setUrl(linkTarget.current.href)
        setLinkTitle(linkTarget.current.title)
      }
    }
    const fail = (event: Event) => {
      if (blocked.current) return
      openPicker('error', overflowButton.current ?? toolbar.current)
      setError(String((event as CustomEvent).detail))
    }
    const map = ({ transaction }: { transaction: Transaction }) => {
      bookmark.current = bookmark.current?.map(transaction.mapping) ?? null
      linkTarget.current = mapLinkTarget(linkTarget.current, transaction)
      if (slash.current)
        slash.current = {
          from: transaction.mapping.map(slash.current.from),
          to: transaction.mapping.map(slash.current.to),
        }
    }
    const dismiss = () => close('outside')
    dom.addEventListener('writing-panel', show)
    dom.addEventListener('writing-error', fail)
    dom.addEventListener('writing-dismiss', dismiss)
    dom.addEventListener('writing-deactivate', dismiss)
    editor.on('transaction', map)
    return () => {
      ++generation.current
      cancelNative()
      dom.removeEventListener('writing-panel', show)
      dom.removeEventListener('writing-error', fail)
      dom.removeEventListener('writing-dismiss', dismiss)
      dom.removeEventListener('writing-deactivate', dismiss)
      editor.off('transaction', map)
    }
  }, [editor])
  useLayoutEffect(() => {
    close('outside')
  }, [readOnly, editor])
  useLayoutEffect(() => {
    if (picker && launcher.current && !launcher.current.isConnected)
      launcher.current = fallbackLauncher(picker)
  }, [hidden, picker])

  const renderIcon = (tool: ToolbarTool) => {
    const align =
      editor.getAttributes('paragraph').textAlign ??
      editor.getAttributes('heading').textAlign ??
      'left'
    const Icon =
      tool.id === 'alignment'
        ? (alignmentIcons[align as keyof typeof alignmentIcons] ?? AlignLeft)
        : tool.icon
    return tool.id === 'format' ? (
      <span
        className="writing-color-icon"
        style={
          {
            '--writing-ink': editor.getAttributes('textStyle').color || 'currentColor',
          } as CSSProperties
        }
      >
        <Icon />
      </span>
    ) : (
      <Icon />
    )
  }
  const styleSelect = (measurement = false) => (
    <select
      data-tool="style"
      aria-label={measurement ? undefined : 'Text style'}
      disabled={readOnly}
      value={editor.isActive('heading') ? `h${editor.getAttributes('heading').level}` : 'p'}
      onChange={(event) =>
        runCommand(editor, event.target.value === 'p' ? 'paragraph' : event.target.value)
      }
    >
      <option value="p">Text</option>
      {[1, 2, 3, 4, 5, 6].map((level) => (
        <option key={level} value={`h${level}`}>
          Heading {level}
        </option>
      ))}
    </select>
  )
  const toolButton = (tool: ToolbarTool, measurement = false) => (
    <AppTooltip
      instant
      label={measurement ? undefined : tool.label}
      shortcut={shortcutLabel(tool.id)}
      disabled={disabled(tool)}
      key={tool.id}
    >
      <button
        data-tool={tool.id}
        type="button"
        className={`tool ${toolActive(editor, tool) ? 'active' : ''}`}
        aria-label={measurement ? undefined : tool.label}
        aria-pressed={tool.picker ? undefined : toolActive(editor, tool)}
        aria-haspopup={
          tool.picker
            ? native && ['color', 'highlight', 'alignment', 'sections'].includes(tool.picker)
              ? 'menu'
              : 'dialog'
            : undefined
        }
        aria-expanded={
          tool.picker ? picker === tool.picker || nativeOpen === tool.picker : undefined
        }
        data-state={
          tool.picker && (picker === tool.picker || nativeOpen === tool.picker) ? 'open' : undefined
        }
        disabled={disabled(tool)}
        ref={
          measurement
            ? undefined
            : (node) => {
                if (node) buttons.current.set(tool.id, node)
                else buttons.current.delete(tool.id)
              }
        }
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          if (tool.picker) openPicker(tool.picker, event.currentTarget)
          else {
            close('editor')
            runCommand(editor, tool.id)
          }
        }}
        onKeyDown={(event) => {
          if (tool.picker && event.key === 'ArrowDown') {
            event.preventDefault()
            openPicker(tool.picker, event.currentTarget)
          }
        }}
      >
        {renderIcon(tool)}
      </button>
    </AppTooltip>
  )

  return (
    <>
      <div
        ref={toolbar}
        className="toolbar desktop-writing-toolbar"
        role="toolbar"
        aria-label="Text formatting"
      >
        {styleSelect()}
        {toolbarTools.filter((tool) => !hidden.has(tool.id)).map((tool) => toolButton(tool))}
        {needsOverflow && native ? (
          <button
            ref={overflowButton}
            className="tool"
            type="button"
            aria-label="More writing tools"
            aria-haspopup="menu"
            aria-expanded={nativeOpen === 'overflow'}
            data-state={nativeOpen === 'overflow' ? 'open' : 'closed'}
            disabled={readOnly}
            onMouseDown={(event) => event.preventDefault()}
            onClick={openNativeOverflow}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                openNativeOverflow()
              }
            }}
          >
            <MoreHorizontal />
          </button>
        ) : (
          needsOverflow && (
            <Dropdown.Root
              open={overflow && !readOnly}
              modal={false}
              onOpenChange={(open) => {
                if (open) {
                  capture(overflowButton.current)
                  setPicker(null)
                  setOverflow(true)
                } else setOverflow(false)
              }}
            >
              <Dropdown.Trigger
                ref={overflowButton}
                className="tool"
                type="button"
                aria-label="More writing tools"
                disabled={readOnly}
              >
                <MoreHorizontal />
              </Dropdown.Trigger>
              <Dropdown.Portal>
                <Dropdown.Content
                  className="dropdown writing-overflow"
                  {...floatingProps}
                  side="top"
                  align="end"
                  sideOffset={8}
                  collisionPadding={8}
                  aria-label="More writing tools"
                  onEscapeKeyDown={() => {
                    focusAfterClose.current = 'trigger'
                  }}
                  onPointerDownOutside={() => {
                    focusAfterClose.current = 'outside'
                  }}
                  onCloseAutoFocus={(event) => {
                    event.preventDefault()
                    if (pendingPicker.current) {
                      const next = pendingPicker.current
                      pendingPicker.current = null
                      openPicker(next, overflowButton.current, true)
                      return
                    }
                    if (!picker && focusAfterClose.current === 'trigger')
                      overflowButton.current?.focus({ preventScroll: true })
                  }}
                >
                  {toolbarTools
                    .filter((tool) => hidden.has(tool.id))
                    .map((tool) => (
                      <Dropdown.Item
                        key={tool.id}
                        disabled={disabled(tool)}
                        data-active={toolActive(editor, tool) || undefined}
                        onSelect={() => {
                          if (tool.picker) {
                            pickerFromOverflow(tool.picker)
                          } else execute(tool.id)
                        }}
                      >
                        {renderIcon(tool)}
                        <span>{tool.label}</span>
                        {toolActive(editor, tool) && <Check className="writing-menu-check" />}
                        {shortcutLabel(tool.id) !== 'Unassigned' && (
                          <kbd>{shortcutLabel(tool.id)}</kbd>
                        )}
                      </Dropdown.Item>
                    ))}
                  {quote && (
                    <Dropdown.Item
                      disabled={readOnly}
                      onSelect={() => {
                        pickerFromOverflow('quote')
                      }}
                    >
                      <Quote />
                      <span>Quote background</span>
                    </Dropdown.Item>
                  )}
                </Dropdown.Content>
              </Dropdown.Portal>
            </Dropdown.Root>
          )
        )}
      </div>
      <div
        ref={measure}
        className="toolbar desktop-writing-toolbar writing-toolbar-measure"
        aria-hidden="true"
        inert
      >
        {styleSelect(true)}
        {toolbarTools.map((tool) => toolButton(tool, true))}
        <button className="tool" data-tool="overflow">
          <MoreHorizontal />
        </button>
      </div>
      <Popover.Root
        open={!!picker && !readOnly}
        modal={false}
        onOpenChange={(open) => {
          if (!open) close(focusAfterClose.current)
        }}
      >
        <Popover.Anchor virtualRef={virtualAnchor} />
        <Popover.Portal>
          <Popover.Content
            ref={content}
            className="writing-picker"
            {...floatingProps}
            side="top"
            align="end"
            sideOffset={8}
            collisionPadding={8}
            aria-label={picker ? pickerLabels[picker] : undefined}
            onOpenAutoFocus={(event) => {
              event.preventDefault()
              content.current
                ?.querySelector<HTMLElement>(
                  'input:not(:disabled), section button:not(:disabled), button:not([aria-label="Close writing menu"]):not(:disabled)',
                )
                ?.focus({ preventScroll: true })
            }}
            onEscapeKeyDown={() => {
              focusAfterClose.current = 'trigger'
            }}
            onPointerDownOutside={() => {
              focusAfterClose.current = 'outside'
            }}
            onInteractOutside={() => {
              focusAfterClose.current = 'outside'
            }}
            onCloseAutoFocus={restoreFocus}
            onKeyDown={(event) => {
              if (
                !(event.target instanceof HTMLButtonElement) ||
                !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)
              )
                return
              const items = [
                ...content.current!.querySelectorAll<HTMLButtonElement>(
                  'button:not(:disabled):not([aria-label="Close writing menu"])',
                ),
              ]
              const index = items.indexOf(event.target)
              if (index < 0) return
              event.preventDefault()
              items[
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? items.length - 1
                    : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
              ]?.focus()
            }}
          >
            <div className="writing-picker-heading">
              <strong>{picker ? pickerLabels[picker] : ''}</strong>
              <button
                type="button"
                className="tool"
                aria-label="Close writing menu"
                onClick={() => close()}
              >
                <X />
              </button>
            </div>
            {error && (
              <p className="editor-error" role="alert">
                {error}
              </p>
            )}
            <fieldset disabled={readOnly} className="writing-picker-controls">
              <WritingPickerContent
                editor={editor}
                readOnly={readOnly}
                picker={picker}
                url={url}
                setUrl={setUrl}
                rows={rows}
                setRows={setRows}
                cols={cols}
                setCols={setCols}
                setError={setError}
                apply={apply}
                canRun={canRun}
                execute={execute}
                linkTarget={linkTarget.current}
                linkTitle={linkTitle}
                setLinkTitle={setLinkTitle}
                onImages={insertImageFiles}
              />
            </fieldset>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </>
  )
}
