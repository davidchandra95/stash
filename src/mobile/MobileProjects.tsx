import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref } from 'react'
import {
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  FileText,
  Flag,
  FolderInput,
  Inbox,
  Link2,
  ListTodo,
  MoreVertical,
  Notebook as NotebookIcon,
  Pencil,
  Plus,
  Trash2,
} from '../icons'
import type { Note, Notebook } from '../model'
import { notebookColorValue } from '../notebookColors'
import ProjectRing from '../projects/ProjectRing'
import {
  createTask,
  deleteTask,
  moveTask,
  setTaskStatus,
  toggleTask,
  updateProject,
  updateTask,
  type Notify,
} from '../projects/actions'
import { findTaskMentions } from '../projects/mentions'
import {
  bySort,
  daysBetween,
  dueState,
  elapsed,
  formatDate,
  formatRange,
  groupOf,
  health,
  healthLabel,
  isOpenProject,
  priorities,
  progress,
  projectStatusLabel,
  projectStatuses,
  summarize,
  taskStatusLabel,
  taskStatuses,
  today,
  type Priority,
  type Project,
  type ProjectSummary,
  type Task,
  type TaskGroup,
} from '../projects/model'

/** The sheets a project or task screen asks the app to open. */
export type ProjectSheet =
  | { kind: 'project-actions' | 'project-status' | 'project-dates' | 'project-notebook'; id: string }
  | {
      kind: 'task-actions' | 'task-status' | 'task-priority' | 'task-project' | 'task-dates'
      id: string
    }

const liveTasks = (tasks: Task[]) => tasks.filter((t) => t.deletedAt === null)
export const projectName = (id: string | null, projects: Project[]) =>
  id === null || id === 'inbox' ? 'Inbox' : (projects.find((p) => p.id === id)?.name ?? 'Project')
/** Tasks that still need doing, for drawer and list counts. */
export const openCount = (tasks: Task[], projectId: string | null) =>
  liveTasks(tasks).filter(
    (t) => t.projectId === projectId && (t.status === 'todo' || t.status === 'doing'),
  ).length

function TaskCheck({ task, disabled }: { task: Task; disabled: boolean }) {
  const done = task.status === 'done'
  return (
    <button
      type="button"
      className={`task-check is-${task.status}`}
      role="checkbox"
      aria-checked={done}
      aria-label={done ? `Reopen “${task.title}”` : `Complete “${task.title}”`}
      disabled={disabled}
      onClick={() => toggleTask(task)}
    >
      {done && <Check aria-hidden="true" />}
    </button>
  )
}

function ProjectRow({
  row,
  onOpen,
  showCounts,
}: {
  row: ProjectSummary
  onOpen: (id: string) => void
  showCounts: boolean
}) {
  const { project } = row
  const range = formatRange(project.startDate, project.endDate)
  const detail = [
    row.progress.total ? `${row.progress.done} of ${row.progress.total} done` : 'No tasks',
    range,
    !isOpenProject(project) && projectStatusLabel(project.status),
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <button className="mobile-project-row" onClick={() => onOpen(project.id)}>
      <ProjectRing project={project} ratio={row.progress.ratio} className="is-large" />
      <span className="mobile-row-copy">
        <span className="mobile-row-title">{project.name}</span>
        <span className="mobile-row-meta">{detail}</span>
      </span>
      {row.health && row.health !== 'on_track' && (
        <span
          className={`health-dot is-${row.health}`}
          role="img"
          aria-label={healthLabel[row.health]}
        />
      )}
      {showCounts && row.open > 0 && <small className="count">{row.open}</small>}
    </button>
  )
}

