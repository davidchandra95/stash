import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { tagTone } from '../tags'
import {
  blankFilter,
  filterDates,
  filterStatuses,
  matchesFilter,
  maxFilterName,
  type TaskFilter,
} from './filters'
import { newId } from './store'
import { priorities, taskTags, type Priority, type Project, type Task } from './model'

/** Toggles one option of a filter condition. */
const toggle = <T,>(list: T[], value: T) =>
  list.includes(value) ? list.filter((item) => item !== value) : [...list, value]

/** Creates a filter, or edits one when `filter` is given. */
export default function FilterDialog({
  open,
  filter,
  projects,
  tasks,
  onClose,
  onSave,
}: {
  open: boolean
  filter?: TaskFilter
  projects: Project[]
  tasks: Task[]
  onClose: () => void
  onSave: (filter: TaskFilter, created: boolean) => void
}) {
  const [fields, setFields] = useState<TaskFilter>(() => blankFilter(newId()))
  const [error, setError] = useState('')
  const nameInput = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!open) return
    setFields(filter ? { ...filter } : blankFilter(newId()))
    setError('')
  }, [open, filter?.id])
  const set = (patch: Partial<TaskFilter>) => setFields((old) => ({ ...old, ...patch }))

  const live = projects.filter((p) => p.deletedAt === null)
  // Keep a deleted project or retired tag visible while it is still selected, so it can be removed.
  const projectOptions = [
    { id: 'inbox', name: 'Inbox' },
    ...live,
    ...fields.projects
      .filter((id) => id !== 'inbox' && !live.some((p) => p.id === id))
      .map((id) => ({ id, name: 'Deleted project' })),
  ]
  const tagOptions = [...new Set([...taskTags(tasks), ...fields.tags])].sort((a, b) =>
    a.localeCompare(b),
  )
  const matches = tasks.filter((t) => matchesFilter(t, fields)).length

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const name = fields.name.trim()
    if (!name) {
      setError('Enter a filter name.')
      nameInput.current?.focus()
      return
    }
    onSave({ ...fields, name }, !filter)
    onClose()
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className="dialog project-dialog filter-dialog"
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            nameInput.current?.focus()
          }}
        >
          <form onSubmit={submit}>
            <div className="dialog-header">
              <Dialog.Title className="dialog-title">{filter ? 'Edit filter' : 'New filter'}</Dialog.Title>
              <Dialog.Description className="dialog-description">
                Tasks must match every row. Within a row, any selected option matches; leave a row
                empty to match anything.
              </Dialog.Description>
            </div>
            <div className="dialog-body project-form">
              <label htmlFor="filter-name">Name</label>
              <input
                ref={nameInput}
                id="filter-name"
                className="field"
                maxLength={maxFilterName}
                value={fields.name}
                aria-invalid={!!error && !fields.name.trim()}
                onChange={(event) => set({ name: event.target.value })}
              />
              <Options label="Projects">
                {projectOptions.map((project) => (
                  <Option
                    key={project.id}
                    pressed={fields.projects.includes(project.id)}
                    onClick={() => set({ projects: toggle(fields.projects, project.id) })}
                  >
                    {project.name}
                  </Option>
                ))}
              </Options>
              <Options label="Tags" empty="No task tags yet.">
                {tagOptions.map((tag) => (
                  <Option
                    key={tag}
                    tag={tag}
                    pressed={fields.tags.includes(tag)}
                    onClick={() => set({ tags: toggle(fields.tags, tag) })}
                  >
                    #{tag}
                  </Option>
                ))}
              </Options>
              <Options label="Priority">
                {[...priorities].reverse().map((priority) => (
                  <Option
                    key={priority.id}
                    pressed={fields.priorities.includes(priority.id)}
                    onClick={() =>
                      set({ priorities: toggle<Priority>(fields.priorities, priority.id) })
                    }
                  >
                    {priority.label}
                  </Option>
                ))}
              </Options>
              <Options label="Due">
                {filterDates.map((date) => (
                  <Option
                    key={date.id}
                    pressed={fields.dates.includes(date.id)}
                    onClick={() => set({ dates: toggle(fields.dates, date.id) })}
                  >
                    {date.label}
                  </Option>
                ))}
              </Options>
              <span className="project-form-label" id="filter-status-label">
                Show
              </span>
              <div className="segmented" role="group" aria-labelledby="filter-status-label">
                {filterStatuses.map((status) => (
                  <button
                    type="button"
                    key={status.id}
                    aria-pressed={fields.status === status.id}
                    onClick={() => set({ status: status.id })}
                  >
                    {status.label}
                  </button>
                ))}
              </div>
              <p className="field-help filter-matches" aria-live="polite">
                {matches === 1 ? '1 task matches now.' : `${matches} tasks match now.`}
              </p>
              {error && (
                <p role="alert" className="field-error project-form-error">
                  {error}
                </p>
              )}
            </div>
            <div className="dialog-footer">
              <button type="button" className="btn" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                {filter ? 'Save' : 'Create filter'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Options({ label, empty, children }: { label: string; empty?: string; children: ReactNode[] }) {
  const id = `filter-${label.toLowerCase()}-label`
  return (
    <>
      <span className="project-form-label" id={id}>
        {label}
      </span>
      <div className="filter-options" role="group" aria-labelledby={id}>
        {children.length ? children : <span className="filter-empty">{empty}</span>}
      </div>
    </>
  )
}

function Option({
  pressed,
  tag,
  onClick,
  children,
}: {
  pressed: boolean
  tag?: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className="chip filter-option"
      data-tone={tag ? tagTone(tag) : undefined}
      data-tag={tag}
      aria-pressed={pressed}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
