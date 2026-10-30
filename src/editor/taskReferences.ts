import { Node, type Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { closeHistory } from '@tiptap/pm/history'
import { hideMenu } from '../motion'
import { attachDomTooltip } from '../components/AppTooltip'
import { noteLinkContext, validNoteId } from './noteReferences'
import { projectStore } from '../projects/store'
import { toggleTask } from '../projects/actions'
import { dueState, formatDate, type Task } from '../projects/model'

/**
 * A mention of a task. The note stores only the task ID (plus a title for when the task isn't
 * available); the checkbox, title and due date always come from the task record, so every note
 * that mentions a task shows its current state and ticking one never rewrites a note.
 */
export const taskLinkPrefix = 'stash://task/'
export const taskLink = (id: string) => `${taskLinkPrefix}${id}`
export function taskIdFromLink(href: string) {
  if (!href.startsWith(taskLinkPrefix)) return null
  const id = href.slice(taskLinkPrefix.length)
  return validNoteId(id) ? id : null
}

const findTask = (id: string) => {
  const { tasks, ready } = projectStore.getSnapshot()
  return { task: tasks.find((t) => t.id === id), ready }
}
export function taskTitle(id: string, fallback: string) {
  return findTask(id).task?.title || fallback || 'Task'
}

/** Open tasks first, then finished ones; prefix matches before other matches. */
export function taskSuggestions(tasks: Task[], query: string, limit = 8) {
  const q = query.trim().toLocaleLowerCase()
  const title = (t: Task) => t.title.toLocaleLowerCase()
  const open = (t: Task) => (t.status === 'todo' || t.status === 'doing' ? 0 : 1)
  const rank = (t: Task) => (!q ? 0 : title(t).startsWith(q) ? 0 : 1)
  return tasks
    .filter((t) => t.deletedAt === null && title(t).includes(q))
    .sort((a, b) => open(a) - open(b) || rank(a) - rank(b) || b.updated - a.updated)
    .slice(0, limit)
}

/** `@query` at the caret, where `@` starts a word. */
export function mentionMatch(editor: Editor) {
  const { $from, empty } = editor.state.selection
  if (
    !empty ||
    !$from.parent.isTextblock ||
    $from.parent.type.spec.code ||
    editor.view.composing ||
    $from.marks().some((mark) => mark.type.name === 'code')
  )
    return null
  const before = $from.parent.textBetween(0, $from.parentOffset, '\n', '￼')
  const result = /(^|[\s([{"'“‘])@([^\n@￼]{0,60})$/.exec(before)
  if (!result) return null
  const at = result.index + result[1].length
  return { from: $from.start() + at, to: $from.pos, query: result[2] }
}

const checkIcon =
  '<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>'
export const taskReferenceKey = new PluginKey('taskReferences')
export const TaskReference = Node.create({
  name: 'taskReference',
  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,
  priority: 1500,
  addAttributes() {
    return {
      taskId: {
        default: '',
        validate: (value: unknown) => {
          if (!validNoteId(value)) throw Error('Invalid task reference ID')
        },
      },
      fallbackTitle: { default: 'Task', validate: 'string' },
    }
  },
  parseHTML() {
    return [
      {
        tag: 'span[data-task-id]',
        getAttrs: (element) => {
          const id = element.getAttribute('data-task-id')
          return validNoteId(id) ? { taskId: id, fallbackTitle: element.textContent || 'Task' } : false
        },
      },
    ]
  },
  renderHTML({ node }) {
    return [
      'span',
      { 'data-task-id': node.attrs.taskId, class: 'task-ref' },
      taskTitle(node.attrs.taskId, node.attrs.fallbackTitle),
    ]
  },
  renderText({ node }) {
    return taskTitle(node.attrs.taskId, node.attrs.fallbackTitle)
  },
  addNodeView() {
    return ({ node, editor }) => {
      let current = node
      const dom = document.createElement('span')
      const check = document.createElement('button')
      const title = document.createElement('span')
      const meta = document.createElement('span')
      dom.className = 'task-ref'
      dom.contentEditable = 'false'
      check.type = 'button'
      check.setAttribute('role', 'checkbox')
      title.className = 'task-ref-title'
      title.setAttribute('role', 'link')
      title.tabIndex = 0
      meta.className = 'task-ref-meta'
      dom.append(check, title, meta)
      const tooltip = attachDomTooltip(title)
      const refresh = () => {
        const { task, ready } = findTask(current.attrs.taskId)
        const missing = ready && (!task || task.deletedAt !== null)
        const label = task?.title || current.attrs.fallbackTitle || 'Task'
        dom.dataset.taskId = current.attrs.taskId
        dom.dataset.status = missing ? 'missing' : (task?.status ?? 'todo')
        check.className = `task-check is-${task?.status ?? 'todo'}`
        check.disabled = !task || missing || !editor.isEditable
        check.setAttribute('aria-checked', String(task?.status === 'done'))
        check.setAttribute('aria-label', `${task?.status === 'done' ? 'Reopen' : 'Complete'} “${label}”`)
        check.innerHTML = task?.status === 'done' ? checkIcon : ''
        title.textContent = label
        const due = task && !missing && task.dueDate ? dueState(task) : 'none'
        meta.textContent = missing
          ? task
            ? 'Deleted task'
            : 'Task not found'
          : task?.dueDate
            ? formatDate(task.dueDate)
            : ''
        meta.className = `task-ref-meta is-${missing ? 'missing' : due}`
        meta.hidden = !meta.textContent
        tooltip.update(missing ? label : `Open task: ${label}`)
      }
      check.onmousedown = (event) => event.preventDefault()
      check.onclick = (event) => {
        event.preventDefault()
        const { task } = findTask(current.attrs.taskId)
        if (task && task.deletedAt === null) toggleTask(task)
      }
      const open = () => {
        const { task } = findTask(current.attrs.taskId)
        if (task && task.deletedAt === null) noteLinkContext(editor)?.openTask?.(task.id)
      }
      title.onclick = (event) => {
        event.preventDefault()
        open()
      }
      title.onkeydown = (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          event.stopPropagation()
          open()
        }
      }
      const unsubscribe = projectStore.subscribe(refresh)
      refresh()
      return {
        dom,
        ignoreMutation: () => true,
        stopEvent: (event) =>
          (event.type === 'click' || event.type === 'keydown' || event.type === 'mousedown') &&
          (event.target === check || event.target === title || check.contains(event.target as globalThis.Node)),
        update: (next) => {
          if (next.type !== current.type) return false
          current = next
          refresh()
          return true
        },
        destroy: () => {
          unsubscribe()
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
      const m = mentionMatch(editor)
      return m && m.from !== dismissed && projectStore.getSnapshot().ready ? m : null
    }
    const options = () => {
      const m = match()
      return m ? taskSuggestions(projectStore.getSnapshot().tasks, m.query) : []
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
        task = options()[index]
      if (!m || !task) return
      editor.view.dispatch(closeHistory(editor.state.tr))
      editor
        .chain()
        .focus()
        .insertContentAt({ from: m.from, to: m.to }, [
          { type: 'taskReference', attrs: { taskId: task.id, fallbackTitle: task.title } },
          { type: 'text', text: ' ' },
        ])
        .run()
      editor.view.dispatch(closeHistory(editor.state.tr))
      hide()
    }
    const render = () => {
      if (!menu) return
      const m = match()
      const rows = m && active ? options() : []
      // No empty state: `@` followed by ordinary text shouldn't keep a menu open.
      if (!rows.length) {
        hide()
        return
      }
      const key = `${m!.from}:${m!.query}`
      if (key !== previous) {
        selected = 0
        previous = key
      }
      selected = Math.max(0, Math.min(selected, rows.length - 1))
      const { projects } = projectStore.getSnapshot()
      menu.replaceChildren()
      menu.hidden = false
      const heading = document.createElement('div')
      heading.className = 'task-mention-heading'
      heading.textContent = 'Tasks'
      menu.append(heading)
      rows.forEach((task, index) => {
        const button = document.createElement('button')
        button.type = 'button'
        button.id = `${menu!.id}-${index}`
        button.className = 'slash-option note-link-option task-mention-option'
        button.setAttribute('role', 'option')
        button.setAttribute('aria-selected', String(index === selected))
        const box = document.createElement('span'),
          title = document.createElement('span'),
          detail = document.createElement('span')
        box.className = `task-check is-${task.status}`
        box.setAttribute('aria-hidden', 'true')
        if (task.status === 'done') box.innerHTML = checkIcon
        title.className = 'note-link-title'
        detail.className = 'note-link-detail'
        title.textContent = task.title
        detail.textContent = projects.find((p) => p.id === task.projectId)?.name ?? 'Inbox'
        button.dataset.status = task.status
        button.append(box, title, detail)
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
      editor.view.dom.setAttribute('aria-activedescendant', `${menu.id}-${selected}`)
      menu.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest' })
      position()
    }
    return [
      new Plugin({
        key: taskReferenceKey,
        props: {
          handleKeyDown: (_view, event) => {
            if (event.isComposing || editor.view.composing) return false
            const m = match()
            if (!m || !active || menu?.hidden !== false) return false
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
            if (event.key === 'Enter' || event.key === 'Tab') {
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
        view: (view) => {
          menu = document.createElement('div')
          menu.className = 'slash-menu task-mention-menu'
          menu.id = `task-mentions-${crypto.randomUUID()}`
          menu.setAttribute('role', 'listbox')
          menu.setAttribute('aria-label', 'Mention a task')
          menu.hidden = true
          document.body.append(menu)
          const deactivate = () => {
            active = false
            hide()
          }
          view.dom.addEventListener('writing-deactivate', deactivate)
          window.addEventListener('resize', position)
          document.addEventListener('scroll', position, true)
          return {
            update: (_view, oldState) => {
              if (
                dismissed !== null &&
                (oldState.selection.$from.start() !== editor.state.selection.$from.start() ||
                  !mentionMatch(editor))
              )
                dismissed = null
              render()
            },
            destroy: () => {
              view.dom.removeEventListener('writing-deactivate', deactivate)
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
