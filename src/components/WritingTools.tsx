import AppTooltip from './AppTooltip'
import {
  Link,
  ImagePlus,
  Palette,
  AlignLeft,
  PanelsTopLeft,
  IndentIncrease,
  IndentDecrease,
  Code,
  Subscript,
  Superscript,
  SquareCheck,
} from '../icons'
import { platform } from '../platform'
import { MotionPresence, motion } from '../motion'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { TextSelection, type SelectionBookmark, type Transaction } from '@tiptap/pm/state'
import { commands, runCommand } from '../editor/commands'
import {
  applyLink,
  captureLinkTarget,
  mapLinkTarget,
  removeLink,
  type LinkTarget,
} from '../editor/links'
import { readImage } from '../editor/images'
const colors = ['#a83432', '#ad5b13', '#7b6513', '#387342', '#216f9c', '#7655ae']
const backgrounds = ['#dc726033', '#e8a84140', '#e3d84a45', '#64ae7040', '#5b9cd440', '#a885cc40']
export default function WritingTools({
  editor,
  readOnly = false,
}: {
  editor: Editor
  readOnly?: boolean
}) {
  const blocked = useRef(readOnly)
  blocked.current = readOnly
  const linkTarget = useRef<LinkTarget | null>(null)
  const [linkTitle, setLinkTitle] = useState('')
  const [open, setOpen] = useState(false),
    [url, setUrl] = useState(''),
    [error, setError] = useState(''),
    [rows, setRows] = useState(3),
    [cols, setCols] = useState(3)
  const [section, setSection] = useState<string | null>(null)
  useEffect(() => {
    if (!open || !section) return
    const frame = requestAnimationFrame(() => {
      const label = [...document.querySelectorAll('.rich-menu section > label')].find(
        (node) => node.textContent === section,
      )
      label?.closest('section')?.scrollIntoView({ block: 'nearest' })
    })
    return () => cancelAnimationFrame(frame)
  }, [open, section])
  const saved = useRef<SelectionBookmark | null>(null),
    slash = useRef<{ from: number; to: number } | null>(null)
  const capture = () => {
    if (blocked.current || !editor.isEditable) return
    saved.current = editor.state.selection.getBookmark()
    slash.current = null
    linkTarget.current = captureLinkTarget(editor)
    setUrl(linkTarget.current.href)
    setLinkTitle(linkTarget.current.title)
    setError('')
    setOpen(true)
  }
  useEffect(() => {
    const dom = editor.view.dom
    const request = (event: Event) => {
      const detail = (event as CustomEvent).detail
      if (blocked.current || !editor.isEditable) return
      capture()
      slash.current = detail.range ?? null
      if (detail.id === 'link' && detail.range) {
        linkTarget.current = captureLinkTarget(
          editor,
          TextSelection.create(editor.state.doc, detail.range.to),
        )
        setUrl(linkTarget.current.href)
        setLinkTitle(linkTarget.current.title)
      }
    }
    const fail = (event: Event) => {
      if (blocked.current || !editor.isEditable) return
      setError((event as CustomEvent).detail)
      setOpen(true)
    }
    const map = ({ transaction }: { transaction: Transaction }) => {
      saved.current = saved.current?.map(transaction.mapping) ?? null
      linkTarget.current = mapLinkTarget(linkTarget.current, transaction)
      if (slash.current)
        slash.current = {
          from: transaction.mapping.map(slash.current.from),
          to: transaction.mapping.map(slash.current.to),
        }
    }
    const dismiss = () => {
      setOpen(false)
      saved.current = null
      slash.current = null
      linkTarget.current = null
    }
    dom.addEventListener('writing-deactivate', dismiss)
    dom.addEventListener('writing-dismiss', dismiss)
    dom.addEventListener('writing-panel', request)
    dom.addEventListener('writing-error', fail)
    editor.on('transaction', map)
    return () => {
      dom.removeEventListener('writing-deactivate', dismiss)
      dom.removeEventListener('writing-dismiss', dismiss)
      dom.removeEventListener('writing-panel', request)
      dom.removeEventListener('writing-error', fail)
      editor.off('transaction', map)
    }
  }, [editor])
  useLayoutEffect(() => {
    setOpen(false)
    saved.current = null
    slash.current = null
    linkTarget.current = null
  }, [editor, readOnly])
  const chain = () => {
    let c = editor.chain().command(({ tr }) => {
      if (saved.current) tr.setSelection(saved.current.resolve(tr.doc))
      return true
    })
    if (slash.current) c = c.deleteRange(slash.current)
    return c.focus()
  }
  const close = () => {
    setOpen(false)
    slash.current = null
    saved.current = null
    linkTarget.current = null
    if (!blocked.current && !editor.isDestroyed) editor.commands.focus()
  }
  const apply = (action: (c: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>) => {
    if (blocked.current || !editor.isEditable || editor.isDestroyed || !saved.current) return
    if (action(chain()).run()) close()
  }
  const executeSaved = (id: string) => {
    if (blocked.current || !editor.isEditable) return
    editor.commands.command(({ tr }) => {
      if (saved.current) tr.setSelection(saved.current.resolve(tr.doc))
      return true
    })
    if (runCommand(editor, id, slash.current ?? undefined)) close()
    else setError('That action is not available at this selection.')
  }
  const palette = (label: string, values: string[], action: (color: string | null) => void) => (
    <section>
      <label>{label}</label>
      <div className="swatches">
        {values.map((color) => (
          <AppTooltip label={`${label} ${color}`} key={color}>
            <button
              aria-label={`${label} ${color}`}
              style={{ background: color }}
              onClick={() => action(color)}
            />
          </AppTooltip>
        ))}
        <AppTooltip instant label={`Reset ${label}`}>
          <button aria-label={`Reset ${label}`} onClick={() => action(null)}>
            ×
          </button>
        </AppTooltip>
      </div>
    </section>
  )
  return (
    <>
      {platform.mobile ? (
        <>
          {[
            { id: 'indent', label: 'Indent', Icon: IndentIncrease },
            { id: 'outdent', label: 'Outdent', Icon: IndentDecrease },
            { id: 'inline-code', label: 'Inline code', Icon: Code },
            { id: 'subscript', label: 'Subscript', Icon: Subscript },
            { id: 'superscript', label: 'Superscript', Icon: Superscript },
            { id: 'checkbox', label: 'Insert checkbox', Icon: SquareCheck },
          ].map(({ id, label, Icon }) => (
            <AppTooltip instant label={label} disabled={readOnly} key={id}>
              <button
                className="tool"
                aria-label={label}

                onMouseDown={(e) => e.preventDefault()}
                disabled={readOnly}
                onClick={() => !blocked.current && editor.isEditable && runCommand(editor, id)}
              >
                <Icon />
              </button>
            </AppTooltip>
          ))}
          {[
            { label: 'Insert link', section: 'Link address', Icon: Link },
            { label: 'Insert image', section: 'Insert image', Icon: ImagePlus },
            { label: 'Text and highlight colors', section: 'Text color', Icon: Palette },
            { label: 'Text alignment', section: 'Alignment', Icon: AlignLeft },
            { label: 'Sections', section: 'Sections', Icon: PanelsTopLeft },
          ].map(({ label, section, Icon }) => (
            <AppTooltip instant label={label} key={label}>
              <button
                className="tool"
                aria-label={label}

                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setSection(section)
                  capture()
                }}
              >
                <Icon />
              </button>
            </AppTooltip>
          ))}
        </>
      ) : (
        <AppTooltip instant label="More formatting and insert">
          <button
            className="tool"
            aria-label="More formatting and insert"
            aria-expanded={open}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => (open ? close() : capture())}
          >
            •••
          </button>
        </AppTooltip>
      )}
      <MotionPresence open={open} duration={motion.menu}>
        <div
          className="rich-menu"
          role="dialog"
          aria-label="Writing tools"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              close()
            }
          }}
          onMouseDown={(e) => {
            if ((e.target as HTMLElement).closest('button')) e.preventDefault()
          }}
        >
          <button style={{ float: 'right' }} aria-label="Close writing tools" onClick={close}>
            ×
          </button>
          <strong>Writing tools</strong>
          {error && (
            <p role="alert" className="editor-error">
              {error}
            </p>
          )}
          <section>
            {[
              ...(platform.mobile
                ? ['indent', 'outdent', 'quote', 'code', 'divider', 'strike', 'highlight']
                : []),
              'inline-code',
              'subscript',
              'superscript',
              'checkbox',
            ].map((id) => (
              <button
                key={id}
                onClick={() => {
                  executeSaved(id)
                }}
              >
                {commands.find((c) => c.id === id)?.label}
              </button>
            ))}
          </section>
          {palette('Text color', colors, (color) =>
            apply((c) => (color ? c.setColor(color) : c.unsetColor())),
          )}
          {palette('Highlight', backgrounds, (color) =>
            apply((c) => (color ? c.setHighlight({ color }) : c.unsetHighlight())),
          )}
          <section>
            <label>Alignment</label>
            {['left', 'center', 'right', 'justify'].map((align) => (
              <button key={align} onClick={() => apply((c) => c.setTextAlign(align))}>
                {align}
              </button>
            ))}
          </section>
          <section>
            <label htmlFor="writing-link-title">Link title</label>
            <input
              id="writing-link-title"
              className="text-field"
              value={linkTitle}
              disabled={readOnly || !linkTarget.current?.titleEditable}
              onChange={(event) => setLinkTitle(event.target.value)}
              placeholder="Use the address when empty"
            />
            {linkTarget.current && !linkTarget.current.titleEditable && (
              <p className="writing-field-hint">Select text within one block to edit its title.</p>
            )}
            <label htmlFor="writing-link">Link address</label>
            <input
              id="writing-link"
              className="text-field"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com"
            />
            <button
              onClick={() => {
                if (!/^(https?:\/\/|mailto:)/i.test(url.trim())) {
                  setError('Use an https://, http://, or mailto: address.')
                  return
                }
                if (linkTarget.current)
                  apply((c) => applyLink(c, linkTarget.current!, linkTitle, url.trim()))
              }}
            >
              Apply link
            </button>
            <button
              disabled={readOnly || !linkTarget.current?.href}
              onClick={() => linkTarget.current && apply((c) => removeLink(c, linkTarget.current!))}
            >
              Remove link
            </button>
          </section>
          <section>
            <label>Table size</label>
            <input
              aria-label="Table rows"
              className="text-field"
              type="number"
              min={1}
              max={20}
              value={rows}
              onChange={(e) => setRows(Number(e.target.value))}
            />{' '}
            ×{' '}
            <input
              aria-label="Table columns"
              className="text-field"
              type="number"
              min={1}
              max={12}
              value={cols}
              onChange={(e) => setCols(Number(e.target.value))}
            />
            <button
              onClick={() =>
                apply((c) =>
                  c.insertTable({
                    rows: Math.max(1, Math.min(rows, 20)),
                    cols: Math.max(1, Math.min(cols, 12)),
                    withHeaderRow: true,
                  }),
                )
              }
            >
              Insert table
            </button>
          </section>
          {editor.isActive('table') && (
            <>
              {palette('Cell background', backgrounds, (color) =>
                apply((c) => c.setCellAttribute('backgroundColor', color)),
              )}
              <section>
                {commands
                  .filter((command) => command.context === 'table')
                  .map((command) => (
                    <button key={command.id} onClick={() => executeSaved(command.id)}>
                      {command.label}
                    </button>
                  ))}
              </section>
            </>
          )}
          {editor.isActive('blockquote') &&
            palette('Quote background', backgrounds, (color) =>
              apply((c) => c.updateAttributes('blockquote', { backgroundColor: color })),
            )}
          <section>
            <label>Sections</label>
            {['collapsible', 'wrap', 'unwrap', 'toggle-section', 'expand-all', 'collapse-all'].map(
              (id) => (
                <button
                  key={id}
                  onClick={() => {
                    executeSaved(id)
                  }}
                >
                  {commands.find((c) => c.id === id)?.label}
                </button>
              ),
            )}
          </section>
          {editor.isActive('collapsibleHeader') &&
            palette('Header background', backgrounds, (color) =>
              apply((c) => c.updateAttributes('collapsibleHeader', { backgroundColor: color })),
            )}
          {editor.isActive('collapsibleBody') &&
            palette('Body background', backgrounds, (color) =>
              apply((c) => c.updateAttributes('collapsibleBody', { backgroundColor: color })),
            )}
          <section>
            <label>Insert image</label>
            <input
              aria-label="Choose image file"
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp,image/avif,image/bmp"
              multiple
              onChange={async (e) => {
                try {
                  const files = Array.from(e.target.files ?? [])
                  const images = await Promise.all(
                    files.map(async (file) => ({
                      type: 'image',
                      attrs: { src: await readImage(file), alt: file.name, width: 360 },
                    })),
                  )
                  if (images.length) apply((c) => c.insertContent(images))
                } catch {
                  setError('The image could not be read. Try another file.')
                }
              }}
            />
          </section>
          {editor.isActive('image') && (
            <section>
              <label>Image width</label>
              {[120, 240, 360, 600].map((width) => (
                <button
                  key={width}
                  onClick={() => apply((c) => c.updateAttributes('image', { width, height: null }))}
                >
                  {width}px
                </button>
              ))}
              <button onClick={() => apply((c) => c.deleteSelection())}>Remove image</button>
            </section>
          )}
        </div>
      </MotionPresence>
    </>
  )
}
