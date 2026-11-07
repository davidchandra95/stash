import { describe, expect, it } from 'vitest'
import {
  legacyTagName,
  tagColorRules,
  tagMatches,
  tagsFromText,
  tagTone,
  tagTones,
  taskTagName,
} from './tags'

describe('body hashtags', () => {
  it('finds body tags, trims closing sentence punctuation, and preserves non-space names', () => {
    expect(
      tagsFromText('This is a test body text. #tutorial.\nAnother line #project-alpha.)]”'),
    ).toEqual(['tutorial', 'project-alpha'])
  })

  it('uses lower-case identities, removes duplicates, and rejects empty or embedded hashes', () => {
    expect(tagsFromText('#Tutorial #tutorial # #. email#hidden ##also-hidden #two_words')).toEqual([
      'tutorial',
      'two_words',
    ])
  })

  it('keeps the exact source range for a decorated hashtag', () => {
    expect(tagMatches('Text #Tutorial.')).toEqual([{ tag: 'tutorial', from: 5, to: 14 }])
  })

  it('converts legacy labels to safe stable hashtag names', () => {
    expect(legacyTagName(' My Project / Alpha ')).toBe('my-project-alpha')
    expect(legacyTagName('###already-good')).toBe('already-good')
    expect(legacyTagName('   ')).toBeUndefined()
  })
})

it('gives each tag one stable tone regardless of case', () => {
  expect(tagTones).toContain(tagTone('ideas'))
  expect(tagTone('Ideas')).toBe(tagTone('ideas'))
})

it('normalizes a typed task tag', () => {
  expect(taskTagName('  #Deep Work ')).toBe('deep-work')
  expect(taskTagName('深度')).toBe('深度')
  expect(taskTagName('##')).toBeUndefined()
  expect(taskTagName('   ')).toBeUndefined()
  expect([...taskTagName('x'.repeat(60))!]).toHaveLength(50)
})

describe('tag color rules', () => {
  it('recolors chips and note-text tags for each picked tag, ignoring case', () => {
    const rules = tagColorRules({ ideas: 'pink', 'to"do': 'slate' })
    expect(rules).toContain(
      ':is([data-tag="ideas" i], [data-body-tag="ideas" i])[data-tone] { --tone: var(--tone-pink); }',
    )
    expect(rules).toContain('[data-tag="to\\"do" i]')
    expect(rules).toContain('var(--tone-slate)')
  })

  it('skips unknown tones and is empty without picks', () => {
    expect(tagColorRules({})).toBe('')
    expect(tagColorRules({ ideas: 'red; } body { display: none' as never })).toBe('')
  })
})
