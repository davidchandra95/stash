import { effectiveDueDate } from './schedule'
import { ReminderMark } from './TaskReminders'
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useApp, useBlocked } from '../app/context'
import { Calendar, CalendarClock, CircleCheck, FileText, Hash, Trash2 } from '../icons'
import { TaskTagChips } from './TaskTags'
import AppTooltip from '../components/AppTooltip'
import ProjectRing from './ProjectRing'
import { PriorityBars, TaskCheckbox, TaskMenu } from './ProjectPane'
import { RepeatMark } from './RepeatEditor'
import { deleteTask, restoreTask, toggleTask } from './actions'
import NewTask from './NewTask'
import {
  dueState,
  formatDate,
  formatTaskTiming,
  priorities,
  taskViewGroups,
  taskViewMeta,
  taskViews,
  today,
  type SummaryPeriod,
  type Task,
  type TaskListView,
  type TaskView,
} from './model'

export type DateView = `tasks:${TaskView}` | `tag:${string}`
export const taskViewOf = (view: DateView): TaskListView =>
  view.startsWith('tasks:') ? (view.slice('tasks:'.length) as TaskView) : (view as `tag:${string}`)
export const isDateView = (view: string | null): view is DateView =>
  !!view?.startsWith('tag:') ||
  (!!view?.startsWith('tasks:') && view.slice('tasks:'.length) in taskViews)

const viewIcons: Record<TaskView, ReactNode> = {
  today: <Calendar aria-hidden="true" />,
  next7: <CalendarClock aria-hidden="true" />,
  summary: <FileText aria-hidden="true" />,
  completed: <CircleCheck aria-hidden="true" />,
  trash: <Trash2 aria-hidden="true" />,
}

/** The smart lists: tasks from every project and the Inbox, grouped by when they matter. */
export default function TaskDateView({ view }: { view: DateView }) {
  const app = useApp()
  const blocked = useBlocked()
  const listRef = useRef<HTMLDivElement>(null)
  const current = today()
  const [period, setPeriod] = useState<SummaryPeriod>(7)
  const name = taskViewOf(view)
  const meta = taskViewMeta(name)
  const tag = name.startsWith('tag:') ? name.slice(4) : null
  const isToday = name === 'today'
  const groups = taskViewGroups(name, app.projects.tasks, period, current)
  const visible = groups.flatMap((group) => group.tasks)
  const projects = new Map(
    app.projects.projects.filter((p) => p.deletedAt === null).map((p) => [p.id, p]),
  )
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
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      select(visible[index + (event.key === 'ArrowUp' ? -1 : 1)])
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

  return (
    <>
      <header className="project-header">
        <div className="project-title">
          {tag ? <Hash aria-hidden="true" /> : viewIcons[name as TaskView]}
          <h1>{tag ?? meta.label}</h1>
          {name === 'summary' && (
            <div className="project-actions">
              <div className="segmented" role="group" aria-label="Summary period">
                <button aria-pressed={period === 7} onClick={() => setPeriod(7)}>
                  Last 7 days
                </button>
                <button aria-pressed={period === 30} onClick={() => setPeriod(30)}>
                  Last 30 days
                </button>
              </div>
            </div>
          )}
        </div>
        <p className="project-description">
          {isToday ? `${formatDate(current, current)} · ${meta.description}` : meta.description}
        </p>
      </header>
      <div className="task-scroll">
        {(isToday || name === 'next7') && <NewTask projectId={null} disabled={blocked} dueToday />}
        {tag && <NewTask key={tag} projectId={null} disabled={blocked} tags={[tag]} />}
        <div className="task-list" ref={listRef} role="listbox" aria-label="Tasks">
          {groups.map((group) => (
            <div role="group" aria-label={group.label} key={group.id} className="task-group">
              <div className={`task-group-header is-static ${group.id === 'overdue' ? 'is-late' : ''}`}>
                {group.label}
                <span className="count">{group.tasks.length}</span>
              </div>
              {group.tasks.map((task, position) => {
                if (name === 'trash')
                  return (
                    <div className="task-row" role="option" aria-selected={false} key={task.id}>
                      <span className="task-title">{task.title}</span>
                      <span className="task-meta">
                        <span className="task-project">
                          {(task.projectId && projects.get(task.projectId)?.name) || 'Inbox'}
                        </span>
                        <button
                          className="btn btn-sm"
                          disabled={blocked}
                          onClick={() => restoreTask(task)}
                        >
                          Restore
                        </button>
                      </span>
                    </div>
                  )
                const project = task.projectId ? projects.get(task.projectId) : undefined
                const due = dueState(task, current)
                return (
                  <TaskMenu key={task.id} task={task} disabled={blocked}>
                    <div
                      className={`task-row ${selectedId === task.id ? 'is-selected' : ''}`}
                      role="option"
                      aria-selected={selectedId === task.id}
                      tabIndex={
                        selectedId === task.id || (!selectedId && position === 0 && group === groups[0])
                          ? 0
                          : -1
                      }
                      data-task-id={task.id}
                      onClick={() => app.setSelectedTaskId(task.id)}
                      onKeyDown={(event) => onKeyDown(event, task)}
                    >
                      <TaskCheckbox task={task} disabled={blocked} />
                      <span className="task-title">{task.title}</span>
                      <span className="task-meta">
                        {(group.id === 'overdue' || !isToday || task.dueTime || task.schedule) && (effectiveDueDate(task) || task.schedule) && (
                          <span className={`task-due is-${due}`}>
                            <Calendar aria-hidden="true" />
                            {formatTaskTiming(task, current)}
                            <ReminderMark task={task} />
                          </span>
                        )}
                        {task.repeat && <RepeatMark repeat={task.repeat} />}
                        <TaskTagChips task={task} />
                        {task.priority > 0 && (
                          <AppTooltip label={`${priorities[task.priority].label} priority`}>
                            <span className="task-priority">
                              <PriorityBars priority={task.priority} />
                            </span>
                          </AppTooltip>
                        )}
                        <span className="task-project">
                          {project ? (
                            <>
                              <ProjectRing project={project} ratio={null} />
                              {project.name}
                            </>
                          ) : (
                            'Inbox'
                          )}
                        </span>
                      </span>
                    </div>
                  </TaskMenu>
                )
              })}
            </div>
          ))}
          {!groups.length && (
            <p className="task-empty">{meta.empty}</p>
          )}
        </div>
      </div>
    </>
  )
}
