import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { createTaskConfirmed } from './actions'
import { ScheduleFields, scheduleFromDraft, type ScheduleDraft } from './ScheduleEditor'
import type { Project } from './model'

export default function CalendarDraft({
  initial,
  projects,
  disabled,
  onClose,
  onCreated,
  restoreFocus,
}: {
  initial: ScheduleDraft
  projects: Project[]
  disabled: boolean
  onClose: () => void
  onCreated: (title: string) => void
  restoreFocus: () => void
}) {
  const [draft, setDraft] = useState({ schedule: initial, title: '', projectId: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className="dialog calendar-draft"
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            restoreFocus()
          }}
        >
          <div className="dialog-header">
            <Dialog.Title className="dialog-title">New calendar task</Dialog.Title>
            <Dialog.Description className="dialog-description">
              Choose when to work. The due day follows the schedule until you set a separate
              deadline.
            </Dialog.Description>
          </div>
          <form
            onSubmit={async (event) => {
              event.preventDefault()
              if (saving || disabled || !draft.title.trim()) return
              setError('')
              try {
                const schedule = scheduleFromDraft(draft.schedule)
                setSaving(true)
                const task = await createTaskConfirmed(draft.projectId || null, draft.title, {
                  schedule,
                  dueLinked: !!schedule,
                })
                onCreated(task.title)
                onClose()
              } catch (error) {
                setError(String(error))
              } finally {
                setSaving(false)
              }
            }}
          >
            <div className="dialog-body">
              <label className="field-label">
                Title
                <input
                  autoFocus
                  className="field"
                  aria-label="Calendar task title"
                  maxLength={500}
                  value={draft.title}
                  disabled={saving || disabled}
                  onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                  required
                />
              </label>
              <label className="field-label">
                Project
                <select
                  className="field"
                  value={draft.projectId}
                  disabled={saving || disabled}
                  onChange={(event) => setDraft({ ...draft, projectId: event.target.value })}
                >
                  <option value="">Inbox</option>
                  {projects
                    .filter((p) => !p.deletedAt)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </label>
              <ScheduleFields
                value={draft.schedule}
                onChange={(schedule) => setDraft({ ...draft, schedule })}
                disabled={saving || disabled}
              />
              {error && (
                <p role="alert" className="field-error">
                  {error}
                </p>
              )}
            </div>
            <div className="dialog-footer">
              <button type="button" className="btn" disabled={saving} onClick={onClose}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={saving || disabled || !draft.title.trim()}
              >
                {saving ? 'Saving…' : 'Add task'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
