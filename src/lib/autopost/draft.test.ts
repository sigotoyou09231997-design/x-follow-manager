import { describe, expect, it } from 'vitest'
import type { ChannelSnapshot } from './api'
import {
  agoLabel,
  isDirty,
  isValid,
  livenessOf,
  notYetPosted,
  withArchived,
} from './draft'

const NOW = new Date('2026-10-07T12:30:00.000Z').getTime()
const minutesBefore = (m: number) => new Date(NOW - m * 60000).toISOString()

function snapshot(patch: Partial<ChannelSnapshot> = {}): ChannelSnapshot {
  return {
    channel: 'discord',
    messages: ['保存した文'],
    archive: [],
    version: 1,
    savedAt: null,
    status: null,
    limits: { maxLength: 1000, maxMessages: 10 },
    ...patch,
  }
}

describe('書きかけの判定', () => {
  it('空の入力欄が付いているだけでは「編集中」と数えない', () => {
    expect(isDirty(['保存した文', ''], ['保存した文'])).toBe(false)
    expect(isDirty(['保存した文', '  \n '], ['保存した文'])).toBe(false)
  })

  it('前後の空白や改行コードの違いだけでは「編集中」と数えない', () => {
    expect(isDirty(['  保存した文\r\n'], ['保存した文'])).toBe(false)
  })

  it('中身か順番が違えば編集中', () => {
    expect(isDirty(['別の文'], ['保存した文'])).toBe(true)
    expect(isDirty(['b', 'a'], ['a', 'b'])).toBe(true)
    expect(isDirty(['a'], ['a', 'b'])).toBe(true)
  })

  it('空の欄・長すぎる文があると保存できない', () => {
    expect(isValid(['a'], 1000)).toBe(true)
    expect(isValid([], 1000)).toBe(false)
    expect(isValid(['a', ''], 1000)).toBe(false)
    expect(isValid(['あ'.repeat(1001)], 1000)).toBe(false)
    expect(isValid(['あ'.repeat(1000)], 1000)).toBe(true)
  })
})

describe('履歴の文を使う', () => {
  it('欄が1つ・1つしか回せない投稿先は置き換え、そうでなければ足す', () => {
    expect(withArchived(['いまの文'], '前の文', 10)).toEqual(['前の文'])
    expect(withArchived(['a', 'b'], '前の文', 1)).toEqual(['前の文'])
    expect(withArchived(['a', 'b'], '前の文', 10)).toEqual(['a', 'b', '前の文'])
  })

  it('上限まで埋まっていたら足さない', () => {
    expect(withArchived(['a', 'b'], '前の文', 2)).toEqual(['a', 'b'])
  })
})

describe('Mac の様子', () => {
  it('報告が無ければ never、20分以内なら alive、それより空いたら silent', () => {
    expect(livenessOf(null, NOW)).toBe('never')
    const status = (m: number) => ({ lastPost: null, today: 0, at: minutesBefore(m) })
    expect(livenessOf(status(3), NOW)).toBe('alive')
    expect(livenessOf(status(19), NOW)).toBe('alive')
    expect(livenessOf(status(20), NOW)).toBe('silent')
  })

  it('「◯分前」「◯時間◯分前」', () => {
    expect(agoLabel(minutesBefore(0), NOW)).toBe('0分前')
    expect(agoLabel(minutesBefore(59), NOW)).toBe('59分前')
    expect(agoLabel(minutesBefore(135), NOW)).toBe('2時間15分前')
  })

  it('最後に投稿された文が保存済みの文のどれでもなければ、まだ投稿されていない', () => {
    const status = (text: string) => ({ lastPost: { t: minutesBefore(5), text }, today: 1, at: minutesBefore(1) })
    expect(notYetPosted(snapshot({ status: status('古い文') }))).toBe(true)
    expect(notYetPosted(snapshot({ status: status('保存した文') }))).toBe(false)
    // 投稿側は改行を「 / 」に直して報告してくる
    expect(notYetPosted(snapshot({ messages: ['一行目\n24'], status: status('一行目 / 24') }))).toBe(false)
    expect(notYetPosted(snapshot({ status: null }))).toBe(false)
    expect(notYetPosted(snapshot({ messages: [], status: status('古い文') }))).toBe(false)
  })
})