export function ProjectList({
  projects,
  tasks,
  ready,
  showCounts,
  scrollRef,
  onOpen,
}: {
  projects: Project[]
  tasks: Task[]
  ready: boolean
  showCounts: boolean
  scrollRef: Ref<HTMLDivElement>
  onOpen: (id: string) => void
}) {
  const [otherOpen, setOtherOpen] = useState(false)
  const rows = summarize(projects, tasks).sort((a, b) => bySort(a.project, b.project))
  const open = rows.filter((row) => isOpenProject(row.project))
  const other = rows.filter((row) => !isOpenProject(row.project))
  const inbox = openCount(tasks, null)
  return (
    <div className="mobile-project-scroll" ref={scrollRef}>
      <button className="mobile-project-row" onClick={() => onOpen('inbox')}>
        <Inbox aria-hidden="true" />
        <span className="mobile-row-copy">
          <span className="mobile-row-title">Inbox</span>
        </span>
        {showCounts && inbox > 0 && <small className="count">{inbox}</small>}
      </button>
      {open.map((row) => (
        <ProjectRow key={row.project.id} row={row} onOpen={onOpen} showCounts={showCounts} />
      ))}
      {ready && !rows.length && (
        <div className="mobile-empty">
          <ListTodo aria-hidden="true" className="mobile-empty-icon" />
          <h2>No projects yet</h2>
          <p>Tap the plus to start one. Tasks without a project go in the Inbox.</p>
        </div>
      )}
      {other.length > 0 && (
        <>
          <button
            className="mobile-task-group"
            aria-expanded={otherOpen}
            onClick={() => setOtherOpen((value) => !value)}
          >
            {otherOpen ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
            Other projects · {other.length}
          </button>
          {otherOpen &&
            other.map((row) => (
              <ProjectRow key={row.project.id} row={row} onOpen={onOpen} showCounts={showCounts} />
            ))}
        </>
      )}
    </div>
  )
}

const groupOrder: { id: TaskGroup; label: string }[] = [
  { id: 'doing', label: 'Doing' },
  { id: 'todo', label: 'To do' },
  { id: 'done', label: 'Done' },
]

function TaskRow({
  task,
  disabled,
  onOpen,
  onActions,
}: {
  task: Task
  disabled: boolean
  onOpen: (id: string) => void
  onActions: (id: string) => void
}) {
  const priority = priorities.find((p) => p.id === task.priority)
  return (
    <div className="mobile-task-row">
      <TaskCheck task={task} disabled={disabled} />
      <button className="mobile-task-label" onClick={() => onOpen(task.id)}>
        <span className={`mobile-row-title is-${task.status}`}>{task.title}</span>
        {(task.dueDate || task.priority > 0) && (
          <span className="mobile-row-meta">
            {task.dueDate && <span className={`is-${dueState(task)}`}>{formatDate(task.dueDate)}</span>}
            {task.priority > 0 && <span>{priority?.label}</span>}
          </span>
        )}
      </button>
      <button
        className="icon-btn"
        aria-label={`Actions for ${task.title}`}
        disabled={disabled}
        onClick={() => onActions(task.id)}
      >
        <MoreVertical aria-hidden="true" />
      </button>
    </div>
  )
}

/** Return creates the task and stays in the field, ready for the next one. */
function NewTask({ projectId, disabled }: { projectId: string | null; disabled: boolean }) {
  const [title, setTitle] = useState('')
  return (
    <form
      className="new-task"
      onSubmit={(event) => {
        event.preventDefault()
        if (!title.trim()) return
        createTask(projectId, title)
        setTitle('')
      }}
    >
      <Plus aria-hidden="true" />
      <input
        className="new-task-input"
        aria-label="New task"
        placeholder="New task"
        enterKeyHint="done"
        maxLength={500}
        disabled={disabled}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />
    </form>
  )
}

function ProjectHeader({
  project,
  tasks,
  notebook,
  disabled,
  onSheet,
}: {
  project: Project
  tasks: Task[]
  notebook?: Notebook
  disabled: boolean
  onSheet: (sheet: ProjectSheet) => void
}) {
  const stats = progress(tasks)
  const state = health(project, tasks)
  const time = elapsed(project)
  const range = formatRange(project.startDate, project.endDate)
  return (
    <div className="mobile-project-head">
      <h1>{project.name}</h1>
      {project.description && <p>{project.description}</p>}
      <div className="mobile-project-pills">
        <button
          className="mobile-pill"
          disabled={disabled}
          onClick={() => onSheet({ kind: 'project-status', id: project.id })}
        >
          <span className={`status-dot is-${project.status}`} aria-hidden="true" />
          {projectStatusLabel(project.status)}
        </button>
        <button
          className="mobile-pill"
          disabled={disabled}
          onClick={() => onSheet({ kind: 'project-dates', id: project.id })}
        >
          <Calendar aria-hidden="true" />
          {range || 'Add dates'}
        </button>
        <button
          className="mobile-pill"
          disabled={disabled}
          onClick={() => onSheet({ kind: 'project-notebook', id: project.id })}
        >
          <NotebookIcon
            aria-hidden="true"
            style={notebook ? { color: notebookColorValue(notebook.color) } : undefined}
          />
          {notebook?.name ?? 'Notebook'}
        </button>
      </div>
      <div
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
        {time !== null && <b />}
      </div>
      <div className="mobile-project-progress">
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
      </div>
    </div>
  )
}

export function ProjectPage({
  id,
  projects,
  tasks,
  notebooks,
  ready,
  disabled,
  collapsed,
  scrollRef,
  onCollapsed,
  onOpenTask,
  onSheet,
}: {
  id: string
  projects: Project[]
  tasks: Task[]
  notebooks: Notebook[]
  ready: boolean
  disabled: boolean
  collapsed: TaskGroup[]
  scrollRef: Ref<HTMLDivElement>
  onCollapsed: (collapsed: TaskGroup[]) => void
  onOpenTask: (id: string) => void
  onSheet: (sheet: ProjectSheet) => void
}) {
  const inbox = id === 'inbox'
  const project = inbox ? undefined : projects.find((p) => p.id === id && p.deletedAt === null)
  if (!inbox && !project)
    return (
      <div className="mobile-empty">
        <p>{ready ? 'This project is no longer available.' : 'Opening project…'}</p>
      </div>
    )
  const projectId = project?.id ?? null
  const own = liveTasks(tasks).filter((t) => t.projectId === projectId)
  const groups = groupOrder
    .map((group) => ({
      ...group,
      tasks: own.filter((t) => groupOf(t) === group.id).sort(bySort),
    }))
    .filter((group) => group.tasks.length)
  return (
    <div className="mobile-project-scroll" ref={scrollRef}>
      {project ? (
        <ProjectHeader
          project={project}
          tasks={own}
          notebook={notebooks.find((book) => book.id === project.notebookId)}
          disabled={disabled}
          onSheet={onSheet}
        />
      ) : (
        <div className="mobile-project-head">
          <h1>Inbox</h1>
        </div>
      )}
      <NewTask projectId={projectId} disabled={disabled} />
      {groups.map((group) => {
        const closed = collapsed.includes(group.id)
        return (
          <section key={group.id} aria-label={group.label}>
            <button
              className="mobile-task-group"
              aria-expanded={!closed}
              onClick={() =>
                onCollapsed(
                  closed ? collapsed.filter((c) => c !== group.id) : [...collapsed, group.id],
                )
              }
            >
              {closed ? <ChevronRight aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
              {group.label} · {group.tasks.length}
            </button>
            {!closed &&
              group.tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  disabled={disabled}
                  onOpen={onOpenTask}
                  onActions={(taskId) => onSheet({ kind: 'task-actions', id: taskId })}
                />
              ))}
          </section>
        )
      })}
      {ready && !own.length && (
        <p className="mobile-sheet-note mobile-project-empty">No tasks yet.</p>
      )}
    </div>
  )
}

