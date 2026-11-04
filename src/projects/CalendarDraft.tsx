import { useState, type MutableRefObject } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { createTaskConfirmed } from './actions'
import { formatDate, type Project } from './model'
import { ScheduleFields, scheduleFromDraft, type ScheduleDraft } from './ScheduleEditor'

const draftSummary = (draft: ScheduleDraft) => {
  if (draft.kind === 'none') return 'No scheduled time'
  const day = formatDate(draft.date)
  if (draft.kind === 'allDay')
    return draft.endDate === draft.date
      ? `${day} · All day`
      : `${day} – ${formatDate(draft.endDate)}`
  if (draft.kind === 'point') return `${day} · ${draft.time}`
  return draft.endDate === draft.date
    ? `${day} · ${draft.time}–${draft.endTime}`
    : `${day} ${draft.time} – ${formatDate(draft.endDate)} ${draft.endTime}`
}

/** On desktop a compact centred window that leaves the grid in view; on touch screens the usual dialog. */
export default function CalendarDraft({
  initial,
  projects,
  disabled,
  mobile,
  dirty,
  onChange,
  onClose,
  onCreated,
  restoreFocus,
}: {
  initial: ScheduleDraft
  projects: Project[]
  disabled: boolean
  mobile: boolean
  dirty: MutableRefObject<boolean>
  onChange: (schedule: ScheduleDraft) => void
  onClose: () => void
  onCreated: (title: string) => void
  restoreFocus: () => void
}) {
  const [draft, setDraft] = useState({ schedule: initial, title: '', projectId: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [editingTime, setEditingTime] = useState(mobile)
  const close = (open: boolean) => {
    if (!open && !saving) onClose()
  }
  const titleInput = (
    <input
      autoFocus
      className="field"
      aria-label="Calendar task title"
      placeholder={mobile ? undefined : 'Add a title'}
      maxLength={500}
      value={draft.title}
      disabled={saving || disabled}
      onChange={(event) => {
        dirty.current = !!event.target.value.trim()
        setDraft({ ...draft, title: event.target.value })
      }}
      required
    />
  )
  const projectSelect = (
    <select
      className="field"
      aria-label="Project"
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
  )
  const scheduleFields = (
    <ScheduleFields
      value={draft.schedule}
      onChange={(schedule) => {
        setDraft({ ...draft, schedule })
        onChange(schedule)
      }}
      disabled={saving || disabled}
    />
  )
  const errorText = error && (
    <p role="alert" className="field-error">
      {error}
    </p>
  )
  const cancelButton = (
    <button type="button" className={mobile ? 'btn' : 'btn btn-plain'} disabled={saving} onClick={onClose}>
      Cancel
    </button>
  )
  const addButton = (
    <button className="btn btn-primary" disabled={saving || disabled || !draft.title.trim()}>
      {saving ? 'Saving…' : 'Add task'}
    </button>
  )
  const submit = async (event: React.FormEvent) => {
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
  }
  if (!mobile)
    return (
      <Dialog.Root open modal={false} onOpenChange={close}>
        <Dialog.Portal>
          <Dialog.Content
            className="dialog calendar-draft-window"
            aria-describedby={undefined}
            // A typed title is never thrown away by a stray click. Escape and Cancel still discard.
            onInteractOutside={(event) => {
              if (dirty.current) event.preventDefault()
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              restoreFocus()
            }}
          >
            <Dialog.Title className="sr-only">New calendar task</Dialog.Title>
            <form onSubmit={submit}>
              {titleInput}
              {projectSelect}
              <button
                type="button"
                className="calendar-draft-when"
                aria-expanded={editingTime}
                onClick={() => setEditingTime(!editingTime)}
              >
                <span>{draftSummary(draft.schedule)}</span>
                <span className="calendar-draft-edit">Edit time</span>
              </button>
              {editingTime && scheduleFields}
              {errorText}
              <div className="calendar-draft-actions">
                {cancelButton}
                {addButton}
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    )
  return (
    <Dialog.Root open onOpenChange={close}>
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
          <form onSubmit={submit}>
            <div className="dialog-body">
              <label className="field-label">
                Title
                {titleInput}
              </label>
              <label className="field-label">
                Project
                {projectSelect}
              </label>
              {scheduleFields}
              {errorText}
            </div>
            <div className="dialog-footer">
              {cancelButton}
              {addButton}
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
