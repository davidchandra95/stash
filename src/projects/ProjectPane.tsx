import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import * as Dropdown from '@radix-ui/react-dropdown-menu'
import * as Context from '@radix-ui/react-context-menu'
import AppTooltip from '../components/AppTooltip'
import { trackApp, useApp, useBlocked } from '../app/context'
import { SidebarToggle } from '../app/WindowControls'
import { notebookColorValue } from '../notebookColors'
import {
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Ellipsis,
  FileText,
  FolderInput,
  Inbox,
  Link2,
  Notebook,
  Pencil,
  Plus,
  Trash2,
} from '../icons'
import ProjectRing from './ProjectRing'
import TaskDetail from './TaskDetail'
import TaskBoard from './TaskBoard'
import ProjectsOverview from './ProjectsOverview'
import TaskDateView, { isDateView } from './TaskDateView'
import {
  bySort,
  dueState,
  elapsed,
  formatDate,
  formatRange,
  groupOf,
  health,
  healthLabel,
  priorities,
  progress,
  projectStatuses,
  taskStatuses,
  today,
  type Project,
  type Task,
  type TaskGroup,
} from './model'
import {
  createTask,
  deleteTask,
  moveTask,
  reorderTask,
  setTaskStatus,
  toggleTask,
  updateProject,
  updateTask,
} from './actions'

const groups: { id: TaskGroup; label: string }[] = [
  { id: 'doing', label: 'Doing' },
  { id: 'todo', label: 'To do' },
  { id: 'done', label: 'Done' },
]

export function TaskCheckbox({ task, disabled }: { task: Task; disabled?: boolean }) {
  const done = task.status === 'done'
  return (
    <button
      type="button"
      className={`task-check is-${task.status}`}
      role="checkbox"
      aria-checked={done}
      aria-label={done ? `Reopen “${task.title}”` : `Complete “${task.title}”`}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation()
        toggleTask(task)
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {done && <Check aria-hidden="true" />}
    </button>
  )
}

export function PriorityBars({ priority }: { priority: number }) {
  return (
    <span className="priority-bars" data-priority={priority} aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  )
}

export default trackApp(function ProjectPane() {
  const app = useApp()
  const blocked = useBlocked()
  const { projects, tasks } = app.projects
  const overview = app.projectView === 'all'
  const inbox = app.projectView === 'inbox'
  const project =
    inbox || overview
      ? undefined
      : projects.find((p) => p.id === app.projectView && p.deletedAt === null)
  const dateView = isDateView(app.projectView) ? app.projectView : null
  const missing = !inbox && !overview && !dateView && !project

  useEffect(() => {
    // The project was deleted (here or by undoing its creation): fall back to the Inbox.
    if (missing && app.projects.ready) app.setProjectView('inbox')
  }, [missing, app.projects.ready])

  const projectId = project?.id ?? null
  const own = tasks.filter((t) => t.deletedAt === null && t.projectId === projectId).sort(bySort)
  const selected = (dateView ? tasks.filter((t) => t.deletedAt === null) : own).find(
    (t) => t.id === app.selectedTaskId,
  )

  const bar = (
    <div className="pane-bar" data-tauri-drag-region>
      {!app.sidebar && (
        <>
          <span className="window-controls-space" data-tauri-drag-region />
          <SidebarToggle />
        </>
      )}
      <span className="pane-spacer" data-tauri-drag-region />
      {(project || inbox) && (
        <div className="segmented" role="group" aria-label="Task layout">
          <button
            aria-pressed={app.projectLayout === 'list'}
            onClick={() => app.setProjectLayout('list')}
          >
            List
          </button>
          <button
            aria-pressed={app.projectLayout === 'board'}
            onClick={() => app.setProjectLayout('board')}
          >
            Board
          </button>
        </div>
      )}
      {project && <ProjectMenu project={project} />}
    </div>
  )
  if (dateView)
    return (
      <section
        className={`project-pane ${selected ? 'has-detail' : ''}`}
        aria-label={dateView === 'tasks:today' ? 'Due today' : 'Upcoming'}
        data-pane="project"
      >
        <div className="project-main">
          {bar}
          <TaskDateView view={dateView} />
        </div>
        {selected && <TaskDetail task={selected} />}
      </section>
    )
  if (overview)
    return (
      <section className="project-pane" aria-label="Projects" data-pane="project">
        <div className="project-main">
          {bar}
          <ProjectsOverview />
        </div>
      </section>
    )
  return (
    <section
      className={`project-pane ${selected ? 'has-detail' : ''}`}
      aria-label={project ? project.name : 'Inbox'}
      data-pane="project"
    >
      <div className="project-main">
        {bar}
        {project ? <ProjectHeader project={project} tasks={own} /> : <InboxHeader />}
        {app.projectLayout === 'board' ? (
          <div className="task-scroll board-scroll">
            <NewTask projectId={projectId} disabled={blocked} />
            <TaskBoard key={projectId ?? 'inbox'} tasks={own} disabled={blocked} />
          </div>
        ) : (
          <TaskList key={projectId ?? 'inbox'} projectId={projectId} tasks={own} disabled={blocked} />
        )}
      </div>
      {selected && <TaskDetail task={selected} />}
    </section>
  )
})

