import { useState } from 'react'
import { X } from '../icons'
import { tagTone, taskTagName } from '../tags'
import { updateTask } from './actions'
import { taskTags, type Task } from './model'
import { projectStore } from './store'

const maxTags = 20

/** A task's tags in a row's metadata: the first two, then how many more. */
export function TaskTagChips({ task }: { task: Pick<Task, 'tags'> }) {
  const tags = task.tags ?? []
  if (!tags.length) return null
  return (
    <span className="task-tags" title={tags.map((tag) => `#${tag}`).join(' ')}>
      {tags.slice(0, 2).map((tag) => (
        <span className="chip" data-tone={tagTone(tag)} data-tag={tag} key={tag}>
          #{tag}
        </span>
      ))}
      {tags.length > 2 && <span className="chip">+{tags.length - 2}</span>}
    </span>
  )
}

/** Edits a task's tags. Return, comma or space adds what's typed; matching tags are offered below. */
export default function TaskTagsEditor({
  id,
  task,
  disabled,
}: {
  id: string
  task: Task
  disabled: boolean
}) {
  const [draft, setDraft] = useState('')
  const [focused, setFocused] = useState(false)
  const tags = task.tags ?? []
  const full = tags.length >= maxTags
  const add = (value: string) => {
    const tag = taskTagName(value)
    setDraft('')
    if (tag && !full && !tags.includes(tag)) updateTask(task, { tags: [...tags, tag] })
  }
  const remove = (tag: string) => updateTask(task, { tags: tags.filter((item) => item !== tag) })
  const query = taskTagName(draft) ?? ''
  const suggestions = focused
    ? taskTags(projectStore.getSnapshot().tasks)
        .filter((tag) => !tags.includes(tag) && tag.startsWith(query))
        .slice(0, 6)
    : []
  return (
    <div className="task-tags-editor">
      {tags.map((tag) => (
        <span className="chip" data-tone={tagTone(tag)} data-tag={tag} key={tag}>
          #{tag}
          <button
            type="button"
            className="task-tag-remove"
            aria-label={`Remove tag ${tag}`}
            disabled={disabled}
            onClick={() => remove(tag)}
          >
            <X aria-hidden="true" />
          </button>
        </span>
      ))}
      <input
        id={id}
        className="task-tag-input"
        placeholder={full ? `${maxTags} tags at most` : 'Add tag'}
        value={draft}
        maxLength={50}
        disabled={disabled || full}
        autoComplete="off"
        enterKeyHint="done"
        onChange={(event) => {
          const next = event.target.value
          // Touch keyboards often report no key, so a typed separator commits here too.
          if (/[\s,]$/.test(next)) add(next.slice(0, -1))
          else setDraft(next)
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false)
          add(draft)
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return
          if (event.key === 'Enter') {
            event.preventDefault()
            add(draft)
          } else if (event.key === 'Backspace' && !draft && tags.length) {
            remove(tags[tags.length - 1])
          } else if (event.key === 'Escape' && draft) {
            event.stopPropagation()
            setDraft('')
          }
        }}
      />
      {suggestions.length > 0 && (
        <div className="task-tag-suggestions" aria-label="Existing tags" role="group">
          {suggestions.map((tag) => (
            <button
              type="button"
              className="chip"
              data-tone={tagTone(tag)}
              data-tag={tag}
              key={tag}
              disabled={disabled}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => add(tag)}
            >
              #{tag}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
