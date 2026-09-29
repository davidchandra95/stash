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
import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import type { SelectionBookmark, Transaction } from '@tiptap/pm/state'
import { commands, runCommand } from '../editor/commands'
import { readImage } from '../editor/images'
const colors = ['#a83432', '#ad5b13', '#7b6513', '#387342', '#216f9c', '#7655ae']
const backgrounds = ['#dc726033', '#e8a84140', '#e3d84a45', '#64ae7040', '#5b9cd440', '#a885cc40']
export default function WritingTools({ editor }: { editor: Editor }) {
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
    saved.current = editor.state.selection.getBookmark()
    slash.current = null
    setUrl(editor.getAttributes('link').href || '')
    setError('')
    setOpen(true)
  }
  useEffect(() => {
    const dom = editor.view.dom
    const request = (event: Event) => {
      const detail = (event as CustomEvent).detail
      capture()
      slash.current = detail.range ?? null
    }
    const fail = (event: Event) => {
      setError((event as CustomEvent).detail)
      setOpen(true)
    }
    const map = ({ transaction }: { transaction: Transaction }) => {
      saved.current = saved.current?.map(transaction.mapping) ?? null
      if (slash.current)
        slash.current = {
          from: transaction.mapping.map(slash.current.from),
          to: transaction.mapping.map(slash.current.to),
        }
    }
    const dismiss = () => setOpen(false)
    dom.addEventListener('writing-dismiss', dismiss)
    dom.addEventListener('writing-panel', request)
    dom.addEventListener('writing-error', fail)
    editor.on('transaction', map)
    return () => {
      dom.removeEventListener('writing-dismiss', dismiss)
      dom.removeEventListener('writing-panel', request)
      dom.removeEventListener('writing-error', fail)
      editor.off('transaction', map)
    }
  }, [editor])
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
    editor.commands.focus()
  }
  const apply = (action: (c: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>) => {
    action(chain()).run()
    close()
  }
  const executeSaved = (id: string) => {
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
          <button
            key={color}
            title={`${label} ${color}`}
            aria-label={`${label} ${color}`}
            style={{ background: color }}
            onClick={() => action(color)}
          />
        ))}
        <button title={`Reset ${label}`} aria-label={`Reset ${label}`} onClick={() => action(null)}>
          ×
        </button>
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
            <button
              key={id}
              className="tool"
              aria-label={label}
              title={label}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => runCommand(editor, id)}
            >
              <Icon />
            </button>
          ))}
          {[
            { label: 'Insert link', section: 'Link address', Icon: Link },
            { label: 'Insert image', section: 'Insert image', Icon: ImagePlus },
            { label: 'Text and highlight colors', section: 'Text color', Icon: Palette },
            { label: 'Text alignment', section: 'Alignment', Icon: AlignLeft },
            { label: 'Sections', section: 'Sections', Icon: PanelsTopLeft },
          ].map(({ label, section, Icon }) => (
            <button
              key={label}
              className="tool"
              aria-label={label}
              title={label}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setSection(section)
                capture()
              }}
            >
              <Icon />
            </button>
          ))}
        </>
      ) : (
        <button
          className="tool"
          title="More formatting and insert"
          aria-label="More formatting and insert"
          aria-expanded={open}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => (open ? close() : capture())}
        >
          •••
        </button>
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
                const empty = !!slash.current || saved.current?.resolve(editor.state.doc).empty
                apply((c) =>
                  empty && !editor.isActive('link')
                    ? c.insertContent({
                        type: 'text',
                        text: url.trim(),
                        marks: [{ type: 'link', attrs: { href: url.trim() } }],
                      })
                    : c.extendMarkRange('link').setLink({ href: url.trim() }),
                )
              }}
            >
              Apply link
            </button>
            <button onClick={() => apply((c) => c.extendMarkRange('link').unsetLink())}>
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
