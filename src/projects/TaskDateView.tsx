import { useRef, useState, type KeyboardEvent } from 'react'
import { useApp, useBlocked } from '../app/context'
import { Calendar, CalendarClock, Plus } from '../icons'
import AppTooltip from '../components/AppTooltip'
import ProjectRing from './ProjectRing'
import { PriorityBars, TaskCheckbox, TaskMenu } from './ProjectPane'
import { createTask, deleteTask, toggleTask } from './actions'
import {
  dueState,
  formatDate,
  priorities,
  today,
  todayGroups,
  upcomingGroups,
  type Task,
} from './model'

export type DateView = 'tasks:today' | 'tasks:upcoming'
export const isDateView = (view: string | null): view is DateView =>
  view === 'tasks:today' || view === 'tasks:upcoming'

/** Tasks from every project and the Inbox, grouped by when they're due. */
export default function TaskDateView({ view }: { view: DateView }) {
  const app = useApp()
  const blocked = useBlocked()
  const [draft, setDraft] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const current = today()
  const isToday = view === 'tasks:today'
  const groups = isToday
    ? todayGroups(app.projects.tasks, current)
    : upcomingGroups(app.projects.tasks, current)
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
          {isToday ? <Calendar aria-hidden="true" /> : <CalendarClock aria-hidden="true" />}
          <h1>{isToday ? 'Due today' : 'Upcoming'}</h1>
        </div>
        <p className="project-description">
          {isToday
            ? `${formatDate(current, current)} · Overdue and due-today tasks from every project.`
            : 'Open tasks with a due date after today, from every project.'}
        </p>
      </header>
      <div className="task-scroll">
        {isToday && (
          <form
            className="new-task"
            onSubmit={(event) => {
              event.preventDefault()
              if (!draft.trim()) return
              createTask(null, draft, { dueDate: current })
              setDraft('')
            }}
          >
            <Plus aria-hidden="true" />
            <input
              className="new-task-input"
              aria-label="New task due today"
              placeholder="New task due today"
              value={draft}
              maxLength={500}
              disabled={blocked}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setDraft('')
              }}
            />
            {draft && <kbd aria-hidden="true">↵</kbd>}
          </form>
        )}
        <div className="task-list" ref={listRef} role="listbox" aria-label="Tasks">
          {groups.map((group) => (
            <div role="group" aria-label={group.label} key={group.id} className="task-group">
              <div className={`task-group-header is-static ${group.id === 'overdue' ? 'is-late' : ''}`}>
                {group.label}
                <span className="count">{group.tasks.length}</span>
              </div>
              {group.tasks.map((task, position) => {
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
                        {(group.id === 'overdue' || !isToday) && task.dueDate && (
                          <span className={`task-due is-${due}`}>
                            <Calendar aria-hidden="true" />
                            {formatDate(task.dueDate, current)}
                          </span>
                        )}
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
            <p className="task-empty">
              {isToday ? 'Nothing due today.' : 'No upcoming due dates.'}
            </p>
          )}
        </div>
      </div>
    </>
  )
}
