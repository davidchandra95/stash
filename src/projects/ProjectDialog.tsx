import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { defaultNotebookColor, notebookColors } from '../notebookColors'
import type { Notebook } from '../model'
import { createProject, updateProject, type ProjectFields } from './actions'
import { projectStatuses, type Project } from './model'

const blank: ProjectFields = {
  name: '',
  description: '',
  status: 'active',
  startDate: null,
  endDate: null,
  notebookId: null,
  color: notebookColors.find((c) => c.id === 'teal')?.light ?? defaultNotebookColor,
}

/** Creates a project, or edits one when `project` is given. */
export default function ProjectDialog({
  open,
  project,
  notebooks,
  onClose,
  onCreated,
}: {
  open: boolean
  project?: Project
  notebooks: Notebook[]
  onClose: () => void
  onCreated: (project: Project) => void
}) {
  const [fields, setFields] = useState<ProjectFields>(blank)
  const [error, setError] = useState('')
  const nameInput = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!open) return
    setFields(project ? { ...project } : blank)
    setError('')
  }, [open, project?.id])
  const set = (patch: Partial<ProjectFields>) => setFields((old) => ({ ...old, ...patch }))

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const name = fields.name.trim()
    if (!name) {
      setError('Enter a project name.')
      nameInput.current?.focus()
      return
    }
    if (fields.startDate && fields.endDate && fields.endDate < fields.startDate) {
      setError('The end date is before the start date.')
      return
    }
    const next = { ...fields, name }
    if (project) updateProject(project, next)
    else onCreated(createProject(next))
    onClose()
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className="dialog project-dialog"
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            nameInput.current?.focus()
          }}
        >
          <form onSubmit={submit}>
            <div className="dialog-header">
              <Dialog.Title className="dialog-title">
                {project ? 'Edit project' : 'New project'}
              </Dialog.Title>
              <Dialog.Description className="dialog-description">
                {project
                  ? 'Change the project’s details, dates and notebook.'
                  : 'Projects have their own tasks, dates and progress.'}
              </Dialog.Description>
            </div>
            <div className="dialog-body project-form">
              <label htmlFor="project-name">Name</label>
              <input
                ref={nameInput}
                id="project-name"
                className="field"
                maxLength={200}
                value={fields.name}
                aria-invalid={!!error && !fields.name.trim()}
                onChange={(event) => set({ name: event.target.value })}
              />
              <label htmlFor="project-description">Description</label>
              <textarea
                id="project-description"
                className="field"
                rows={2}
                maxLength={10_000}
                value={fields.description}
                onChange={(event) => set({ description: event.target.value })}
              />
              <label htmlFor="project-status">Status</label>
              <select
                id="project-status"
                className="field"
                value={fields.status}
                onChange={(event) => set({ status: event.target.value as Project['status'] })}
              >
                {projectStatuses.map((status) => (
                  <option key={status.id} value={status.id}>
                    {status.label}
                  </option>
                ))}
              </select>
              <span className="project-form-label">Dates</span>
              <div className="project-dates">
                <input
                  type="date"
                  className="field"
                  aria-label="Start date"
                  value={fields.startDate ?? ''}
                  onChange={(event) => set({ startDate: event.target.value || null })}
                />
                <span aria-hidden="true">–</span>
                <input
                  type="date"
                  className="field"
                  aria-label="End date"
                  value={fields.endDate ?? ''}
                  onChange={(event) => set({ endDate: event.target.value || null })}
                />
              </div>
              <label htmlFor="project-notebook">Notebook</label>
              <select
                id="project-notebook"
                className="field"
                value={fields.notebookId ?? ''}
                onChange={(event) => set({ notebookId: event.target.value || null })}
              >
                <option value="">None</option>
                {notebooks.map((book) => (
                  <option key={book.id} value={book.id}>
                    {book.name}
                  </option>
                ))}
              </select>
              <span className="project-form-label">Color</span>
              <div className="notebook-colors">
                {notebookColors.map((preset) => (
                  <button
                    type="button"
                    key={preset.id}
                    className="color-swatch"
                    style={{ '--swatch': `var(--notebook-${preset.id})` } as CSSProperties}
                    aria-label={`Color ${preset.label}`}
                    aria-pressed={fields.color.toLowerCase() === preset.light}
                    onClick={() => set({ color: preset.light })}
                  />
                ))}
              </div>
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
                {project ? 'Save' : 'Create project'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
