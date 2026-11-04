// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { insertTranscript } from './insertion'
import { readPreferences, savePreferences } from './client'
import { loudness } from './Waveform'

Element.prototype.scrollIntoView = vi.fn()
Range.prototype.getClientRects = () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () =>
  ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }) as DOMRect
const editors: Editor[] = []
function editor() {
  const e = new Editor({ extensions: [StarterKit], content: '<p>Hello world</p>' })
  editors.push(e)
  return e
}
afterEach(() => {
  editors.splice(0).forEach((e) => e.destroy())
  localStorage.clear()
})
it('inserts literal English and Indonesian text without replacing selected text, with isolated undo/redo', () => {
  const e = editor()
  e.commands.setTextSelection(6)
  e.commands.insertContent('!')
  e.commands.setTextSelection({ from: 8, to: 13 })
  const before = e.getJSON()
  const onUpdate = vi.fn()
  e.on('update', onUpdate)
  insertTranscript(e, '<b>Halo</b> **hello** ')
  expect(e.getText()).toBe('Hello! <b>Halo</b> **hello** world')
  expect(onUpdate).toHaveBeenCalledTimes(1)
  e.commands.undo()
  expect(e.getJSON()).toEqual(before)
  e.commands.undo()
  expect(e.getText()).toBe('Hello world')
  e.commands.redo()
  e.commands.redo()
  expect(e.getText()).toContain('<b>Halo</b> **hello**')
})
it('follows the cursor when the note changes while dictating', () => {
  const e = editor()
  e.commands.setTextSelection(1)
  e.commands.insertContent('changed ')
  insertTranscript(e, 'Halo ')
  expect(e.getText()).toBe('changed Halo Hello world')
  expect(e.state.selection.from).toBe('changed Halo '.length + 1)
})
it('refuses a destroyed or read-only editor without modifying its content', () => {
  const e = editor()
  e.setEditable(false)
  expect(() => insertTranscript(e, 'Halo')).toThrow('editable')
  expect(e.getText()).toBe('Hello world')
  e.destroy()
  expect(() => insertTranscript(e, 'Halo')).toThrow('editable')
})
it('uses only the captured editor and refuses empty transcripts', () => {
  const first = editor()
  const second = editor()
  expect(() => insertTranscript(first, '  ')).toThrow('empty')
  insertTranscript(first, 'Halo ')
  expect(first.getText()).toBe('Halo Hello world')
  expect(second.getText()).toBe('Hello world')
})
it('keeps silence at the floor and scales speech by decibels', () => {
  expect(loudness(0)).toBe(0)
  expect(loudness(0.003)).toBe(0)
  expect(loudness(0.05)).toBeCloseTo(0.63, 1)
  expect(loudness(1)).toBe(1)
})
it('defaults to multilingual Small and Auto and validates persisted preferences', () => {
  expect(readPreferences()).toEqual({ model: 'small', language: 'auto' })
  savePreferences({ model: 'base', language: 'id' })
  expect(readPreferences()).toEqual({ model: 'base', language: 'id' })
  localStorage.setItem('stash.dictation.v1', '{"model":"small.en","language":"zh"}')
  expect(readPreferences()).toEqual({ model: 'small', language: 'auto' })
})
