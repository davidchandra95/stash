import { hideMenu } from '../motion'
import { attachDomTooltip } from '../components/AppTooltip'
import { Node, type Editor } from '@tiptap/core'
import { Plugin, PluginKey, NodeSelection } from '@tiptap/pm/state'
import { closeHistory } from '@tiptap/pm/history'

export interface NoteCandidate {
  id: string
  title: string
  notebook: string
  updated: number
  trashed: boolean
}
export interface NoteLinkContext {
  notes: () => NoteCandidate[]
  create: (title: string) => NoteCandidate | undefined
  open: (id: string, newTab?: boolean) => void
  contextMenu?: (id: string, position: { x: number; y: number }) => void
}
const contexts = new WeakMap<Editor, NoteLinkContext>()
const labelListeners = new WeakMap<Editor, Set<() => void>>()
export function setNoteLinkContext(editor: Editor, context: NoteLinkContext) {
  contexts.set(editor, context)
  labelListeners.get(editor)?.forEach((refresh) => refresh())
  editor.view.dom.dispatchEvent(new Event('writing-references-changed'))
}
export const referenceTitle = (editor: Editor | undefined, id: string, fallback: string) =>
  ((editor
    ? contexts
        .get(editor)
        ?.notes()
        .find((n) => n.id === id)?.title
    : undefined) ??
    fallback) ||
  'Untitled note'
