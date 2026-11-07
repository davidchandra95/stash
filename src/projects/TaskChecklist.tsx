import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import AppTooltip from '../components/AppTooltip'
import { Check, ListChecks, X } from '../icons'
import { editChecklist } from './actions'
import {
  checklistProgress,
  checklistTitle,
  insertItem,
  maxChecklistItems,
  maxChecklistTitle,
  moveItem,
  removeItem,
  updateItem,
  type ChecklistItem,
} from './checklist'
import { newId } from './store'
import type { Task } from './model'

/** "2/5" with a checklist icon on task rows and board cards; nothing when there are no subtasks. */
export function SubtaskMark({ task }: { task: Pick<Task, 'checklist'> }) {
  const { done, total } = checklistProgress(task)
  if (!total) return null
  const label = `${done} of ${total} subtasks done`
  return (
    <AppTooltip label={label}>
      <span className={`task-due task-subtasks ${done === total ? 'is-complete' : ''}`} role="img" aria-label={label}>
        <ListChecks aria-hidden="true" />
        {done}/{total}
      </span>
    </AppTooltip>
  )
}

/**
 * Subtasks in the task inspector. Titles save on blur or Return; clearing one removes it.
 * Return in the add field keeps it open for the next one, and pasting several lines adds one
 * subtask per line. Option+Up/Down reorders.
 */
export default function TaskChecklist({
  task,
  disabled,
  headingClassName = 'task-detail-heading',
}: {
  task: Task
  disabled: boolean
  /** Android passes its own heading style. */
  headingClassName?: string
}) {
  const list = task.checklist ?? []
  const { done, total } = checklistProgress(task)
  const listRef = useRef<HTMLUListElement>(null)
  const addRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState('')
  const [focus, setFocus] = useState<{ id: string } | null>(null)
  const full = list.length >= maxChecklistItems
  useEffect(() => setDraft(''), [task.id])
  useEffect(() => {
    if (!focus) return
    listRef.current?.querySelector<HTMLInputElement>(`[data-item-id="${focus.id}"]`)?.focus()
    setFocus(null)
  }, [focus, list])

  const add = (titles: string[]) => {
    const items = titles.map(checklistTitle).filter(Boolean)
    if (!items.length) return
    editChecklist(task, (current) =>
      items.reduce((next, title) => insertItem(next, { id: newId(), title, done: false }), current),
    )
  }

  return (
    <>
      <h3 className={headingClassName} id={`subtasks-${task.id}`}>
        Subtasks{' '}
        {total > 0 && (
          <span className="count" aria-label={`${done} of ${total} done`}>
            {done}/{total}
          </span>
        )}
      </h3>
      <ul className="subtasks" ref={listRef} aria-labelledby={`subtasks-${task.id}`}>
        {list.map((item, index) => (
          <Subtask
            key={item.id}
            item={item}
            disabled={disabled}
            onToggle={() => editChecklist(task, (current) => updateItem(current, item.id, { done: !item.done }))}
            onRename={(title) =>
              editChecklist(task, (current) =>
                checklistTitle(title) ? updateItem(current, item.id, { title }) : removeItem(current, item.id),
              )
            }
            onRemove={(refocus) => {
              editChecklist(task, (current) => removeItem(current, item.id))
              if (!refocus) return
              const neighbour = list[index - 1] ?? list[index + 1]
              if (neighbour) setFocus({ id: neighbour.id })
              else addRef.current?.focus()
            }}
            onMove={(delta) => {
              editChecklist(task, (current) => moveItem(current, item.id, delta))
              setFocus({ id: item.id })
            }}
            onNext={() => addRef.current?.focus()}
          />
        ))}
      </ul>
      <input
        ref={addRef}
        className="field subtask-add"
        aria-label="Add subtask"
        placeholder={full ? 'This task has 100 subtasks' : 'Add subtask'}
        maxLength={maxChecklistTitle}
        disabled={disabled || full}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onPaste={(event: ClipboardEvent<HTMLInputElement>) => {
          const text = event.clipboardData.getData('text/plain')
          if (!/[\r\n]/.test(text)) return
          event.preventDefault()
          add((draft + text).split(/\r?\n|\r/))
          setDraft('')
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault()
            add([draft])
            setDraft('')
          } else if (event.key === 'Escape' && draft) {
            event.stopPropagation()
            setDraft('')
          }
        }}
        onBlur={() => {
          add([draft])
          setDraft('')
        }}
      />
    </>
  )
}

function Subtask({
  item,
  disabled,
  onToggle,
  onRename,
  onRemove,
  onMove,
  onNext,
}: {
  item: ChecklistItem
  disabled: boolean
  onToggle: () => void
  onRename: (title: string) => void
  onRemove: (refocus: boolean) => void
  onMove: (delta: -1 | 1) => void
  onNext: () => void
}) {
  const [draft, setDraft] = useState(item.title)
  useEffect(() => setDraft(item.title), [item.title])
  const commit = () => {
    if (draft !== item.title) onRename(draft)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Enter') {
      event.preventDefault()
      commit()
      onNext()
    } else if (event.key === 'Escape' && draft !== item.title) {
      event.stopPropagation()
      setDraft(item.title)
    } else if (event.key === 'Backspace' && !draft) {
      event.preventDefault()
      onRemove(true)
    } else if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault()
      commit()
      onMove(event.key === 'ArrowUp' ? -1 : 1)
    }
  }
  return (
    <li className={`subtask ${item.done ? 'is-done' : ''}`}>
      <button
        type="button"
        role="checkbox"
        className={`task-check subtask-check ${item.done ? 'is-done' : ''}`}
        aria-checked={item.done}
        aria-label={item.done ? `Reopen subtask “${item.title}”` : `Complete subtask “${item.title}”`}
        disabled={disabled}
        onClick={onToggle}
      >
        {item.done && <Check aria-hidden="true" />}
      </button>
      <input
        className="subtask-title"
        aria-label="Subtask"
        data-item-id={item.id}
        maxLength={maxChecklistTitle}
        disabled={disabled}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
      <AppTooltip instant label="Remove subtask" disabled={disabled}>
        <button
          type="button"
          className="icon-btn icon-btn-sm subtask-remove"
          aria-label={`Remove subtask “${item.title}”`}
          disabled={disabled}
          onClick={() => onRemove(false)}
        >
          <X aria-hidden="true" />
        </button>
      </AppTooltip>
    </li>
  )
}
