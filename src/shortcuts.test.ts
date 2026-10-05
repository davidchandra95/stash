// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  bindingError,
  bindingFor,
  eventBinding,
  matchesBinding,
  normalizeOverrides,
  shortcutCommands,
} from './shortcuts'
describe('shortcut assignments', () => {
  it('has distinct defaults, preserves cleared bindings, and accepts swaps', () => {
    for (const command of shortcutCommands)
      if (command.defaultKey) expect(bindingError(command.id, command.defaultKey, {})).toBeNull()
    expect(normalizeOverrides({ search: 'Mod+p' })).toEqual({ search: 'Mod+p', 'quick-open': null })
    expect(bindingFor('bold', { bold: null })).toBeNull()
    expect(bindingFor('bold', {})).toBe('Mod+b')
    expect(normalizeOverrides({ bold: 'Mod+i', italic: 'Mod+b', highlight: null })).toEqual({
      bold: 'Mod+i',
      italic: 'Mod+b',
      highlight: null,
    })
  })
  it('rejects conflicts and reserved keys without silently replacing another command', () => {
    expect(bindingError('bold', 'Mod+n', {})).toContain('New note')
    expect(bindingError('bold', 'Mod+z', {})).toContain('Undo')
    expect(bindingError('bold', 'Shift+b', {})).toContain('Include')
    expect(bindingError('bold', 'Mod+Alt+b', {})).toBeNull()
    expect(normalizeOverrides({ bold: 'nonsense', unexpected: 'Mod+j', italic: null })).toEqual({
      italic: null,
    })
  })
  it('matches exact modifiers and underlying Option and punctuation keys', () => {
    expect(
      eventBinding(
        new KeyboardEvent('keydown', { key: 'π', code: 'KeyP', metaKey: true, altKey: true }),
        true,
      ),
    ).toBe('Mod+Alt+p')
    expect(
      eventBinding(
        new KeyboardEvent('keydown', { key: '>', code: 'Period', metaKey: true, shiftKey: true }),
        true,
      ),
    ).toBe('Mod+Shift+.')
    expect(
      matchesBinding(
        new KeyboardEvent('keydown', { key: 'N', metaKey: true, shiftKey: true }),
        'Mod+n',
        true,
      ),
    ).toBe(false)
    expect(
      matchesBinding(
        new KeyboardEvent('keydown', { key: 'Tab', ctrlKey: true }),
        'Ctrl+Tab',
        false,
      ),
    ).toBe(true)
  })
})
