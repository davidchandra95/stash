import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import type { Transaction } from '@tiptap/pm/state'
import {
  applyLink,
  captureLinkTarget,
  mapLinkTarget,
  removeLink,
  validLinkAddress,
  type LinkTarget,
} from '../editor/links'
import { markdownContexts } from '../editor/markdownContext'
export default function MarkdownTools({
  editor,
  readOnly = false,
}: {
  editor: Editor
  readOnly?: boolean
}) {
  const blocked = useRef(readOnly)
  blocked.current = readOnly
  const target = useRef<LinkTarget | null>(null)
  const [linkTitle, setLinkTitle] = useState('')
  const [open, setOpen] = useState(false),
    [url, setUrl] = useState(''),
    [error, setError] = useState('')
  const capture = () => {
    if (blocked.current || !editor.isEditable) return
    target.current = captureLinkTarget(editor)
    setUrl(target.current.href)
    setLinkTitle(target.current.title)
    setOpen(true)
    setError('')
  }
  useLayoutEffect(() => {
    setOpen(false)
    target.current = null
  }, [editor, readOnly])
  useEffect(() => {
    const dom = editor.view.dom
    const show = () => capture()
    const map = ({ transaction }: { transaction: Transaction }) => {
      target.current = mapLinkTarget(target.current, transaction)
    }
    const dismiss = () => {
      setOpen(false)
      target.current = null
    }
    editor.on('transaction', map)
    dom.addEventListener('writing-deactivate', dismiss)
    const fail = (event: Event) => {
      show()
      setError(String((event as CustomEvent).detail))
    }
    dom.addEventListener('writing-panel', show)
    dom.addEventListener('writing-error', fail)
    return () => {
      editor.off('transaction', map)
      dom.removeEventListener('writing-deactivate', dismiss)
      dom.removeEventListener('writing-panel', show)
      dom.removeEventListener('writing-error', fail)
    }
  }, [editor])
  return (
    <>
      <button
        className="tool"
        type="button"
        aria-label="Insert link or image"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (open) {
            setOpen(false)
            target.current = null
          } else capture()
        }}
      >
        •••
      </button>
      {open && (
        <div className="rich-menu" role="dialog" aria-label="Markdown writing tools">
          <button
            className="quiet-button"
            onClick={() => {
              setOpen(false)
              target.current = null
            }}
          >
            Close
          </button>
          {error && <p role="alert">{error}</p>}
          <label>
            Link title
            <input
              className="text-field"
              value={linkTitle}
              disabled={!target.current?.titleEditable}
              onChange={(event) => setLinkTitle(event.target.value)}
              placeholder="Use the address when empty"
            />
          </label>
          {target.current && !target.current.titleEditable && (
            <p className="writing-field-hint">Select text within one block to edit its title.</p>
          )}
          <label>
            Link address
            <input
              className="text-field"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="other-note.md or https://example.com"
            />
          </label>
          <button
            onClick={() => {
              const href = url.trim()
              if (!validLinkAddress(href, true)) {
                setError('Use a relative file link or a web address.')
                return
              }
              if (blocked.current || !editor.isEditable || !target.current) return
              if (!applyLink(editor.chain().focus(), target.current, linkTitle, href, true).run())
                return

              setOpen(false)
              target.current = null
            }}
          >
            Apply link
          </button>
          <button
            onClick={() => {
              if (blocked.current || !editor.isEditable || !target.current) return
              removeLink(editor.chain().focus(), target.current).run()
              setOpen(false)
            }}
          >
            Remove link
          </button>
          <label>
            Image
            <input
              type="file"
              accept="image/*"
              onChange={async (e) => {
                const file = e.target.files?.[0]
                if (!file) return
                try {
                  const context = markdownContexts.get(editor)
                  if (!context) throw Error('The note is not ready.')
                  const src = await context.saveImage(file)
                  if (!editor.isDestroyed && !blocked.current && editor.isEditable)
                    editor.chain().focus().setImage({ src, alt: file.name }).run()
                  setOpen(false)
                } catch (error) {
                  setError(String(error))
                }
              }}
            />
          </label>
        </div>
      )}
    </>
  )
}