function InboxHeader() {
  return (
    <header className="project-header">
      <div className="project-title">
        <Inbox aria-hidden="true" />
        <h1>Inbox</h1>
      </div>
      <p className="project-description">Tasks that don’t belong to a project yet.</p>
    </header>
  )
}

function ProjectHeader({ project, tasks }: { project: Project; tasks: Task[] }) {
  const app = useApp()
  const blocked = useBlocked()
  const current = today()
  const stats = progress(tasks)
  const state = health(project, tasks, current)
  const time = elapsed(project, current)
  const notebook = app.notebooks.find((book) => book.id === project.notebookId)
  const range = formatRange(project.startDate, project.endDate, current)
  const left = project.endDate
    ? Math.round(
        (Date.parse(`${project.endDate}T00:00:00Z`) - Date.parse(`${current}T00:00:00Z`)) /
          86_400_000,
      )
    : null
  return (
    <header className="project-header">
      <div className="project-title">
        <ProjectRing project={project} ratio={stats.ratio} className="is-large" />
        <h1>{project.name}</h1>
      </div>
      {project.description && <p className="project-description">{project.description}</p>}
      <div className="project-props">
        <Dropdown.Root>
          <Dropdown.Trigger asChild>
            <button className="project-pill" disabled={blocked} aria-label="Project status">
              <span className={`status-dot is-${project.status}`} aria-hidden="true" />
              {projectStatuses.find((s) => s.id === project.status)?.label}
              <ChevronDown aria-hidden="true" className="ui-icon project-pill-chevron" />
            </button>
          </Dropdown.Trigger>
          <Dropdown.Portal>
            <Dropdown.Content className="menu" align="start" sideOffset={4} collisionPadding={8}>
              <Dropdown.RadioGroup
                value={project.status}
                onValueChange={(status) =>
                  updateProject(project, { status: status as Project['status'] })
                }
              >
                {projectStatuses.map((status) => (
                  <Dropdown.RadioItem key={status.id} value={status.id} className="menu-item">
                    <span className="menu-check">
                      <Dropdown.ItemIndicator>
                        <Check aria-hidden="true" />
                      </Dropdown.ItemIndicator>
                    </span>
                    <span className="menu-text">{status.label}</span>
                  </Dropdown.RadioItem>
                ))}
              </Dropdown.RadioGroup>
            </Dropdown.Content>
          </Dropdown.Portal>
        </Dropdown.Root>
        <button
          className="project-pill"
          disabled={blocked}
          onClick={() => app.setProjectEditing(project)}
        >
          <Calendar aria-hidden="true" />
          {range || <span className="project-pill-empty">Add dates</span>}
        </button>
        {notebook && (
          <button
            className="project-pill is-link"
            disabled={blocked}
            style={{ '--link-color': notebookColorValue(notebook.color) } as CSSProperties}
            onClick={() => {
              app.setNoteList(true)
              app.navigate(`book:${notebook.id}`)
            }}
          >
            <Notebook aria-hidden="true" />
            {notebook.name}
          </button>
        )}
      </div>
      <div className="project-progress">
        <span
          className="progress-track"
          role="progressbar"
          aria-label="Tasks done"
          aria-valuemin={0}
          aria-valuemax={stats.total}
          aria-valuenow={stats.done}
          style={
            {
              '--done': `${(stats.ratio ?? 0) * 100}%`,
              '--elapsed': `${(time ?? 0) * 100}%`,
            } as CSSProperties
          }
        >
          <i />
          {time !== null && <b title="Time elapsed" />}
        </span>
        <span>
          <strong>
            {stats.done} of {stats.total}
          </strong>{' '}
          done
        </span>
        {state && (
          <span className={`project-health is-${state}`}>
            <span className={`health-dot is-${state}`} aria-hidden="true" />
            {healthLabel[state]}
          </span>
        )}
        {time !== null && project.status === 'active' && (
          <span className="project-progress-note">
            {Math.round(time * 100)}% of time elapsed
            {left !== null && left >= 0 && ` · ${left} ${left === 1 ? 'day' : 'days'} left`}
          </span>
        )}
      </div>
    </header>
  )
}