/**
 * Text fields keep a draft and save on blur. Android Back can remove a focused field without a
 * blur, and the app can be killed from the background, so leaving the screen and hiding the app
 * save as well.
 */
function useDraft(value: string, commit: (next: string) => void) {
  const [draft, setDraft] = useState(value)
  const latest = useRef({ draft, value, commit })
  latest.current = { draft, value, commit }
  useEffect(() => setDraft(value), [value])
  useEffect(() => {
    const save = () => {
      if (latest.current.draft !== latest.current.value) latest.current.commit(latest.current.draft)
    }
    const hidden = () => {
      if (document.visibilityState === 'hidden') save()
    }
    document.addEventListener('visibilitychange', hidden)
    return () => {
      document.removeEventListener('visibilitychange', hidden)
      save()
    }
  }, [])
  return {
    reset: () => setDraft(value),
    props: {
      value: draft,
      onChange: (event: { target: { value: string } }) => setDraft(event.target.value),
      onBlur: () => {
        if (draft !== value) commit(draft)
      },
    },
  }
}

/** A textarea that grows with its text. */
function useAutoHeight(value: string) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    element.style.height = '0'
    element.style.height = `${element.scrollHeight}px`
  }, [value])
  return ref
}

/** Notes that mention the task, refreshed as notes change. */
function MentionedIn({
  taskId,
  notes,
  onOpenNote,
}: {
  taskId: string
  notes: Note[]
  onOpenNote: (id: string) => void
}) {
  const [ids, setIds] = useState<string[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let current = true
    const timer = setTimeout(() => {
      findTaskMentions(taskId).then(
        (found) => {
          if (!current) return
          setIds(found)
          setError('')
        },
        (failure) => current && setError(String(failure)),
      )
    }, 300)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [taskId, notes])
  const found = (ids ?? [])
    .map((id) => notes.find((note) => note.id === id && !note.trashed))
    .filter((note) => !!note)
  return (
    <>
      <h2 className="mobile-task-heading">Mentioned in{found.length > 0 && ` · ${found.length}`}</h2>
      {error ? (
        <p role="alert" className="field-error">
          {error}
        </p>
      ) : ids && !found.length ? (
        <p className="mobile-task-hint">Type @ in a note to mention this task.</p>
      ) : (
        found.length > 0 && (
          <div className="mobile-task-props">
            {found.map((note) => (
              <button key={note.id} onClick={() => onOpenNote(note.id)}>
                <FileText aria-hidden="true" />
                <span className="mobile-prop-value">{note.title || 'Untitled note'}</span>
                <ChevronRight aria-hidden="true" className="mobile-prop-chevron" />
              </button>
            ))}
          </div>
        )
      )}
    </>
  )
}

