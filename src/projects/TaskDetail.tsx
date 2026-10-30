import { useEffect, useState } from 'react'
import AppTooltip from '../components/AppTooltip'
import { useApp, useBlocked } from '../app/context'
import { FileText, Trash2, X } from '../icons'
import { findTaskMentions } from './mentions'
import { TaskCheckbox } from './ProjectPane'
import { deleteTask, moveTask, setTaskStatus, updateTask } from './actions'
import { dueState, priorities, taskStatuses, type Priority, type Task } from './model'

const stamp = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' })
function when(timestamp: number) {
  const date = new Date(timestamp)
  return new Date().toDateString() === date.toDateString()
    ? `today at ${time.format(date)}`
    : stamp.format(date)
}

/** Text fields keep a draft and save on blur or Return; everything else saves at once. */
function useDraft(value: string, commit: (next: string) => void) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const reset = () => setDraft(value)
  const props = {
    value: draft,
    onChange: (event: { target: { value: string } }) => setDraft(event.target.value),
    onBlur: () => {
      if (draft !== value) commit(draft)
    },
  }
  return { props, reset }
}

/** Notes that mention the task, refreshed as notes change. */
function MentionedIn({ taskId }: { taskId: string }) {
  const app = useApp()
  const notes = app.notes
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
  useEffect(() => setIds(null), [taskId])
  const found = (ids ?? [])
    .map((id) => notes.find((note) => note.id === id && !note.trashed))
    .filter((note) => !!note)
  return (
    <>
      <h3 className="task-detail-heading">
        Mentioned in {found.length > 0 && <span className="count">{found.length}</span>}
      </h3>
      {error ? (
        <p role="alert" className="field-error">
          {error}
        </p>
      ) : ids && !found.length ? (
        <p className="task-mentions-empty">Type @ in a note to mention this task.</p>
      ) : (
        <ul className="task-mentions">
          {found.map((note) => (
            <li key={note.id}>
              <button
                className="task-mention-row"
                onClick={() => app.workspace.open(note.id, false, { view: 'all', query: '' })}
              >
                <FileText aria-hidden="true" />
                <span className="truncate">{note.title || 'Untitled note'}</span>
                <span className="task-mention-notebook">{app.notebookLabel(note)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

export default function TaskDetail({ task }: { task: Task }) {
  const app = useApp()
  const blocked = useBlocked()
  const title = useDraft(task.title, (next) =>
    next.trim() ? updateTask(task, { title: next.trim() }) : title.reset(),
  )
  const description = useDraft(task.description, (next) => updateTask(task, { description: next }))
  const projects = app.projects.projects.filter(
    (p) => p.deletedAt === null || p.id === task.projectId,
  )
  const due = dueState(task)
  const date = (field: 'startDate' | 'dueDate', label: string) => (
    <>
      <label htmlFor={`task-${field}`}>{label}</label>
      <input
        id={`task-${field}`}
        type="date"
        className={`field task-date ${field === 'dueDate' ? `is-${due}` : ''}`}
        value={task[field] ?? ''}
        disabled={blocked}
        onChange={(event) => updateTask(task, { [field]: event.target.value || null })}
      />
    </>
  )
  return (
    <aside className="task-detail" aria-label="Task details" data-pane="task">
      <div className="pane-bar" data-tauri-drag-region>
        <span className="task-detail-label">Task</span>
        <span className="pane-spacer" data-tauri-drag-region />
        <AppTooltip instant label="Delete task" disabled={blocked}>
          <button
            className="icon-btn"
            aria-label="Delete task"
            disabled={blocked}
            onClick={() => {
              app.setSelectedTaskId(null)
              deleteTask(task, app.setProjectNotice)
            }}
          >
            <Trash2 aria-hidden="true" />
          </button>
        </AppTooltip>
        <AppTooltip instant label="Close" shortcut="Esc">
          <button
            className="icon-btn"
            aria-label="Close task details"
            onClick={() => app.setSelectedTaskId(null)}
          >
            <X aria-hidden="true" />
          </button>
        </AppTooltip>
      </div>
      <div
        className="task-detail-body"
        onKeyDown={(event) => {
          if (event.key === 'Escape') app.setSelectedTaskId(null)
        }}
      >
        <div className="task-detail-title">
          <TaskCheckbox task={task} disabled={blocked} />
          <textarea
            className="task-title-input"
            aria-label="Task title"
            rows={1}
            maxLength={500}
            disabled={blocked}
            {...title.props}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                event.currentTarget.blur()
              }
              if (event.key === 'Escape') title.reset()
            }}
          />
        </div>
        <div className="task-props">
          <label htmlFor="task-status">Status</label>
          <select
            id="task-status"
            className="field"
            value={task.status}
            disabled={blocked}
            onChange={(event) => setTaskStatus(task, event.target.value as Task['status'])}
          >
            {taskStatuses.map((status) => (
              <option key={status.id} value={status.id}>
                {status.label}
              </option>
            ))}
          </select>
          <label htmlFor="task-priority">Priority</label>
          <select
            id="task-priority"
            className="field"
            value={task.priority}
            disabled={blocked}
            onChange={(event) =>
              updateTask(task, { priority: Number(event.target.value) as Priority })
            }
          >
            {priorities.map((priority) => (
              <option key={priority.id} value={priority.id}>
                {priority.label}
              </option>
            ))}
          </select>
          <label htmlFor="task-project">Project</label>
          <select
            id="task-project"
            className="field"
            value={task.projectId ?? ''}
            disabled={blocked}
            onChange={(event) => moveTask(task, event.target.value || null)}
          >
            <option value="">Inbox</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          {date('startDate', 'Start')}
          {date('dueDate', 'Due')}
        </div>
        <label className="task-detail-heading" htmlFor="task-description">
          Description
        </label>
        <textarea
          id="task-description"
          className="field task-description"
          placeholder="Add details"
          maxLength={10_000}
          disabled={blocked}
          {...description.props}
        />
        <MentionedIn taskId={task.id} />
      </div>
      <div className="task-detail-footer">
        Created {when(task.created)} · Edited {when(task.updated)}
      </div>
    </aside>
  )
}
