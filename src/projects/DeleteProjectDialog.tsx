import { useEffect, useState, type FormEvent } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { deleteProject, type Notify } from './actions'
import type { Project, Task } from './model'

export default function DeleteProjectDialog({
  project,
  tasks,
  onClose,
  notify,
}: {
  project: Project | null
  tasks: Task[]
  onClose: () => void
  notify: Notify
}) {
  const [deleteTasks, setDeleteTasks] = useState(false)
  useEffect(() => setDeleteTasks(false), [project?.id])
  const own = tasks.filter((t) => t.deletedAt === null && t.projectId === project?.id)
  const open = own.filter((t) => t.status === 'todo' || t.status === 'doing').length
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!project) return
    deleteProject(project, deleteTasks, notify)
    onClose()
  }
  const choice = (checked: boolean, value: boolean, title: string, detail: string) => (
    <label className="radio-choice">
      <input
        type="radio"
        name="project-delete-tasks"
        checked={checked}
        onChange={() => setDeleteTasks(value)}
      />
      <span>
        <span className="radio-choice-title">{title}</span>
        <span className="field-help">{detail}</span>
      </span>
    </label>
  )
  return (
    <Dialog.Root open={!!project} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog">
          <form onSubmit={submit}>
            <div className="dialog-header">
              <Dialog.Title className="dialog-title">Delete “{project?.name}”?</Dialog.Title>
              <Dialog.Description className="dialog-description">
                {own.length
                  ? `The project has ${open} open and ${own.length - open} finished ${own.length === 1 ? 'task' : 'tasks'}.`
                  : 'The project has no tasks.'}
              </Dialog.Description>
            </div>
            <div className="dialog-body">
              {own.length > 0 && (
                <fieldset className="radio-group">
                  <legend className="field-label">Tasks</legend>
                  {choice(
                    !deleteTasks,
                    false,
                    'Move tasks to Inbox',
                    'Tasks keep their status and dates.',
                  )}
                  {choice(
                    deleteTasks,
                    true,
                    'Delete tasks too',
                    'You can undo this right after deleting.',
                  )}
                </fieldset>
              )}
            </div>
            <div className="dialog-footer">
              <button type="button" className="btn" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="btn btn-danger">
                Delete project
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