export function TaskPage({
  id,
  projects,
  tasks,
  notes,
  ready,
  disabled,
  scrollRef,
  onOpenNote,
  onSheet,
}: {
  id: string
  projects: Project[]
  tasks: Task[]
  notes: Note[]
  ready: boolean
  disabled: boolean
  scrollRef: Ref<HTMLDivElement>
  onOpenNote: (id: string) => void
  onSheet: (sheet: ProjectSheet) => void
}) {
  const task = tasks.find((t) => t.id === id && t.deletedAt === null)
  if (!task)
    return (
      <div className="mobile-empty">
        <p>{ready ? 'This task is no longer available.' : 'Opening task…'}</p>
      </div>
    )
  return (
    <div className="mobile-project-scroll mobile-task-page" ref={scrollRef}>
      <TaskFields
        key={task.id}
        task={task}
        projects={projects}
        notes={notes}
        disabled={disabled}
        onOpenNote={onOpenNote}
        onSheet={onSheet}
      />
    </div>
  )
}

function TaskFields({
  task,
  projects,
  notes,
  disabled,
  onOpenNote,
  onSheet,
}: {
  task: Task
  projects: Project[]
  notes: Note[]
  disabled: boolean
  onOpenNote: (id: string) => void
  onSheet: (sheet: ProjectSheet) => void
}) {
  const title = useDraft(task.title, (next) =>
    next.trim() ? updateTask(task, { title: next.trim() }) : title.reset(),
  )
  const description = useDraft(task.description, (next) => updateTask(task, { description: next }))
  const titleRef = useAutoHeight(title.props.value)
  const descriptionRef = useAutoHeight(description.props.value)
  const due = dueState(task)
  const prop = (label: string, value: ReactNode, kind: ProjectSheet['kind']) => (
    <button disabled={disabled} onClick={() => onSheet({ kind, id: task.id } as ProjectSheet)}>
      <span className="mobile-prop-key">{label}</span>
      <span className="mobile-prop-value">{value}</span>
      <ChevronRight aria-hidden="true" className="mobile-prop-chevron" />
    </button>
  )
  return (
    <>
      <div className="mobile-task-title">
        <TaskCheck task={task} disabled={disabled} />
        <textarea
          ref={titleRef}
          rows={1}
          aria-label="Task title"
          maxLength={500}
          enterKeyHint="done"
          disabled={disabled}
          {...title.props}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              event.currentTarget.blur()
            }
          }}
        />
      </div>
      <div className="mobile-task-props">
        {prop(
          'Status',
          <>
            <span className={`status-dot is-${statusDot(task)}`} aria-hidden="true" />
            {taskStatusLabel(task.status)}
          </>,
          'task-status',
        )}
        {prop('Priority', priorities.find((p) => p.id === task.priority)?.label, 'task-priority')}
        {prop('Project', projectName(task.projectId, projects), 'task-project')}
        {task.startDate && prop('Start', formatDate(task.startDate), 'task-dates')}
        {prop(
          'Due',
          task.dueDate ? <span className={`is-${due}`}>{dueLabel(task)}</span> : 'None',
          'task-dates',
        )}
      </div>
      <label className="mobile-task-heading" htmlFor="mobile-task-description">
        Description
      </label>
      <textarea
        id="mobile-task-description"
        ref={descriptionRef}
        className="field mobile-task-description"
        placeholder="Add details"
        maxLength={10_000}
        disabled={disabled}
        {...description.props}
      />
      <MentionedIn taskId={task.id} notes={notes} onOpenNote={onOpenNote} />
    </>
  )
}
const statusDot = (task: Task) =>
  task.status === 'doing' ? 'active' : task.status === 'todo' ? 'planned' : task.status
