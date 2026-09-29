import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import type { SelectionBookmark } from '@tiptap/pm/state'
import { markdownContexts } from '../editor/markdownContext'
export default function MarkdownTools({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false),
    [url, setUrl] = useState(''),
    [error, setError] = useState('')
  const bookmark = useRef<SelectionBookmark | null>(null)
  useEffect(() => {
    const dom = editor.view.dom
    const show = () => {
      bookmark.current = editor.state.selection.getBookmark()
      setOpen(true)
    }
    const fail = (event: Event) => {
      setError(String((event as CustomEvent).detail))
      show()
    }
    dom.addEventListener('writing-panel', show)
    dom.addEventListener('writing-error', fail)
    return () => {
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
          bookmark.current = editor.state.selection.getBookmark()
          setUrl(editor.getAttributes('link').href ?? '')
          setOpen(!open)
        }}
      >
        •••
      </button>
      {open && (
        <div className="rich-menu" role="dialog" aria-label="Markdown writing tools">
          <button className="quiet-button" onClick={() => setOpen(false)}>
            Close
          </button>
          {error && <p role="alert">{error}</p>}
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
              if (!href || /^(?!https?:|mailto:|upnote2:)[a-z][a-z0-9+.-]*:/i.test(href)) {
                setError('Use a relative file link or a web address.')
                return
              }
              const chain = editor
                .chain()
                .focus()
                .command(({ tr }) => {
                  if (bookmark.current) tr.setSelection(bookmark.current.resolve(tr.doc))
                  return true
                })
              if (editor.state.selection.empty)
                chain
                  .insertContent({
                    type: 'text',
                    text: href,
                    marks: [{ type: 'link', attrs: { href } }],
                  })
                  .run()
              else chain.setLink({ href }).run()
              setOpen(false)
            }}
          >
            Apply link
          </button>
          <button
            onClick={() => {
              editor.chain().focus().unsetLink().run()
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
                  if (!editor.isDestroyed)
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
