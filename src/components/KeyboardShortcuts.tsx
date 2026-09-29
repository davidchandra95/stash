import { useEffect, useRef, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { Pencil, RotateCcw, Trash2 } from '../icons'
import {
  bindingError,
  bindingFor,
  eventBinding,
  shortcutCommands,
  shortcutLabel,
  type ShortcutOverrides,
} from '../shortcuts'
export default function KeyboardShortcuts({
  value,
  onChange,
  query = '',
}: {
  value: ShortcutOverrides
  onChange: (next: ShortcutOverrides) => void
  query?: string
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [candidate, setCandidate] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [confirmReset, setConfirmReset] = useState(false)
  const recorder = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const mac = isTauri()
  const close = () => {
    setEditing(null)
    setError('')
    trigger.current?.focus()
  }
  useEffect(() => {
    if (editing) recorder.current?.focus()
  }, [editing])
  const rows = shortcutCommands.filter((c) =>
    `${c.label} ${c.description} ${c.category} keyboard shortcuts`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  )
  const reset = (id: string) => {
    const next = { ...value }
    delete next[id]
    const binding = bindingFor(id, next)
    const problem = binding && bindingError(id, binding, next, mac)
    if (problem) {
      setError(problem)
      return
    }
    setError('')
    onChange(next)
  }
  return (
    <div className="keyboard-shortcuts">
      <div className="shortcut-heading">
        <p>Choose one shortcut per action. Changes save automatically.</p>
        <button
          onClick={() => {
            close()
            setConfirmReset(true)
          }}
        >
          Reset all to defaults
        </button>
      </div>
      {confirmReset && (
        <div className="shortcut-confirm" role="group" aria-label="Reset shortcut confirmation">
          <p>Reset all keyboard shortcuts? Your custom assignments will be removed.</p>
          <button
            onClick={() => {
              onChange({})
              setConfirmReset(false)
              setError('')
            }}
          >
            Reset shortcuts
          </button>
          <button onClick={() => setConfirmReset(false)}>Cancel reset</button>
        </div>
      )}
      {error && (
        <p role="alert" className="shortcut-error">
          {error}
        </p>
      )}
      {!rows.length && <p role="status">No shortcuts found.</p>}
      {(['Application', 'Navigation', 'Notes', 'Writing'] as const).map((category) => {
        const commands = rows.filter((c) => c.category === category)
        return (
          commands.length > 0 && (
            <section className="shortcut-section" key={category} aria-label={category}>
              <h3>{category}</h3>
              <div className="shortcut-rows">
                {commands.map((command) => (
                  <div className="shortcut-row" key={command.id}>
                    <div className="shortcut-description">
                      <strong>{command.label}</strong>
                      <small>{command.description}</small>
                    </div>
                    <kbd>{shortcutLabel(bindingFor(command.id, value), mac)}</kbd>
                    <button
                      className="icon-button"
                      aria-label={`Edit ${command.label} shortcut`}
                      onClick={(event) => {
                        trigger.current = event.currentTarget
                        setEditing(command.id)
                        setCandidate(null)
                        setError('')
                        setConfirmReset(false)
                      }}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`Clear ${command.label} shortcut`}
                      disabled={!bindingFor(command.id, value)}
                      onClick={() => {
                        close()
                        setError('')
                        onChange({ ...value, [command.id]: null })
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`Reset ${command.label} shortcut`}
                      disabled={!Object.hasOwn(value, command.id)}
                      onClick={() => {
                        close()
                        reset(command.id)
                      }}
                    >
                      <RotateCcw size={14} />
                    </button>
                    {editing === command.id && (
                      <div
                        className="shortcut-recording"
                        ref={recorder}
                        tabIndex={0}
                        role="group"
                        aria-label={`Record ${command.label} shortcut`}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') {
                            event.preventDefault()
                            event.stopPropagation()
                            close()
                            return
                          }
                          // Unmodified Tab remains available for reaching Save and Cancel.
                          if (
                            event.key === 'Tab' &&
                            !event.metaKey &&
                            !event.ctrlKey &&
                            !event.altKey
                          )
                            return
                          if (event.target !== event.currentTarget) return
                          event.preventDefault()
                          event.stopPropagation()
                          if (event.repeat || event.nativeEvent.isComposing) return
                          const key = eventBinding(event.nativeEvent, mac)
                          if (!key) return
                          setCandidate(key)
                          setError(bindingError(command.id, key, value, mac) ?? '')
                        }}
                      >
                        <span>
                          {candidate ? shortcutLabel(candidate, mac) : 'Press a key combination…'}
                        </span>
                        <button
                          disabled={!candidate || !!bindingError(command.id, candidate, value, mac)}
                          onClick={() => {
                            if (candidate && !bindingError(command.id, candidate, value, mac)) {
                              onChange({ ...value, [command.id]: candidate })
                              close()
                            }
                          }}
                        >
                          Save shortcut
                        </button>
                        <button onClick={close}>Cancel</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )
        )
      })}
    </div>
  )
}