function dueLabel(task: Task) {
  const days = daysBetween(today(), task.dueDate!)
  const when =
    days === 0
      ? 'today'
      : days === 1
        ? 'tomorrow'
        : days > 0
          ? `in ${days} days`
          : `${-days} ${days === -1 ? 'day' : 'days'} late`
  return task.status === 'done' || task.status === 'cancelled'
    ? formatDate(task.dueDate!)
    : `${formatDate(task.dueDate!)} · ${when}`
}

function Choice({
  selected,
  disabled,
  onClick,
  children,
}: {
  selected: boolean
  disabled: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      aria-pressed={selected}
      className="mobile-choice"
      disabled={disabled}
      onClick={onClick}
    >
      {children}
      {selected && <Check aria-hidden="true" className="mobile-choice-check" />}
    </button>
  )
}

function DateFields({
  fields,
  disabled,
  error,
}: {
  fields: { label: string; value: string | null; set: (value: string | null) => void }[]
  disabled: boolean
  error?: string
}) {
  return (
    <div className="mobile-date-fields">
      {fields.map((field) => (
        <div key={field.label}>
          <span>{field.label}</span>
          <input
            type="date"
            className="field"
            aria-label={`${field.label} date`}
            disabled={disabled}
            value={field.value ?? ''}
            onChange={(event) => field.set(event.target.value || null)}
          />
          <button
            type="button"
            className="btn btn-plain btn-sm"
            disabled={disabled || !field.value}
            aria-label={`Clear ${field.label.toLocaleLowerCase()} date`}
            onClick={() => field.set(null)}
          >
            Clear
          </button>
        </div>
      ))}
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
    </div>
  )
}

