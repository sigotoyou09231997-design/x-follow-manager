import { describe, expect, it } from 'vitest'
import { normalizeUsername } from './username'

describe('normalizeUsername', () => {
  it('strips a leading @', () => {
    expect(normalizeUsername('@example')).toBe('example')
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeUsername('  example  ')).toBe('example')
  })

  it('lowercases so comparisons are case-insensitive', () => {
    expect(normalizeUsername('ExAmple')).toBe('example')
    expect(normalizeUsername('example')).toBe(normalizeUsername('EXAMPLE'))
  })

  it('returns undefined for empty input', () => {
    expect(normalizeUsername('')).toBeUndefined()
    expect(normalizeUsername(undefined)).toBeUndefined()
    expect(normalizeUsername('   ')).toBeUndefined()
  })
})