function ProjectMenu({ project }: { project: Project }) {
  const app = useApp()
  const blocked = useBlocked()
  return (
    <Dropdown.Root>
      <AppTooltip instant label="Project actions" disabled={blocked}>
        <Dropdown.Trigger asChild>
          <button className="icon-btn" aria-label="Project actions" disabled={blocked}>
            <Ellipsis aria-hidden="true" />
          </button>
        </Dropdown.Trigger>
      </AppTooltip>
      <Dropdown.Portal>
        <Dropdown.Content className="menu" align="end" sideOffset={4} collisionPadding={8}>
          <Dropdown.Item className="menu-item" onSelect={() => app.setProjectEditing(project)}>
            <Pencil aria-hidden="true" className="ui-icon menu-icon" />
            <span className="menu-text">Edit project…</span>
          </Dropdown.Item>
          <Dropdown.Separator className="menu-separator" />
          <Dropdown.Item
            className="menu-item is-danger"
            onSelect={() => app.setProjectToDelete(project)}
          >
            <Trash2 aria-hidden="true" className="ui-icon menu-icon" />
            <span className="menu-text">Delete project…</span>
          </Dropdown.Item>
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  )
}

function NewTask({ projectId, disabled }: { projectId: string | null; disabled: boolean }) {
  const [draft, setDraft] = useState('')
  return (
    <form
      className="new-task"
      onSubmit={(event) => {
        event.preventDefault()
        if (!draft.trim()) return
        createTask(projectId, draft)
        setDraft('')
      }}
    >
      <Plus aria-hidden="true" />
      <input
        className="new-task-input"
        aria-label="New task"
        placeholder="New task"
        value={draft}
        maxLength={500}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setDraft('')
        }}
      />
      {draft && <kbd aria-hidden="true">↵</kbd>}
    </form>
  )
}

type Drag = { id: string; group: TaskGroup; startY: number; index: number; active: boolean }