function ProjectDates({ project, disabled }: { project: Project; disabled: boolean }) {
  const [start, setStart] = useState(project.startDate)
  const [end, setEnd] = useState(project.endDate)
  const invalid = !!start && !!end && end < start
  useEffect(() => {
    if (!invalid && (start !== project.startDate || end !== project.endDate))
      updateProject(project, { startDate: start, endDate: end })
  }, [start, end, invalid])
  return (
    <DateFields
      disabled={disabled}
      error={invalid ? 'The end date is before the start date.' : undefined}
      fields={[
        { label: 'Start', value: start, set: setStart },
        { label: 'End', value: end, set: setEnd },
      ]}
    />
  )
}

export const projectSheetTitle = (sheet: ProjectSheet, project?: Project, task?: Task) =>
  ({
    'project-actions': project?.name ?? 'Project',
    'project-status': 'Project status',
    'project-dates': 'Project dates',
    'project-notebook': 'Notebook',
    'task-actions': task?.title ?? 'Task',
    'task-status': 'Status',
    'task-priority': 'Priority',
    'task-project': 'Move to project',
    'task-dates': 'Dates',
  })[sheet.kind]

/** The contents of a project or task bottom sheet. */
export function ProjectSheetBody({
  sheet,
  projects,
  tasks,
  notebooks,
  disabled,
  notify,
  onSheet,
  onClose,
  onEditProject,
  onDeleteProject,
  onOpenNotebook,
  onCopyTaskLink,
  onDeletedTask,
}: {
  sheet: ProjectSheet
  projects: Project[]
  tasks: Task[]
  notebooks: Notebook[]
  disabled: boolean
  notify: Notify
  onSheet: (sheet: ProjectSheet) => void
  onClose: () => void
  onEditProject: (project: Project) => void
  onDeleteProject: (project: Project) => void
  onOpenNotebook: (id: string) => void
  onCopyTaskLink: (id: string) => void
  onDeletedTask: (id: string) => void
}) {
  if (sheet.kind.startsWith('project-')) {
    const project = projects.find((p) => p.id === sheet.id && p.deletedAt === null)
    if (!project) return <p className="mobile-sheet-note">This project is no longer available.</p>
    const notebook = notebooks.find((book) => book.id === project.notebookId)
    switch (sheet.kind) {
      case 'project-actions':
        return (
          <>
            <button disabled={disabled} onClick={() => onEditProject(project)}>
              <Pencil aria-hidden="true" />
              Edit project
            </button>
            <button
              disabled={disabled}
              onClick={() => onSheet({ kind: 'project-status', id: project.id })}
            >
              <CircleCheck aria-hidden="true" />
              Status
            </button>
            <button
              disabled={disabled}
              onClick={() => onSheet({ kind: 'project-dates', id: project.id })}
            >
              <Calendar aria-hidden="true" />
              Dates
            </button>
            <button
              disabled={disabled}
              onClick={() => onSheet({ kind: 'project-notebook', id: project.id })}
            >
              <NotebookIcon aria-hidden="true" />
              Notebook
            </button>
            <button className="danger" disabled={disabled} onClick={() => onDeleteProject(project)}>
              <Trash2 aria-hidden="true" />
              Delete project
            </button>
          </>
        )
      case 'project-status':
        return (
          <>
            {projectStatuses.map((status) => (
              <Choice
                key={status.id}
                selected={project.status === status.id}
                disabled={disabled}
                onClick={() => {
                  updateProject(project, { status: status.id })
                  onClose()
                }}
              >
                <span className={`status-dot is-${status.id}`} aria-hidden="true" />
                {status.label}
              </Choice>
            ))}
          </>
        )
      case 'project-dates':
        return <ProjectDates project={project} disabled={disabled} />
      case 'project-notebook':
        return (
          <>
            {notebook && (
              <button disabled={disabled} onClick={() => onOpenNotebook(notebook.id)}>
                <NotebookIcon aria-hidden="true" />
                Open {notebook.name}
              </button>
            )}
            <Choice
              selected={!project.notebookId}
              disabled={disabled}
              onClick={() => {
                updateProject(project, { notebookId: null })
                onClose()
              }}
            >
              No notebook
            </Choice>
            {notebooks.map((book) => (
              <Choice
                key={book.id}
                selected={project.notebookId === book.id}
                disabled={disabled}
                onClick={() => {
                  updateProject(project, { notebookId: book.id })
                  onClose()
                }}
              >
                {book.name}
              </Choice>
            ))}
          </>
        )
    }
  }
  const task = tasks.find((t) => t.id === sheet.id && t.deletedAt === null)
  if (!task) return <p className="mobile-sheet-note">This task is no longer available.</p>
  switch (sheet.kind) {
    case 'task-actions':
      return (
        <>
          <button
            disabled={disabled}
            onClick={() => {
              toggleTask(task)
              onClose()
            }}
          >
            <CircleCheck aria-hidden="true" />
            {task.status === 'done' ? 'Reopen' : 'Complete'}
          </button>
          <button disabled={disabled} onClick={() => onSheet({ kind: 'task-status', id: task.id })}>
            <ListTodo aria-hidden="true" />
            Status
          </button>
          <button
            disabled={disabled}
            onClick={() => onSheet({ kind: 'task-priority', id: task.id })}
          >
            <Flag aria-hidden="true" />
            Priority
          </button>
          <button disabled={disabled} onClick={() => onSheet({ kind: 'task-dates', id: task.id })}>
            <Calendar aria-hidden="true" />
            Dates
          </button>
          <button
            disabled={disabled}
            onClick={() => onSheet({ kind: 'task-project', id: task.id })}
          >
            <FolderInput aria-hidden="true" />
            Move to project
          </button>
          <button
            disabled={disabled}
            onClick={() => {
              onCopyTaskLink(task.id)
              onClose()
            }}
          >
            <Link2 aria-hidden="true" />
            Copy task link
          </button>
          <button
            className="danger"
            disabled={disabled}
            onClick={() => {
              deleteTask(task, notify)
              onClose()
              onDeletedTask(task.id)
            }}
          >
            <Trash2 aria-hidden="true" />
            Delete task
          </button>
        </>
      )
    case 'task-status':
      return (
        <>
          {taskStatuses.map((status) => (
            <Choice
              key={status.id}
              selected={task.status === status.id}
              disabled={disabled}
              onClick={() => {
                setTaskStatus(task, status.id)
                onClose()
              }}
            >
              {status.label}
            </Choice>
          ))}
        </>
      )
    case 'task-priority':
      return (
        <>
          {priorities.map((priority) => (
            <Choice
              key={priority.id}
              selected={task.priority === priority.id}
              disabled={disabled}
              onClick={() => {
                updateTask(task, { priority: priority.id as Priority })
                onClose()
              }}
            >
              {priority.label}
            </Choice>
          ))}
        </>
      )
    case 'task-project':
      return (
        <>
          <Choice
            selected={task.projectId === null}
            disabled={disabled}
            onClick={() => {
              if (task.projectId !== null) moveTask(task, null)
              onClose()
            }}
          >
            Inbox
          </Choice>
          {projects
            .filter((p) => p.deletedAt === null)
            .sort(bySort)
            .map((project) => (
              <Choice
                key={project.id}
                selected={task.projectId === project.id}
                disabled={disabled}
                onClick={() => {
                  if (task.projectId !== project.id) moveTask(task, project.id)
                  onClose()
                }}
              >
                {project.name}
              </Choice>
            ))}
        </>
      )
    case 'task-dates':
      return (
        <DateFields
          disabled={disabled}
          fields={[
            {
              label: 'Due',
              value: task.dueDate,
              set: (dueDate) => updateTask(task, { dueDate }),
            },
            {
              label: 'Start',
              value: task.startDate,
              set: (startDate) => updateTask(task, { startDate }),
            },
          ]}
        />
      )
  }
  return null
}
