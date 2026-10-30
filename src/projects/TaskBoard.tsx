import { useEffect, useRef, useState } from 'react'
import { useApp } from '../app/context'
import { Calendar } from '../icons'
import { PriorityBars, TaskCheckbox, TaskMenu } from './ProjectPane'
import { deleteTask, toggleTask, updateTask } from './actions'
import {
  boardColumns,
  dueState,
  formatDate,
  groupOf,
  sortBetween,
  type Task,
  type TaskGroup,
} from './model'

type Drag = { id: string; startX: number; startY: number; active: boolean }
type Target = { column: TaskGroup; index: number }

/** Columns by status. Dragging a card moves it within or between columns. */
export default function TaskBoard({ tasks, disabled }: { tasks: Task[]; disabled: boolean }) {
  const app = useApp()
  const [drag, setDrag] = useState<Drag | null>(null)
  const [target, setTarget] = useState<Target | null>(null)
  const boardRef = useRef<HTMLDivElement>(null)
  const suppressClick = useRef(false)
  const column = (id: TaskGroup) => tasks.filter((t) => groupOf(t) === id)

  useEffect(() => {
    if (!drag) return
    const move = (event: PointerEvent) => {
      if (!drag.active && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6)
        return
      if (!drag.active) setDrag((old) => old && { ...old, active: true })
      const columns = [...(boardRef.current?.querySelectorAll<HTMLElement>('[data-column]') ?? [])]
      const over =
        columns.find((el) => {
          const rect = el.getBoundingClientRect()
          return event.clientX >= rect.left && event.clientX <= rect.right
        }) ?? null
      if (!over) return setTarget(null)
      const cards = [...over.querySelectorAll<HTMLElement>('[data-task-id]')].filter(
        (card) => card.dataset.taskId !== drag.id,
      )
      const index = cards.filter((card) => {
        const rect = card.getBoundingClientRect()
        return event.clientY > rect.top + rect.height / 2
      }).length
      setTarget({ column: over.dataset.column as TaskGroup, index })
    }
    const up = () => {
      const task = tasks.find((t) => t.id === drag.id)
      if (drag.active && target && task) {
        suppressClick.current = true
        const siblings = column(target.column).filter((t) => t.id !== task.id)
        const status =
          target.column === groupOf(task)
            ? task.status
            : boardColumns.find((c) => c.id === target.column)!.status
        updateTask(task, {
          status,
          sort: sortBetween(siblings[target.index - 1]?.sort, siblings[target.index]?.sort),
        })
      }
      setDrag(null)
      setTarget(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [drag, target, tasks])

  return (
    <div className="task-board" ref={boardRef}>
      {boardColumns.map(({ id, label }) => {
        const cards = column(id)
        const others = cards.filter((t) => t.id !== drag?.id)
        const dropAt = drag?.active && target?.column === id ? target.index : -1
        return (
          <section
            key={id}
            className={`board-column ${dropAt >= 0 ? 'is-target' : ''}`}
            data-column={id}
            aria-label={label}
          >
            <h2 className="board-column-header">
              {label}
              <span className="count">{cards.length}</span>
            </h2>
            <div className="board-cards" role="list">
              {cards.map((task) => {
                const due = dueState(task)
                const before = dropAt >= 0 && others.indexOf(task) === dropAt
                return (
                  <TaskMenu key={task.id} task={task} disabled={disabled}>
                    <div
                      role="listitem"
                      tabIndex={0}
                      data-task-id={task.id}
                      className={[
                        'board-card',
                        app.selectedTaskId === task.id && 'is-selected',
                        drag?.active && drag.id === task.id && 'is-dragging',
                        before && 'drop-before',
                      ]
                        .filter(Boolean)
                        .join(' ')}
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
                          startX: event.clientX,
                          startY: event.clientY,
                          active: false,
                        })
                      }}
                      onKeyDown={(event) => {
                        if (event.key === ' ') {
                          event.preventDefault()
                          toggleTask(task)
                        } else if (event.key === 'Enter') app.setSelectedTaskId(task.id)
                        else if (event.key === 'Escape') app.setSelectedTaskId(null)
                        else if (event.key === 'Backspace' || event.key === 'Delete') {
                          event.preventDefault()
                          if (app.selectedTaskId === task.id) app.setSelectedTaskId(null)
                          deleteTask(task, app.setProjectNotice)
                        }
                      }}
                    >
                      <div className="board-card-title">
                        <TaskCheckbox task={task} disabled={disabled} />
                        <span
                          className={`task-title ${task.status === 'cancelled' ? 'is-cancelled' : ''}`}
                        >
                          {task.title}
                        </span>
                      </div>
                      {(task.dueDate || task.priority > 0) && (
                        <div className="task-meta board-card-meta">
                          {task.dueDate && (
                            <span className={`task-due is-${due}`}>
                              <Calendar aria-hidden="true" />
                              {formatDate(task.dueDate)}
                            </span>
                          )}
                          {task.priority > 0 && <PriorityBars priority={task.priority} />}
                        </div>
                      )}
                    </div>
                  </TaskMenu>
                )
              })}
              {dropAt >= 0 && dropAt === others.length && <div className="drop-end" />}
              {!cards.length && dropAt < 0 && <p className="board-empty">No tasks</p>}
            </div>
          </section>
        )
      })}
    </div>
  )
}
