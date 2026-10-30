// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { writingExtensions } from './extensions'
import { parseMarkdown, serializeMarkdown, validateMarkdown } from './markdown'
import { mentionMatch, taskIdFromLink, taskSuggestions } from './taskReferences'
import { noteMentionsTask } from '../projects/mentions'
import type { Task } from '../projects/model'

const task = (id: string, title: string, fields: Partial<Task> = {}): Task => ({
  id,
  title,
  description: '',
  status: 'todo',
  projectId: null,
  priority: 0,
  startDate: null,
  dueDate: null,
  completedAt: null,
  sort: 1,
  deletedAt: null,
  created: 1,
  updated: 1,
  revision: 1,
  ...fields,
})

function editorWith(text: string) {
  const editor = new Editor({ extensions: writingExtensions, content: `<p>${text}</p>` })
  editor.commands.focus('end')
  return editor
}

describe('@ mentions', () => {
  it('opens only where @ starts a word', () => {
    expect(mentionMatch(editorWith('Ask @lau'))?.query).toBe('lau')
    expect(mentionMatch(editorWith('@'))?.query).toBe('')
    expect(mentionMatch(editorWith('(@launch email'))?.query).toBe('launch email')
    expect(mentionMatch(editorWith('mail me at ana@example'))).toBeNull()
    expect(mentionMatch(editorWith('no mention'))).toBeNull()
  })

  it('suggests open tasks before finished ones, prefix matches first', () => {
    const tasks = [
      task('a', 'Plan launch party', { updated: 3 }),
      task('b', 'Launch checklist draft', { status: 'done', updated: 9 }),
      task('c', 'Launch announcement email', { updated: 1 }),
      task('d', 'Launch deleted', { deletedAt: 5 }),
    ]
    expect(taskSuggestions(tasks, 'lau').map((t) => t.id)).toEqual(['c', 'a', 'b'])
    expect(taskSuggestions(tasks, '').map((t) => t.id)).toEqual(['a', 'c', 'b'])
  })

  it('reads task links', () => {
    expect(taskIdFromLink('stash://task/abc-1')).toBe('abc-1')
    expect(taskIdFromLink('stash://task/../x')).toBeNull()
    expect(taskIdFromLink('upnote2://note/abc')).toBeNull()
  })
})

describe('task mentions in Markdown', () => {
  it('round-trips a mention as a stash link', () => {
    const doc = parseMarkdown('Copy: [Write homepage copy](stash://task/t1) first.\n')
    const mention = doc.content?.[0].content?.find((node) => node.type === 'taskReference')
    expect(mention?.attrs).toMatchObject({ taskId: 't1', fallbackTitle: 'Write homepage copy' })
    expect(() => validateMarkdown(doc)).not.toThrow()
    expect(serializeMarkdown(doc)).toContain('[Write homepage copy](stash://task/t1)')
  })

  it('leaves other links alone', () => {
    const doc = parseMarkdown('[Site](https://example.com) and [Bad](stash://task/../x)\n')
    expect(JSON.stringify(doc)).not.toContain('taskReference')
  })

  it('finds mentions in native and linked notes', () => {
    const content = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'taskReference', attrs: { taskId: 't1', fallbackTitle: 'x' } }],
        },
      ],
    }
    expect(noteMentionsTask({ content, source: null }, 't1')).toBe(true)
    expect(noteMentionsTask({ content, source: null }, 't')).toBe(false)
    const source = {
      rootId: 'r',
      relativePath: 'a.md',
      fingerprint: 'f',
      markdown: '[x](stash://task/t1)',
    }
    expect(noteMentionsTask({ content, source }, 't1')).toBe(true)
    expect(noteMentionsTask({ content, source }, 't')).toBe(false)
  })
})
