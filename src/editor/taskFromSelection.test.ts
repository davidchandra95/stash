// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { writingExtensions } from './extensions'
import { parseMarkdown, serializeMarkdown } from './markdown'
import { runCommand } from './commands'
import { canRunWritingCommand } from '../components/editorPresentation'
import { noteMentionsTask } from '../projects/mentions'
import { projectStore } from '../projects/store'

describe('creating tasks from a note', () => {
  beforeAll(() => projectStore.open())
  const editorFor = (html: string) => new Editor({ extensions: writingExtensions, content: html })
  const taskById = (id: string) => projectStore.getSnapshot().tasks.find((t) => t.id === id)!
  const mentions = (editor: Editor) => {
    const found: { taskId: string; fallbackTitle: string }[] = []
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'taskReference') found.push(node.attrs as (typeof found)[number])
    })
    return found
  }
  /** The document position of `text`, which must sit in one text node. */
  const find = (editor: Editor, text: string) => {
    let at = -1
    editor.state.doc.descendants((node, pos) => {
      if (at < 0 && node.isText && node.text!.includes(text)) at = pos + node.text!.indexOf(text)
    })
    return { from: at, to: at + text.length }
  }
  const checklist = (checked = false) =>
    `<ul><li data-kind="task" data-checked="${checked}"><p>Send the report</p></li><li data-kind="task"><p>Book a room</p></li></ul>`

  it('replaces a selected sentence with a mention of a new task', () => {
    const editor = editorFor('<p>Notes. Alex will send the report. Then lunch.</p>')
    editor.commands.setTextSelection(find(editor, ' Alex will send the report.'))
    expect(runCommand(editor, 'create-task')).toBe(true)
    const [mention] = mentions(editor)
    expect(mention.fallbackTitle).toBe('Alex will send the report.')
    expect(taskById(mention.taskId)).toMatchObject({
      title: 'Alex will send the report.',
      projectId: null,
      status: 'todo',
    })
    // The space trimmed from the selection stays, and the caret lands after the mention.
    expect(editor.getText()).toBe('Notes. Alex will send the report. Then lunch.')
    expect(editor.state.selection.empty).toBe(true)
    expect(editor.state.selection.$from.nodeBefore?.type.name).toBe('taskReference')
    expect(noteMentionsTask({ content: editor.getJSON() }, mention.taskId)).toBe(true)
    editor.commands.undo()
    expect(editor.getText()).toBe('Notes. Alex will send the report. Then lunch.')
    expect(mentions(editor)).toEqual([])
  })

  it('takes the whole checklist item from a caret and keeps a single checkbox', () => {
    const editor = editorFor(checklist())
    editor.commands.setTextSelection(find(editor, 'Send').from + 2)
    expect(runCommand(editor, 'create-task')).toBe(true)
    expect(mentions(editor)[0].fallbackTitle).toBe('Send the report')
    const list = editor.state.doc.child(0)
    expect(list.child(0).attrs.kind).toBe('bullet')
    expect(list.child(1).attrs.kind).toBe('task')
  })

  it('starts a ticked checklist item as done', () => {
    const editor = editorFor(checklist(true))
    editor.commands.setTextSelection(find(editor, 'Send').from)
    runCommand(editor, 'create-task')
    expect(taskById(mentions(editor)[0].taskId).status).toBe('done')
  })

  it('leaves the checkbox when only part of an item is selected', () => {
    const editor = editorFor(checklist())
    editor.commands.setTextSelection(find(editor, 'the report'))
    runCommand(editor, 'create-task')
    expect(mentions(editor)[0].fallbackTitle).toBe('the report')
    expect(editor.state.doc.child(0).child(0).attrs.kind).toBe('task')
  })

  it('makes one task per selected line, in order', () => {
    const editor = editorFor(checklist())
    editor.commands.setTextSelection({
      from: find(editor, 'Send the report').from,
      to: find(editor, 'Book a room').to,
    })
    runCommand(editor, 'create-task')
    const titles = mentions(editor).map((m) => m.fallbackTitle)
    expect(titles).toEqual(['Send the report', 'Book a room'])
    const [first, second] = mentions(editor).map((m) => taskById(m.taskId))
    expect(first.sort).toBeLessThan(second.sort)
    expect(editor.state.selection.$from.nodeBefore?.attrs.fallbackTitle).toBe('Book a room')
  })

  it('needs text it can replace without loss', () => {
    const plain = editorFor('<p>Just a paragraph</p>')
    plain.commands.setTextSelection(3)
    expect(canRunWritingCommand(plain, 'create-task')).toBe(false)
    const code = editorFor('<pre><code>let a = 1</code></pre>')
    code.commands.setTextSelection({ from: 1, to: 6 })
    expect(canRunWritingCommand(code, 'create-task')).toBe(false)
    const mentioned = editorFor('<p>Ask <span data-task-id="task-1">Launch</span> today</p>')
    mentioned.commands.setTextSelection({ from: 1, to: mentioned.state.doc.content.size - 1 })
    expect(canRunWritingCommand(mentioned, 'create-task')).toBe(false)
    const long = editorFor(`<p>${'x'.repeat(501)}</p>`)
    long.commands.setTextSelection({ from: 1, to: 502 })
    expect(canRunWritingCommand(long, 'create-task')).toBe(false)
    const before = projectStore.getSnapshot().tasks.length
    expect(runCommand(plain, 'create-task')).toBe(false)
    expect(projectStore.getSnapshot().tasks.length).toBe(before)
  })

  it('does not create anything while only checking availability', () => {
    const editor = editorFor(checklist())
    editor.commands.setTextSelection(find(editor, 'Send').from)
    const before = projectStore.getSnapshot().tasks.length
    expect(canRunWritingCommand(editor, 'create-task')).toBe(true)
    expect(projectStore.getSnapshot().tasks.length).toBe(before)
  })

  it('round-trips through linked Markdown', () => {
    const editor = editorFor(checklist())
    editor.commands.setTextSelection(find(editor, 'Send').from)
    runCommand(editor, 'create-task')
    const { taskId } = mentions(editor)[0]
    const markdown = serializeMarkdown(editor.getJSON())
    expect(markdown).toContain(`(stash://task/${taskId})`)
    expect(noteMentionsTask({ content: parseMarkdown(markdown), source: undefined }, taskId)).toBe(true)
  })
})
