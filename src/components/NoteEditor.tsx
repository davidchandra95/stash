import AppTooltip from './AppTooltip'
import { isPdfLink } from '../pdf/citations'
import { platform, openExternalUrl } from '../platform'
import { useContext } from 'react'
import { ShortcutContext, useShortcutLabel } from '../useShortcuts'
import { editorShortcutOverrides } from '../editor/shortcuts'
import MarkdownTools from './MarkdownTools'
import { markdownContexts } from '../editor/markdownContext'
import { resolveFileLink, pendingFragments, headingSlug } from '../editor/fileNavigation'
import { library } from '../storage/useLibrary'
import { setNoteLinkContext, type NoteLinkContext } from '../editor/noteReferences'
import { setBodyTagContext } from '../editor/bodyTags'
import WritingTools from './WritingTools'
import DatePicker from './DatePicker'
import DrawingDialog from '../drawing/Dialog'
import DesktopWritingToolbar from './DesktopWritingToolbar'
import { EditorContent, useEditorState, type JSONContent } from '@tiptap/react'
import { useLayoutEffect } from 'react'
import { getEditor } from '../editor/session'
import { setCursorSettings } from '../editor/cursor'
import { runCommand } from '../editor/commands'
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  Code2,
  Table2,
  Highlighter,
  Minus,
  Undo2,
  Redo2,
  WrapText,
} from '../icons'
import type { Appearance, CursorSettings, Note } from '../model'

