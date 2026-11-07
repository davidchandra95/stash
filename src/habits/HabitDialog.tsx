import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import DateField from '../components/DateField'
import { notebookColors } from '../notebookColors'
import { today } from '../projects/model'
import { createHabit, updateHabit, type HabitFields } from './actions'
import { FrequencyEditor } from './HabitParts'
import { maxHabitName, type Habit } from './model'

const blank = (): HabitFields => ({
  name: '',
  color: notebookColors.find((c) => c.id === 'teal')!.light,
  frequency: { kind: 'daily' },
  startDate: today(),
})

/** Creates a habit, or edits one when `habit` is given. */
export default function HabitDialog({
  open,
  habit,
  onClose,
  onCreated,
}: {
  open: boolean
  habit?: Habit
  onClose: () => void
  onCreated: (habit: Habit) => void
}) {
  const [fields, setFields] = useState<HabitFields>(blank)
  const [error, setError] = useState('')
  const nameInput = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!open) return
    setFields(habit ? { ...habit } : blank())
    setError('')
  }, [open, habit?.id])
  const set = (patch: Partial<HabitFields>) => setFields((old) => ({ ...old, ...patch }))

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const name = fields.name.trim()
    if (!name) {
      setError('Enter a habit name.')
      nameInput.current?.focus()
      return
    }
    if (habit) updateHabit(habit, { ...fields, name })
    else onCreated(createHabit({ ...fields, name }))
    onClose()
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className="dialog project-dialog habit-dialog"
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            nameInput.current?.focus()
          }}
        >
          <form onSubmit={submit}>
            <div className="dialog-header">
              <Dialog.Title className="dialog-title">{habit ? 'Edit habit' : 'New habit'}</Dialog.Title>
              <Dialog.Description className="dialog-description">
                Check it off each day you do it, with an optional note about the day.
              </Dialog.Description>
            </div>
            <div className="dialog-body project-form">
              <label htmlFor="habit-name">Name</label>
              <input
                ref={nameInput}
                id="habit-name"
                className="field"
                placeholder="Read a book"
                maxLength={maxHabitName}
                value={fields.name}
                aria-invalid={!!error && !fields.name.trim()}
                onChange={(event) => set({ name: event.target.value })}
              />
              <span className="project-form-label">Repeat</span>
              <FrequencyEditor value={fields.frequency} onChange={(frequency) => set({ frequency })} />
              <label htmlFor="habit-start">Starts</label>
              <DateField
                id="habit-start"
                label="Start date"
                value={fields.startDate}
                clearable={false}
                onChange={(startDate) => startDate && set({ startDate })}
              />
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
                {habit ? 'Save' : 'Create habit'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