export function validNoteId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(id)
}
export function noteSuggestions(notes: NoteCandidate[], query: string) {
  const q = query.trim().toLocaleLowerCase()
  const title = (n: NoteCandidate) => (n.title || 'Untitled note').toLocaleLowerCase()
  const rank = (n: NoteCandidate) => (title(n) === q ? 0 : title(n).startsWith(q) ? 1 : 2)
  return notes
    .filter((n) => !n.trashed && title(n).includes(q))
    .sort(
      (a, b) => (q ? rank(a) - rank(b) : 0) || b.updated - a.updated || a.id.localeCompare(b.id),
    )
}
export function referenceMatch(editor: Editor) {
  const { $from, empty } = editor.state.selection
  if (
    !empty ||
    !$from.parent.isTextblock ||
    $from.parent.type.spec.code ||
    editor.view.composing ||
    $from.marks().some((m) => m.type.name === 'code')
  )
    return null
  const before = $from.parent.textBetween(0, $from.parentOffset, '\n', '\ufffc')
  const result = /\[\[([^\[\]\n\ufffc]*)(\]{0,2})$/.exec(before)
  if (!result) return null
  const prefix = before.slice(0, result.index)
  if ((/\\+$/.exec(prefix)?.[0].length ?? 0) % 2) return null
  return { from: $from.start() + result.index, to: $from.pos, query: result[1] }
}
export const noteReferenceKey = new PluginKey('noteReferences')
export const NoteReference = Node.create({
  name: 'noteReference',
  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,
  priority: 1500,
  addAttributes() {
    return {
      noteId: {
        default: '',
        validate: (value: unknown) => {
          if (!validNoteId(value)) throw Error('Invalid note reference ID')
        },
      },
      fallbackTitle: { default: 'Untitled note', validate: 'string' },
    }
  },
  parseHTML() {
    return [
      {
        tag: 'span[data-note-id]',
        getAttrs: (element) => {
          const id = element.getAttribute('data-note-id')
          return validNoteId(id)
            ? { noteId: id, fallbackTitle: element.textContent || 'Untitled note' }
            : false
        },
      },
    ]
  },
  renderHTML({ node }) {
    return [
      'span',
      { 'data-note-id': node.attrs.noteId, class: 'note-reference' },
      referenceTitle(this.editor, node.attrs.noteId, node.attrs.fallbackTitle),
    ]
  },
  renderText({ node }) {
    return referenceTitle(this.editor, node.attrs.noteId, node.attrs.fallbackTitle)
  },
  addNodeView() {
    return ({ node, editor }) => {
      let current = node
      const dom = document.createElement('span')
      const tooltip = attachDomTooltip(dom)
      dom.className = 'note-reference'
      dom.contentEditable = 'false'
      dom.setAttribute('role', 'link')
      dom.tabIndex = 0
      const refresh = () => {
        const title = referenceTitle(editor, current.attrs.noteId, current.attrs.fallbackTitle)
        dom.textContent = title
        dom.dataset.noteId = current.attrs.noteId
        dom.setAttribute('aria-label', `Open note: ${title}`)
        tooltip.update(`Open note: ${title}`)
      }
      const open = (newTab = false) => {
        const context = contexts.get(editor)
        if (newTab) context?.open(current.attrs.noteId, true)
        else context?.open(current.attrs.noteId)
      }
      dom.onclick = (event) => {
        event.preventDefault()
        open(event.metaKey || event.ctrlKey)
      }
      dom.oncontextmenu = (event) => {
        const menu = contexts.get(editor)?.contextMenu
        if (!menu) return
        event.preventDefault()
        event.stopPropagation()
        menu(current.attrs.noteId, { x: event.clientX, y: event.clientY })
      }
      dom.onkeydown = (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          event.stopPropagation()
          open(event.metaKey || event.ctrlKey)
        }
      }
      const listeners = labelListeners.get(editor) ?? new Set<() => void>()
      labelListeners.set(editor, listeners)
      listeners.add(refresh)
      refresh()
      return {
        dom,
        ignoreMutation: () => true,
        stopEvent: (event) =>
          event.type === 'click' || event.type === 'keydown' || event.type === 'contextmenu',
        update: (next) => {
          if (next.type !== current.type) return false
          current = next
          refresh()
          return true
        },
        destroy: () => {
          listeners.delete(refresh)
          tooltip.destroy()
        },
      }
    }
  },
  addProseMirrorPlugins() {
    const editor = this.editor
    let menu: HTMLDivElement | undefined,
      selected = 0,
      previous = '',
      dismissed: number | null = null,
      active = true
    const match = () => {
      const m = referenceMatch(editor)
      return m && m.from !== dismissed ? m : null
    }
    const options = () => {
      const m = match(),
        context = contexts.get(editor)
      if (!m || !context) return []
      const notes = context.notes()
      const results: { note?: NoteCandidate; title: string; notebook: string }[] = noteSuggestions(
        notes,
        m.query,
      ).map((note) => ({ note, title: note.title || 'Untitled note', notebook: note.notebook }))
      const title = m.query.trim()
      if (
        title &&
        !notes.some(
          (n) => !n.trashed && n.title.trim().toLocaleLowerCase() === title.toLocaleLowerCase(),
        )
      )
        results.push({ title, notebook: 'Create a new note' })
      return results
    }
    const hide = () => {
      if (menu) hideMenu(menu)
      editor.view.dom.removeAttribute('aria-activedescendant')
      editor.view.dom.removeAttribute('aria-controls')
    }
    const position = () => {
      const m = match()
      if (!m || !menu || menu.hidden) return
      const rect = editor.view.coordsAtPos(m.from)
      menu.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - menu.offsetWidth - 8))}px`
      menu.style.top = `${Math.max(8, rect.bottom + menu.offsetHeight + 8 < innerHeight ? rect.bottom + 5 : rect.top - menu.offsetHeight - 5)}px`
    }
    const choose = (index: number) => {
      const m = match(),
        option = options()[index]
      if (!m || !option) return
      const note = option.note ?? contexts.get(editor)?.create(option.title)
      if (!note) return
      const after = editor.state.doc.textBetween(
        m.to,
        Math.min(editor.state.doc.content.size, m.to + 2),
      )
      editor.view.dispatch(closeHistory(editor.state.tr))
      editor
        .chain()
        .focus()
        .insertContentAt(
          { from: m.from, to: m.to + (after === ']]' ? 2 : 0) },
          {
            type: 'noteReference',
            attrs: { noteId: note.id, fallbackTitle: note.title || 'Untitled note' },
            marks:
              editor.state.storedMarks?.map((mark) => mark.toJSON()) ??
              editor.state.selection.$from.marks().map((mark) => mark.toJSON()),
          },
        )
        .run()
      editor.view.dispatch(closeHistory(editor.state.tr))
      hide()
    }
    const render = () => {
      if (!menu) return
      const m = match()
      if (!m || !active || !contexts.has(editor)) {
        hide()
        return
      }
      const key = `${m.from}:${m.query}`
      if (key !== previous) {
        selected = 0
        previous = key
      }
      const rows = options()
      selected = Math.max(0, Math.min(selected, rows.length - 1))
      menu.replaceChildren()
      menu.hidden = false
      menu.dataset.theme =
        editor.view.dom.closest('[data-theme]')?.getAttribute('data-theme') ?? 'dark'
      menu.dataset.palette =
        editor.view.dom.closest('[data-palette]')?.getAttribute('data-palette') ?? 'classic'
      if (!rows.length) {
        const empty = document.createElement('div')
        empty.className = 'note-link-empty'
        empty.textContent = 'Type a title to create a note'
        menu.append(empty)
      }
      rows.forEach((row, index) => {
        const button = document.createElement('button')
        button.type = 'button'
        button.id = `${menu!.id}-${index}`
        button.className = 'slash-option note-link-option'
        button.setAttribute('role', 'option')
        button.setAttribute('aria-selected', String(index === selected))
        const title = document.createElement('span'),
          separator = document.createElement('span'),
          detail = document.createElement('span')
        title.className = 'note-link-title'
        separator.className = 'note-link-separator'
        separator.setAttribute('aria-hidden', 'true')
        detail.className = 'note-link-detail'
        title.textContent = row.note ? row.title : `Create “${row.title}”`
        separator.textContent = '·'
        detail.textContent = row.notebook || 'Uncategorized'
        button.append(title, separator, detail)
        button.onmousedown = (e) => e.preventDefault()
        button.onclick = () => choose(index)
        button.onmouseenter = () => {
          selected = index
          menu
            ?.querySelectorAll('[role=option]')
            .forEach((el, i) => el.setAttribute('aria-selected', String(i === index)))
        }
        menu!.append(button)
      })
      editor.view.dom.setAttribute('aria-controls', menu.id)
      if (rows.length)
        editor.view.dom.setAttribute('aria-activedescendant', `${menu.id}-${selected}`)
      menu.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest' })
      position()
    }
    return [
      new Plugin({
        key: noteReferenceKey,
        props: {
          handleKeyDown: (_view, event) => {
            if (event.isComposing || editor.view.composing) return false
            if (
              event.key === 'Enter' &&
              editor.state.selection instanceof NodeSelection &&
              editor.state.selection.node.type.name === 'noteReference'
            ) {
              contexts
                .get(editor)
                ?.open(editor.state.selection.node.attrs.noteId, event.metaKey || event.ctrlKey)
              return true
            }
            const m = match()
            if (!m || !active || !contexts.has(editor)) return false
            if (event.key === 'Escape') {
              dismissed = m.from
              hide()
              return true
            }
            const rows = options()
            if (!rows.length) return false
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              selected =
                (selected + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length
              render()
              return true
            }
            if (event.key === 'Enter') {
              choose(selected)
              return true
            }
            return false
          },
          handleDOMEvents: {
            blur: () => {
              active = false
              hide()
              return false
            },
            focus: () => {
              active = true
              render()
              return false
            },
            compositionstart: () => {
              hide()
              return false
            },
          },
        },
        view: () => {
          menu = document.createElement('div')
          menu.className = 'slash-menu note-link-menu'
          menu.id = `note-links-${crypto.randomUUID()}`
          menu.setAttribute('role', 'listbox')
          menu.setAttribute('aria-label', 'Link to note')
          menu.hidden = true
          document.body.append(menu)
          const deactivate = () => {
            active = false
            hide()
          }
          editor.view.dom.addEventListener('writing-deactivate', deactivate)
          editor.view.dom.addEventListener('writing-references-changed', render)
          window.addEventListener('resize', position)
          document.addEventListener('scroll', position, true)
          return {
            update: (_view, oldState) => {
              if (
                dismissed !== null &&
                (oldState.selection.$from.start() !== editor.state.selection.$from.start() ||
                  !referenceMatch(editor))
              )
                dismissed = null
              render()
            },
            destroy: () => {
              editor.view.dom.removeEventListener('writing-deactivate', deactivate)
              editor.view.dom.removeEventListener('writing-references-changed', render)
              window.removeEventListener('resize', position)
              document.removeEventListener('scroll', position, true)
              menu?.remove()
            },
          }
        },
      }),
    ]
  },
})
