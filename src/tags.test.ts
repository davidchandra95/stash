import { describe, expect, it } from 'vitest'
import { legacyTagName, tagMatches, tagsFromText } from './tags'

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
