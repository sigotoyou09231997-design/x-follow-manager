import { describe, expect, it } from 'vitest'
import type { ChannelSnapshot } from './api'
import {
  agoLabel,
  isDirty,
  isValid,
  livenessOf,
  notYetPosted,
  pauseStateOf,
  slotsOf,
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
    paused: false,
    pausedAt: null,
    pauseReady: true,
    limits: { maxLength: 1000, maxMessages: 10 },
    // 時間帯は、ことわりが無ければ全部の文が終日。いまの時間は全部の文が使われている
    hours: (patch.messages ?? ['保存した文']).map(() => null),
    schedule: { hour: 12, activeIndexes: (patch.messages ?? ['保存した文']).map((_, i) => i), idle: false, nextHour: null },
    ...patch,
  }
}

// 時間帯を決めていない（終日の）文を並べる
const s = (...texts: string[]) => texts.map((text) => ({ text, hours: null }))

describe('書きかけの判定', () => {
  it('空の入力欄が付いているだけでは「編集中」と数えない', () => {
    expect(isDirty(s('保存した文', ''), s('保存した文'))).toBe(false)
    expect(isDirty(s('保存した文', '  \n '), s('保存した文'))).toBe(false)
  })

  it('前後の空白や改行コードの違いだけでは「編集中」と数えない', () => {
    expect(isDirty(s('  保存した文\r\n'), s('保存した文'))).toBe(false)
  })

  it('中身か順番が違えば編集中', () => {
    expect(isDirty(s('別の文'), s('保存した文'))).toBe(true)
    expect(isDirty(s('b', 'a'), s('a', 'b'))).toBe(true)
    expect(isDirty(s('a'), s('a', 'b'))).toBe(true)
  })

  it('空の欄・長すぎる文があると保存できない', () => {
    expect(isValid(s('a'), 1000)).toBe(true)
    expect(isValid([], 1000)).toBe(false)
    expect(isValid(s('a', ''), 1000)).toBe(false)
    expect(isValid(s('あ'.repeat(1001)), 1000)).toBe(false)
    expect(isValid(s('あ'.repeat(1000)), 1000)).toBe(true)
  })

  it('時間帯だけを変えても編集中になる', () => {
    expect(isDirty([{ text: 'a', hours: [9, 10] }], s('a'))).toBe(true)
    expect(isDirty([{ text: 'a', hours: [9, 10] }], [{ text: 'a', hours: [9, 10] }])).toBe(false)
  })

  it('時間の並びや重なりが違うだけ、24時間ぜんぶと終日の違いだけでは編集中と数えない', () => {
    expect(isDirty([{ text: 'a', hours: [10, 9, 9] }], [{ text: 'a', hours: [9, 10] }])).toBe(false)
    expect(isDirty([{ text: 'a', hours: Array.from({ length: 24 }, (_, i) => i) }], s('a'))).toBe(false)
  })

  it('空の欄に付いた時間帯は、編集中と数えない', () => {
    expect(isDirty([...s('a'), { text: '', hours: [3] }], s('a'))).toBe(false)
  })

  it('時間を1つも選んでいない時間帯があると保存できない', () => {
    expect(isValid([{ text: 'a', hours: [] }], 1000)).toBe(false)
    expect(isValid([{ text: 'a', hours: [9] }], 1000)).toBe(true)
  })
})

describe('保存済みの文を書きかけの形にする', () => {
  it('文と時間帯を並びのまま組にする。時間帯が足りないぶんは終日', () => {
    expect(slotsOf({ messages: ['a', 'b'], hours: [[9, 10], null] })).toEqual([
      { text: 'a', hours: [9, 10] },
      { text: 'b', hours: null },
    ])
    expect(slotsOf({ messages: ['a', 'b'], hours: [] })).toEqual(s('a', 'b'))
  })
})

describe('履歴の文を使う', () => {
  it('欄が1つ・1つしか回せない投稿先は置き換え、そうでなければ足す', () => {
    expect(withArchived(s('いまの文'), '前の文', 10)).toEqual(s('前の文'))
    expect(withArchived(s('a', 'b'), '前の文', 1)).toEqual(s('前の文'))
    expect(withArchived(s('a', 'b'), '前の文', 10)).toEqual(s('a', 'b', '前の文'))
  })

  it('上限まで埋まっていたら足さない', () => {
    expect(withArchived(s('a', 'b'), '前の文', 2)).toEqual(s('a', 'b'))
  })

  it('欄が1つの置き換えは、その欄の時間帯を引き継ぐ。足すときは終日', () => {
    expect(withArchived([{ text: 'いまの文', hours: [9, 10] }], '前の文', 10)).toEqual([{ text: '前の文', hours: [9, 10] }])
    expect(withArchived([{ text: 'a', hours: [9] }, { text: 'b', hours: null }], '前の文', 10)).toEqual([
      { text: 'a', hours: [9] },
      { text: 'b', hours: null },
      { text: '前の文', hours: null },
    ])
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

describe('止める／再開するの状態（押したことと、Mac が受け取ったことの突き合わせ）', () => {
  const report = (paused?: boolean) => ({
    lastPost: null,
    today: 3,
    at: minutesBefore(1),
    ...(paused === undefined ? {} : { paused }),
  })

  it('止めていなくて、Mac も止まっていなければ「動いている」', () => {
    expect(pauseStateOf(snapshot({ status: report(false) }))).toBe('running')
    expect(pauseStateOf(snapshot())).toBe('running') // まだ報告が無くても
  })

  it('止めると押しても、Mac が「止まっています」と報告するまでは「依頼中」', () => {
    expect(pauseStateOf(snapshot({ paused: true, status: report(false) }))).toBe('pausing')
    expect(pauseStateOf(snapshot({ paused: true, status: null }))).toBe('pausing')
  })

  it('Mac が「止まっています」と報告したら「停止中」', () => {
    expect(pauseStateOf(snapshot({ paused: true, status: report(true) }))).toBe('paused')
  })

  it('再開すると押しても、Mac が止まっていると報告しているあいだは「再開待ち」', () => {
    expect(pauseStateOf(snapshot({ paused: false, status: report(true) }))).toBe('resuming')
  })

  it('止める機能より前の投稿役（paused を報告しない）は、止まったと言い切らない', () => {
    // そういう投稿役は止まらない。ずっと「依頼中」のままで、止まっていると誤解させない。
    expect(pauseStateOf(snapshot({ paused: true, status: report() }))).toBe('pausing')
  })

  it('時間帯の外で投稿を休んでいるあいだ、Mac が「止まっています」と報告しても「再開待ち」とは見せない', () => {
    const idle = { hour: 3, activeIndexes: [], idle: true, nextHour: 9 }
    expect(pauseStateOf(snapshot({ paused: false, schedule: idle, status: report(true) }))).toBe('running')
  })

  it('休んでいる時間帯でも、画面で止めたなら「停止中」になる', () => {
    const idle = { hour: 3, activeIndexes: [], idle: true, nextHour: 9 }
    expect(pauseStateOf(snapshot({ paused: true, schedule: idle, status: report(true) }))).toBe('paused')
  })
})
