import type { Editor, ChainedCommands } from '@tiptap/core'
import { applyLink, removeLink, type LinkTarget } from '../editor/links'
import { Check } from '../icons'
import { commands } from '../editor/commands'
import { inkColors, highlightColors } from '../editor/slashOptions'
import { useShortcutLabel } from '../useShortcuts'
import { alignmentIcons, sameColor, type WritingPicker } from './writingToolbar'

export default function WritingPickerContent({
  editor,
  readOnly,
  picker,
  url,
  setUrl,
  rows,
  setRows,
  cols,
  setCols,
  setError,
  apply,
  canRun,
  execute,
  linkTarget,
  linkTitle,
  setLinkTitle,
  onImages,
}: {
  editor: Editor
  readOnly: boolean
  picker: WritingPicker | null
  url: string
  setUrl: (value: string) => void
  rows: number
  setRows: (value: number) => void
  cols: number
  setCols: (value: number) => void
  setError: (value: string) => void
  apply: (action: (chain: ChainedCommands) => ChainedCommands) => boolean
  canRun: (id: string) => boolean
  execute: (id: string) => void
  linkTarget: LinkTarget | null
  linkTitle: string
  setLinkTitle: (value: string) => void
  onImages: (files: File[]) => Promise<void>
}) {
  const shortcutLabel = useShortcutLabel()
  const palette = (
    label: string,
    current: string | null | undefined,
    colors: typeof inkColors | typeof highlightColors,
    action: (color: string | null) => void,
  ) => (
    <section className="writing-palette" aria-label={label}>
      {colors
        .filter(([, color]) => color)
        .map(([name, color]) => (
          <button
            key={name}
            type="button"
            aria-label={`${label} ${name}`}
            aria-pressed={sameColor(current, color!)}
            disabled={readOnly}
            onClick={() => action(color)}
          >
            <span className="writing-color-dot" style={{ backgroundColor: color! }} />
            <span>{name}</span>
            {sameColor(current, color!) && <Check className="writing-menu-check" />}
          </button>
        ))}
      <div className="writing-menu-separator" />
      <button type="button" disabled={readOnly} onClick={() => action(null)}>
        {label === 'Text color'
          ? 'Remove text color'
          : label === 'Highlight'
            ? 'Remove highlight'
            : `Remove ${label.toLowerCase()}`}
      </button>
    </section>
  )
  const commandButton = (id: string) => {
    const command = commands.find((command) => command.id === id)!
    const label = shortcutLabel(id)
    return (
      <button key={id} type="button" disabled={readOnly || !canRun(id)} onClick={() => execute(id)}>
        <span>{command.label}</span>
        {label !== 'Unassigned' && <kbd>{label}</kbd>}
      </button>
    )
  }
  const background = (label: string, node: string) =>
    palette(label, editor.getAttributes(node).backgroundColor, highlightColors, (color) =>
      apply((chain) => chain.updateAttributes(node, { backgroundColor: color })),
    )
  switch (picker) {
    case 'color':
      return palette('Text color', editor.getAttributes('textStyle').color, inkColors, (color) =>
        apply((chain) => (color ? chain.setColor(color) : chain.unsetColor())),
      )
    case 'highlight':
      return palette(
        'Highlight',
        editor.getAttributes('highlight').color,
        highlightColors,
        (color) =>
          apply((chain) => (color ? chain.setHighlight({ color }) : chain.unsetHighlight())),
      )
    case 'alignment':
      return (
        <section>
          {Object.entries(alignmentIcons).map(([align, Icon]) => (
            <button
              key={align}
              type="button"
              disabled={readOnly}
              aria-pressed={editor.isActive({ textAlign: align })}
              onClick={() => apply((chain) => chain.setTextAlign(align))}
            >
              <Icon />
              <span>{align[0].toUpperCase() + align.slice(1)}</span>
              {editor.isActive({ textAlign: align }) && <Check className="writing-menu-check" />}
            </button>
          ))}
        </section>
      )
    case 'link':
      return (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const href = url.trim()
            if (!/^(https?:\/\/|mailto:)/i.test(href)) {
              setError('Use an https://, http://, or mailto: address.')
              return
            }
            if (linkTarget) apply((chain) => applyLink(chain, linkTarget, linkTitle, href))
          }}
        >
          <label htmlFor="desktop-writing-link-title">Link title</label>
          <input
            id="desktop-writing-link-title"
            className="text-field"
            value={linkTitle}
            disabled={readOnly || !linkTarget?.titleEditable}
            onChange={(event) => setLinkTitle(event.target.value)}
            placeholder="Use the address when empty"
          />
          {linkTarget && !linkTarget.titleEditable && (
            <p className="writing-field-hint">Select text within one block to edit its title.</p>
          )}
          <label htmlFor="desktop-writing-link">Link address</label>
          <input
            id="desktop-writing-link"
            className="text-field"
            value={url}
            disabled={readOnly}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://example.com"
          />
          <div className="writing-form-actions">
            <button type="submit" disabled={readOnly}>
              Apply link
            </button>
            <button
              type="button"
              disabled={readOnly || !linkTarget?.href}
              onClick={() => linkTarget && apply((chain) => removeLink(chain, linkTarget))}
            >
              Remove link
            </button>
          </div>
        </form>
      )
    case 'table':
      return (
        <>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (
                !Number.isInteger(rows) ||
                rows < 1 ||
                rows > 20 ||
                !Number.isInteger(cols) ||
                cols < 1 ||
                cols > 12
              ) {
                setError('Use 1-20 rows and 1-12 columns.')
                return
              }
              apply((chain) => chain.insertTable({ rows, cols, withHeaderRow: true }))
            }}
          >
            <div className="writing-table-size">
              <label>
                Rows
                <input
                  className="text-field"
                  type="number"
                  min={1}
                  max={20}
                  required
                  disabled={readOnly}
                  value={rows || ''}
                  onChange={(event) => setRows(Number(event.target.value))}
                />
              </label>
              <span>×</span>
              <label>
                Columns
                <input
                  className="text-field"
                  type="number"
                  min={1}
                  max={12}
                  required
                  disabled={readOnly}
                  value={cols || ''}
                  onChange={(event) => setCols(Number(event.target.value))}
                />
              </label>
            </div>
            <button type="submit" disabled={readOnly}>
              Insert table
            </button>
          </form>
          {editor.isActive('table') && (
            <>
              <div className="writing-menu-separator" />
              <section aria-label="Table actions">
                {commands
                  .filter((command) => command.context === 'table')
                  .map((command) => commandButton(command.id))}
              </section>
              <h3>Cell background</h3>
              {palette(
                'Cell background',
                editor.getAttributes('tableCell').backgroundColor ??
                  editor.getAttributes('tableHeader').backgroundColor,
                highlightColors,
                (color) => apply((chain) => chain.setCellAttribute('backgroundColor', color)),
              )}
            </>
          )}
        </>
      )
    case 'sections':
      return (
        <>
          <section>
            {['collapsible', 'wrap', 'unwrap', 'toggle-section', 'expand-all', 'collapse-all'].map(
              commandButton,
            )}
          </section>
          {editor.isActive('collapsibleHeader') && (
            <>
              <h3>Header background</h3>
              {background('Header background', 'collapsibleHeader')}
            </>
          )}
          {editor.isActive('collapsibleBody') && (
            <>
              <h3>Body background</h3>
              {background('Body background', 'collapsibleBody')}
            </>
          )}
        </>
      )
    case 'quote':
      return background('Quote background', 'blockquote')
    case 'image':
      return (
        <>
          <label htmlFor="desktop-writing-image">Choose image file</label>
          <input
            id="desktop-writing-image"
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,image/avif,image/bmp"
            multiple
            disabled={readOnly}
            onChange={(event) => onImages(Array.from(event.target.files ?? []))}
          />
          {editor.isActive('image') && (
            <>
              <h3>Image width</h3>
              <section>
                {[120, 240, 360, 600].map((width) => (
                  <button
                    key={width}
                    type="button"
                    disabled={readOnly}
                    onClick={() =>
                      apply((chain) => chain.updateAttributes('image', { width, height: null }))
                    }
                  >
                    {width}px
                  </button>
                ))}
                <button
                  type="button"
                  disabled={readOnly}
                  onClick={() => apply((chain) => chain.deleteSelection())}
                >
                  Remove image
                </button>
              </section>
            </>
          )}
        </>
      )
    default:
      return null
  }
}