function TaskList({
  projectId,
  tasks,
  disabled,
}: {
  projectId: string | null
  tasks: Task[]
  disabled: boolean
}) {
  const app = useApp()
  const [doneOpen, setDoneOpen] = useState(false)
  const [drag, setDrag] = useState<Drag | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const suppressClick = useRef(false)
  const byGroup = (group: TaskGroup) => tasks.filter((t) => groupOf(t) === group)
  const visible = groups.flatMap((g) => (g.id === 'done' && !doneOpen ? [] : byGroup(g.id)))
  const selectedId = app.selectedTaskId

  const focusRow = (id: string) =>
    requestAnimationFrame(() =>
      listRef.current?.querySelector<HTMLElement>(`[data-task-id="${id}"]`)?.focus(),
    )
  const select = (task: Task | undefined) => {
    if (!task) return
    app.setSelectedTaskId(task.id)
    focusRow(task.id)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, task: Task) => {
    const index = visible.findIndex((t) => t.id === task.id)
    const siblings = byGroup(groupOf(task))
    const at = siblings.findIndex((t) => t.id === task.id)
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault()
      if (event.key === 'ArrowUp' && at > 0) reorderTask(task, siblings[at - 2], siblings[at - 1])
      if (event.key === 'ArrowDown' && at < siblings.length - 1)
        reorderTask(task, siblings[at + 1], siblings[at + 2])
      focusRow(task.id)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      select(visible[index - 1])
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      select(visible[index + 1])
    } else if (event.key === ' ') {
      event.preventDefault()
      toggleTask(task)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      app.setSelectedTaskId(task.id)
    } else if (event.key === 'Escape') {
      app.setSelectedTaskId(null)
    } else if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault()
      const next = visible[index + 1] ?? visible[index - 1]
      deleteTask(task, app.setProjectNotice)
      if (selectedId === task.id) app.setSelectedTaskId(next?.id ?? null)
      if (next) focusRow(next.id)
    }
  }

  // Dragging reorders within a group, after the pointer moves 6px.
  useEffect(() => {
    if (!drag) return
    const rows = () =>
      [...(listRef.current?.querySelectorAll<HTMLElement>(`[data-group="${drag.group}"]`) ?? [])]
    const move = (event: PointerEvent) => {
      if (!drag.active && Math.abs(event.clientY - drag.startY) < 6) return
      const others = rows().filter((row) => row.dataset.taskId !== drag.id)
      const index = others.filter((row) => {
        const rect = row.getBoundingClientRect()
        return event.clientY > rect.top + rect.height / 2
      }).length
      setDrag((old) => old && { ...old, active: true, index })
    }
    const up = () => {
      if (drag.active) {
        suppressClick.current = true
        const siblings = byGroup(drag.group).filter((t) => t.id !== drag.id)
        const task = tasks.find((t) => t.id === drag.id)
        if (task) reorderTask(task, siblings[drag.index - 1], siblings[drag.index])
      }
      setDrag(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [drag, tasks])

  const row = (task: Task, position: number) => {
    const due = dueState(task)
    const indicator =
      drag?.active && drag.group === groupOf(task) && drag.id !== task.id
        ? byGroup(groupOf(task))
            .filter((t) => t.id !== drag.id)
            .findIndex((t) => t.id === task.id) === drag.index
        : false
    return (
      <TaskMenu key={task.id} task={task} disabled={disabled}>
        <div
          className={[
            'task-row',
            selectedId === task.id && 'is-selected',
            drag?.active && drag.id === task.id && 'is-dragging',
            indicator && 'drop-before',
          ]
            .filter(Boolean)
            .join(' ')}
          role="option"
          aria-selected={selectedId === task.id}
          tabIndex={selectedId === task.id || (!selectedId && position === 0) ? 0 : -1}
          data-task-id={task.id}
          data-group={groupOf(task)}
          onClick={() => {
            if (suppressClick.current) {
              suppressClick.current = false
              return
            }
            app.setSelectedTaskId(task.id)
          }}
          onPointerDown={(event) => {
            if (event.button !== 0 || disabled) return
            setDrag({
              id: task.id,
              group: groupOf(task),
              startY: event.clientY,
              index: 0,
              active: false,
            })
          }}
          onKeyDown={(event) => onKeyDown(event, task)}
        >
          <TaskCheckbox task={task} disabled={disabled} />
          <span className={`task-title ${task.status === 'cancelled' ? 'is-cancelled' : ''}`}>
            {task.title}
          </span>
          <span className="task-meta">
            {task.dueDate && (
              <span className={`task-due is-${due}`}>
                <Calendar aria-hidden="true" />
                {formatDate(task.dueDate)}
              </span>
            )}
            {task.priority > 0 && (
              <AppTooltip label={`${priorities[task.priority].label} priority`}>
                <span className="task-priority">
                  <PriorityBars priority={task.priority} />
                </span>
              </AppTooltip>
            )}
          </span>
        </div>
      </TaskMenu>
    )
  }

  const endIndicator = (group: TaskGroup) =>
    drag?.active &&
    drag.group === group &&
    drag.index === byGroup(group).filter((t) => t.id !== drag.id).length

  return (
    <div className="task-scroll">
      <NewTask projectId={projectId} disabled={disabled} />
      <div className="task-list" ref={listRef} role="listbox" aria-label="Tasks">
        {groups.map((group) => {
          const items = byGroup(group.id)
          if (!items.length) return null
          const collapsible = group.id === 'done'
          const open = !collapsible || doneOpen
          return (
            <div role="group" aria-label={group.label} key={group.id} className="task-group">
              <button
                type="button"
                className="task-group-header"
                aria-expanded={open}
                disabled={!collapsible}
                onClick={() => setDoneOpen((value) => !value)}
              >
                {open ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
                {group.label}
                <span className="count">{items.length}</span>
              </button>
              {open && items.map((task) => row(task, visible.indexOf(task)))}
              {open && endIndicator(group.id) && <div className="drop-end" />}
            </div>
          )
        })}
        {!tasks.length && (
          <p className="task-empty">
            {projectId ? 'No tasks yet. Add the first one above.' : 'Nothing in the Inbox.'}
          </p>
        )}
      </div>
    </div>
  )
}

export function TaskMenu({
  task,
  disabled,
  children,
}: {
  task: Task
  disabled: boolean
  children: React.ReactElement
}) {
  const app = useApp()
  const projects = app.projects.projects.filter(
    (p) => p.deletedAt === null && p.id !== task.projectId,
  )
  return (
    <Context.Root>
      <Context.Trigger asChild disabled={disabled}>
        {children}
      </Context.Trigger>
      <Context.Portal>
        <Context.Content className="menu" collisionPadding={8}>
          <Context.Item className="menu-item" onSelect={() => toggleTask(task)}>
            <CircleCheck aria-hidden="true" className="ui-icon menu-icon" />
            <span className="menu-text">{task.status === 'done' ? 'Reopen' : 'Complete'}</span>
            <span className="menu-shortcut">Space</span>
          </Context.Item>
          <Context.Sub>
            <Context.SubTrigger className="menu-item">
              <span className="ui-icon menu-icon" aria-hidden="true" />
              <span className="menu-text">Status</span>
              <ChevronRight aria-hidden="true" className="ui-icon menu-submenu-icon" />
            </Context.SubTrigger>
            <Context.Portal>
              <Context.SubContent className="menu" sideOffset={4}>
                <Context.RadioGroup
                  value={task.status}
                  onValueChange={(status) => setTaskStatus(task, status as Task['status'])}
                >
                  {taskStatuses.map((status) => (
                    <Context.RadioItem key={status.id} value={status.id} className="menu-item">
                      <span className="menu-check">
                        <Context.ItemIndicator>
                          <Check aria-hidden="true" />
                        </Context.ItemIndicator>
                      </span>
                      <span className="menu-text">{status.label}</span>
                    </Context.RadioItem>
                  ))}
                </Context.RadioGroup>
              </Context.SubContent>
            </Context.Portal>
          </Context.Sub>
          <Context.Sub>
            <Context.SubTrigger className="menu-item">
              <span className="ui-icon menu-icon" aria-hidden="true">
                <PriorityBars priority={task.priority} />
              </span>
              <span className="menu-text">Priority</span>
              <ChevronRight aria-hidden="true" className="ui-icon menu-submenu-icon" />
            </Context.SubTrigger>
            <Context.Portal>
              <Context.SubContent className="menu" sideOffset={4}>
                <Context.RadioGroup
                  value={String(task.priority)}
                  onValueChange={(value) =>
                    updateTask(task, { priority: Number(value) as Task['priority'] })
                  }
                >
                  {priorities.map((priority) => (
                    <Context.RadioItem
                      key={priority.id}
                      value={String(priority.id)}
                      className="menu-item"
                    >
                      <span className="menu-check">
                        <Context.ItemIndicator>
                          <Check aria-hidden="true" />
                        </Context.ItemIndicator>
                      </span>
                      <span className="menu-text">{priority.label}</span>
                    </Context.RadioItem>
                  ))}
                </Context.RadioGroup>
              </Context.SubContent>
            </Context.Portal>
          </Context.Sub>
          <Context.Item className="menu-item" onSelect={() => app.setSelectedTaskId(task.id)}>
            <FileText aria-hidden="true" className="ui-icon menu-icon" />
            <span className="menu-text">Open details</span>
            <span className="menu-shortcut">↵</span>
          </Context.Item>
          <Context.Sub>
            <Context.SubTrigger className="menu-item">
              <FolderInput aria-hidden="true" className="ui-icon menu-icon" />
              <span className="menu-text">Move to</span>
              <ChevronRight aria-hidden="true" className="ui-icon menu-submenu-icon" />
            </Context.SubTrigger>
            <Context.Portal>
              <Context.SubContent className="menu" sideOffset={4}>
                {task.projectId !== null && (
                  <Context.Item className="menu-item" onSelect={() => moveTask(task, null)}>
                    <Inbox aria-hidden="true" className="ui-icon menu-icon" />
                    <span className="menu-text">Inbox</span>
                  </Context.Item>
                )}
                {projects.map((project) => (
                  <Context.Item
                    key={project.id}
                    className="menu-item"
                    onSelect={() => moveTask(task, project.id)}
                  >
                    <span className="menu-icon" aria-hidden="true">
                      <ProjectRing project={project} ratio={null} />
                    </span>
                    <span className="menu-text">{project.name}</span>
                  </Context.Item>
                ))}
              </Context.SubContent>
            </Context.Portal>
          </Context.Sub>
          <Context.Separator className="menu-separator" />
          <Context.Item className="menu-item" onSelect={() => app.copyTaskLink(task.id)}>
            <Link2 aria-hidden="true" className="ui-icon menu-icon" />
            <span className="menu-text">Copy task link</span>
          </Context.Item>
          <Context.Separator className="menu-separator" />
          <Context.Item
            className="menu-item is-danger"
            onSelect={() => {
              if (app.selectedTaskId === task.id) app.setSelectedTaskId(null)
              deleteTask(task, app.setProjectNotice)
            }}
          >
            <Trash2 aria-hidden="true" className="ui-icon menu-icon" />
            <span className="menu-text">Delete</span>
            <span className="menu-shortcut">⌫</span>
          </Context.Item>
        </Context.Content>
      </Context.Portal>
    </Context.Root>
  )
}