export default function NoteEditor({
  note,
  onChange,
  noteLinks,
  onOpenTag,
  cursorSettings,
  readOnly = false,
  appearance,
}: {
  note: Note
  readOnly?: boolean
  appearance?: Appearance
  noteLinks: NoteLinkContext
  onOpenTag: (tag: string) => void
  cursorSettings: CursorSettings
  onChange: (content: JSONContent, text: string) => void
}) {
  const overrides = useContext(ShortcutContext)
  const shortcutLabel = useShortcutLabel()
  const editor = getEditor(note.id, note.content, onChange, !!note.source)
  useLayoutEffect(() => {
    editorShortcutOverrides.set(editor, overrides)
  }, [editor, overrides])
  useLayoutEffect(() => {
    editor.setEditable(!readOnly, false)
  }, [editor, readOnly])
  useLayoutEffect(() => {
    const dom = editor.view.dom
    const handle = (event: MouseEvent) => {
      const href = (event.target as HTMLElement).closest('a[href]')?.getAttribute('href')
      if (!href || !isPdfLink(href)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (event.type === 'click')
        dom.dispatchEvent(
          new CustomEvent(platform.mobile ? 'writing-error' : 'pdf-citation', {
            bubbles: true,
            detail: platform.mobile ? 'This PDF is unavailable on this device.' : href,
          }),
        )
    }
    dom.addEventListener('mousedown', handle, true)
    dom.addEventListener('click', handle, true)
    return () => {
      dom.removeEventListener('mousedown', handle, true)
      dom.removeEventListener('click', handle, true)
    }
  }, [editor])
  useLayoutEffect(() => {
    if (!note.source) return
    markdownContexts.set(editor, {
      id: note.id,
      source: note.source,
      notes: () => library.getSnapshot().notes,
      readImage: (href) => library.command<string>('read_note_asset', { id: note.id, href }),
      saveImage: async (file) => {
        await library.activate(note.id)
        const bytes = new Uint8Array(await file.arrayBuffer())
        let binary = ''
        for (const byte of bytes) binary += String.fromCharCode(byte)
        return library.command<string>('write_note_asset', {
          id: note.id,
          name: file.name,
          data: btoa(binary),
        })
      },
      open: (href, newTab) => {
        const state = library.getSnapshot()
        const target = resolveFileLink(note, href, state.notes, state.roots)
        if (target) {
          if (target.fragment) pendingFragments.set(target.id, target.fragment)
          noteLinks.open(target.id, newTab)
        } else if (/^(https?:|mailto:)/i.test(href))
          window.open(href, '_blank', 'noopener,noreferrer')
        else
          editor.view.dom.dispatchEvent(
            new CustomEvent('writing-error', {
              bubbles: true,
              detail:
                'This file link is not available in the linked notebooks. Refresh the folder and try again.',
            }),
          )
      },
    })
  }, [editor, note.source, noteLinks])
  useLayoutEffect(() => {
    const fragment = pendingFragments.get(note.id)
    if (fragment) {
      pendingFragments.delete(note.id)
      const counts = new Map<string, number>()
      let found = false
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'heading' && !found) {
          const base = headingSlug(node.textContent),
            count = counts.get(base) ?? 0
          counts.set(base, count + 1)
          if ((count ? `${base}-${count}` : base) === fragment) {
            found = true
            editor.commands.setTextSelection(pos + 1)
            editor.commands.scrollIntoView()
          }
        }
      })
    }
  }, [editor, note.source, noteLinks])
  useLayoutEffect(() => {
    if (note.source) return
    const dom = editor.view.dom
    const click = (event: MouseEvent) => {
      const href = (event.target as HTMLElement).closest('a[href]')?.getAttribute('href')
      if (platform.mobile && href && /^(https?:|mailto:)/i.test(href)) {
        event.preventDefault()
        event.stopImmediatePropagation()
        void openExternalUrl(href).catch((error) =>
          editor.view.dom.dispatchEvent(
            new CustomEvent('writing-error', { bubbles: true, detail: String(error) }),
          ),
        )
        return
      }
      if (!href || !/^(upnote2:|file:)/i.test(href)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      const target = resolveFileLink(note, href, [], [])
      if (target) {
        if (target.fragment) pendingFragments.set(target.id, target.fragment)
        noteLinks.open(target.id, event.metaKey || event.ctrlKey)
      } else if (/^file:/i.test(href)) {
        if (platform.mobile) {
          editor.view.dom.dispatchEvent(
            new CustomEvent('writing-error', {
              bubbles: true,
              detail:
                'This file is on another device. External folders are not available on mobile.',
            }),
          )
          return
        }
        void library.command('open_external_file', { href }).catch((error) => {
          editor.view.dom.dispatchEvent(
            new CustomEvent('writing-error', { bubbles: true, detail: String(error) }),
          )
        })
      }
    }
    dom.addEventListener('click', click, true)
    return () => dom.removeEventListener('click', click, true)
  }, [editor, note, noteLinks])
  useLayoutEffect(() => {
    setNoteLinkContext(editor, noteLinks)
  }, [editor, noteLinks])
  useLayoutEffect(() => {
    setBodyTagContext(editor, { open: onOpenTag })
  }, [editor, onOpenTag])
  useLayoutEffect(() => {
    setCursorSettings(editor, cursorSettings)
  }, [
    cursorSettings.cursorStyle,
    cursorSettings.cursorBlinking,
    cursorSettings.cursorSmoothCaretAnimation,
    editor,
  ])
  useLayoutEffect(() => {
    const dom = editor.view.dom
    return () => {
      dom.dispatchEvent(new Event('writing-deactivate'))
    }
  }, [editor])
  useEditorState({ editor, selector: ({ editor: current }) => current?.state })
  if (!editor) return null
  const toolShortcut = (label: string) => {
    const id =
      (
        {
          Strikethrough: 'strike',
          'Bullet list': 'bullet',
          'Numbered list': 'number',
          Checklist: 'task',
          'Inline code': 'inline-code',
        } as Record<string, string>
      )[label] ?? label.toLowerCase()
    const binding = shortcutLabel(id)
    return binding
  }
  const tool = (
    label: string,
    icon: React.ReactNode,
    action: () => void,
    active = false,
    disabled = false,
  ) => (
    <AppTooltip
      instant
      label={label}
      shortcut={toolShortcut(label)}
      disabled={
        disabled || readOnly || (!!note.source && ['Underline', 'Highlight'].includes(label))
      }
      key={label}
    >
      <button
        type="button"
        className={`tool ${active ? 'active' : ''}`}

        aria-label={label}
        aria-pressed={active}
        disabled={
          disabled || readOnly || (!!note.source && ['Underline', 'Highlight'].includes(label))
        }
        onMouseDown={(e) => e.preventDefault()}
        onClick={action}
      >
        {icon}
      </button>
    </AppTooltip>
  )
  return (
    <>
      <EditorContent editor={editor} className="editor-body" />
      <DatePicker editor={editor} readOnly={readOnly} appearance={appearance} />
      {!note.source && (
        <DrawingDialog
          key={note.id}
          noteId={note.id}
          editor={editor}
          readOnly={readOnly}
          appearance={appearance}
        />
      )}
      <fieldset className="writing-dock editor-controls" disabled={readOnly}>
        {editor.isActive('table') && (
          <div
            className="context-tools"
            aria-label="Table controls"
            onMouseDown={(e) => e.preventDefault()}
          >
            <span>TABLE</span>
            <button onClick={() => runCommand(editor, 'row-after')}>+ Row</button>
            <button onClick={() => runCommand(editor, 'column-after')}>+ Column</button>
            <button onClick={() => runCommand(editor, 'remove-row')}>Remove row</button>
            <button onClick={() => runCommand(editor, 'remove-column')}>Remove column</button>
            <button onClick={() => runCommand(editor, 'remove-table')}>Remove table</button>
          </div>
        )}
        {editor.isActive('codeBlock') && (
          <div className="context-tools">
            <span>CODE</span>
            <select
              aria-label="Code language"
              value={editor.getAttributes('codeBlock').language || 'plaintext'}
              onChange={(e) =>
                editor
                  .chain()
                  .focus()
                  .updateAttributes('codeBlock', { language: e.target.value })
                  .run()
              }
            >
              {[
                'plaintext',
                'mermaid',
                'typescript',
                'javascript',
                'rust',
                'go',
                'python',
                'json',
                'css',
                'bash',
                'sql',
              ].map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
            {tool('Exit code block', <WrapText size={15} />, () => {
              editor.chain().focus().exitCode().run()
            })}
          </div>
        )}
        {!platform.mobile && !note.source ? (
          <DesktopWritingToolbar editor={editor} readOnly={readOnly} appearance={appearance} />
        ) : (
          <div className="toolbar" role="toolbar" aria-label="Text formatting">
            <select
              aria-label="Text style"
              value={editor.isActive('heading') ? `h${editor.getAttributes('heading').level}` : 'p'}
              onChange={(e) => {
                const value = e.target.value
                runCommand(editor, value === 'p' ? 'paragraph' : value)
              }}
            >
              <option value="p">Text</option>
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option value={`h${n}`} key={n}>
                  Heading {n}
                </option>
              ))}
            </select>
            <i />
            {tool(
              'Bold',
              <Bold />,
              () => {
                runCommand(editor, 'bold')
              },
              editor.isActive('bold'),
            )}
            {tool(
              'Italic',
              <Italic />,
              () => {
                runCommand(editor, 'italic')
              },
              editor.isActive('italic'),
            )}
            {tool(
              'Underline',
              <Underline />,
              () => {
                runCommand(editor, 'underline')
              },
              editor.isActive('underline'),
            )}
            {tool(
              'Strikethrough',
              <Strikethrough />,
              () => {
                runCommand(editor, 'strike')
              },
              editor.isActive('strike'),
            )}
            {tool(
              'Highlight',
              <Highlighter />,
              () => {
                runCommand(editor, 'highlight')
              },
              editor.isActive('highlight'),
            )}
            <i />
            {tool(
              'Bullet list',
              <List />,
              () => {
                runCommand(editor, 'bullet')
              },
              editor.isActive('mixedListItem', { kind: 'bullet' }),
            )}
            {tool(
              'Numbered list',
              <ListOrdered />,
              () => {
                runCommand(editor, 'number')
              },
              editor.isActive('mixedListItem', { kind: 'number' }),
            )}
            {tool(
              'Checklist',
              <ListTodo />,
              () => {
                runCommand(editor, 'task')
              },
              editor.isActive('mixedListItem', { kind: 'task' }),
            )}
            <i />
            {tool(
              'Quote',
              <Quote />,
              () => {
                runCommand(editor, 'quote')
              },
              editor.isActive('blockquote'),
            )}
            {tool(
              'Code block',
              <Code2 />,
              () => {
                runCommand(editor, 'code')
              },
              editor.isActive('codeBlock'),
            )}
            {tool('Insert table', <Table2 />, () => {
              runCommand(editor, 'table')
            })}
            {tool('Divider', <Minus />, () => {
              runCommand(editor, 'divider')
            })}
            {note.source ? (
              <MarkdownTools editor={editor} readOnly={readOnly} />
            ) : (
              <WritingTools editor={editor} readOnly={readOnly} />
            )}
            <i />
            {tool(
              'Undo',
              <Undo2 />,
              () => {
                runCommand(editor, 'undo')
              },
              false,
              !editor.can().undo(),
            )}
            {tool(
              'Redo',
              <Redo2 />,
              () => {
                runCommand(editor, 'redo')
              },
              false,
              !editor.can().redo(),
            )}
          </div>
        )}
      </fieldset>
    </>
  )
}
