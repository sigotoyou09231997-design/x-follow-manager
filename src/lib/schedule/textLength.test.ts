import { describe, expect, it } from 'vitest'
import { containsUrl, isOverLimit, remainingLength, weightedLength } from './textLength'

describe('weightedLength', () => {
  it('英数字は1文字1カウント', () => {
    expect(weightedLength('hello')).toBe(5)
  })

  it('日本語は1文字2カウント', () => {
    expect(weightedLength('こんにちは')).toBe(10)
  })

  it('英数字と日本語の混在を正しく数える', () => {
    // "abc" = 3, "テスト" = 6
    expect(weightedLength('abcテスト')).toBe(9)
  })

  it('URLは実際の長さに関係なく23カウント', () => {
    expect(weightedLength('https://example.com/very/long/path/that/keeps/going')).toBe(23)
    expect(weightedLength('短縮 https://example.com/a')).toBe(4 + 1 + 23)
  })

  it('絵文字は2カウント', () => {
    expect(weightedLength('🎉')).toBe(2)
  })
})

describe('remainingLength / isOverLimit', () => {
  it('280までは投稿可能', () => {
    const text = 'あ'.repeat(140) // 280
    expect(weightedLength(text)).toBe(280)
    expect(remainingLength(text)).toBe(0)
    expect(isOverLimit(text)).toBe(false)
  })

  it('281を超えると上限超過', () => {
    const text = 'あ'.repeat(140) + 'a'
    expect(isOverLimit(text)).toBe(true)
    expect(remainingLength(text)).toBe(-1)
  })
})

describe('containsUrl', () => {
  it('URLの有無を判定する（URL入り投稿は課金が高いため警告に使う）', () => {
    expect(containsUrl('普通の投稿です')).toBe(false)
    expect(containsUrl('詳しくは https://example.com へ')).toBe(true)
    expect(containsUrl('example.com/page を見て')).toBe(true)
  })
})
