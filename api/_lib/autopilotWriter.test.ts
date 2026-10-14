// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { HistoryPost, StyleProfile } from '../../src/lib/xAutopilot/types.js'
import {
  buildPostSystemPrompt,
  buildPostUserMessage,
  buildProfileUserMessage,
  PROFILE_SYSTEM_PROMPT,
  selectForProfile,
} from './autopilotWriter.js'

// AIに渡す指示の中身。守ってほしいこと（作り話をしない・未成年を連想させない・URLを入れない・
// 過去の範囲を超えて過激にしない）が、指示から消えていないことを確かめる。

const PROFILE: StyleProfile = {
  summary: 'ゆるい独り言が多い',
  voice: { person: '一人称なし', endings: ['〜かも', '〜だなあ'], emoji: 'ほぼ使わない', layout: '1〜2文・改行なし' },
  themes: [{ name: '朝の気分', note: '短くつぶやく' }],
  avoid: ['ハッシュタグ'],
}

const post = (i: number, likes = 0): HistoryPost => ({
  id: String(i),
  text: `投稿その${i}`,
  // 2026-10-30 から i 日前。i が大きくても、正しい日付になる
  at: new Date(Date.UTC(2026, 9, 30) - i * 86_400_000).toISOString(),
  likes,
  reposts: 0,
})

describe('1本書く指示', () => {
  const system = buildPostSystemPrompt()

  it('守ってほしいことが書いてある', () => {
    expect(system).toContain('事実を作らない')
    expect(system).toContain('未成年・学生・年齢が曖昧な相手を連想させる表現は、どんな形でも書かない')
    expect(system).toContain('URL・ハッシュタグ・メンション')
    expect(system).toContain('過去の投稿の範囲を超えて過激にしない')
    expect(system).toContain('segments は必ず1要素だけ')
    expect(system).toContain('全角140字') // 文章の共通ルール
  })

  it('この人らしさ・お手本・最近の投稿・日時を渡す', () => {
    const message = buildPostUserMessage({
      profile: PROFILE,
      samples: [post(1), post(2)],
      recent: ['最近の投稿A', '最近の投稿B'],
      plannedSameDay: ['同じ日の予約'],
      scheduledAt: '2026-10-10T03:00:00.000Z',
      timeZone: 'Asia/Tokyo',
    })
    expect(message).toContain('ゆるい独り言が多い')
    expect(message).toContain('〜かも / 〜だなあ')
    expect(message).toContain('朝の気分: 短くつぶやく')
    expect(message).toContain('【例1】\n投稿その1')
    expect(message).toContain('(1) 最近の投稿A')
    expect(message).toContain('同じ日の予約')
    expect(message).toContain('10月10日')
    expect(message).toContain('ハッシュタグ') // やらないこと
    expect(message).not.toContain('直前の案は使えませんでした')
  })

  // 実例: 取り消しても似た文が出続けた。取り消した文を渡し、同じ話題・型・言い回しを出さないよう頼む。
  it('取り消された投稿があれば、「出さないもの」として渡す。無ければ欄ごと出さない', () => {
    const base = {
      profile: PROFILE,
      samples: [],
      recent: [],
      plannedSameDay: [],
      scheduledAt: '2026-10-10T03:00:00.000Z',
      timeZone: 'Asia/Tokyo',
    }
    const message = buildPostUserMessage({ ...base, rejected: ['取り消した投稿A', '取り消した投稿B'] })
    expect(message).toContain('【本人が取り消した投稿】')
    expect(message).toContain('(1) 取り消した投稿A')
    expect(message).toContain('(2) 取り消した投稿B')
    expect(message).toContain('同じ話題・型・言い回し・似た切り口は書かない')
    expect(buildPostUserMessage(base)).not.toContain('取り消した投稿')
    expect(buildPostUserMessage({ ...base, rejected: [] })).not.toContain('取り消した投稿')
    expect(buildPostUserMessage({ ...base, rejected: ['  ', ''] })).not.toContain('取り消した投稿')
  })

  it('指示に、取り消された投稿と同じものを書かない・同じ文の型を続けない、が書いてある', () => {
    expect(system).toContain('【本人が取り消した投稿】がある場合、それと同じ話題・同じ型・同じ言い回し・似た切り口は書かない')
    expect(system).toContain('同じ文の型を続けない')
  })

  it('書き直しのときだけ、直前の案が使えなかった理由を渡す', () => {
    const message = buildPostUserMessage({
      profile: PROFILE,
      samples: [],
      recent: [],
      plannedSameDay: [],
      scheduledAt: '2026-10-10T03:00:00.000Z',
      timeZone: 'Asia/Tokyo',
      feedback: '最近の投稿と内容が似すぎている',
    })
    expect(message).toContain('直前の案は使えませんでした。理由: 最近の投稿と内容が似すぎている')
    expect(message).toContain('最近の投稿】まだない')
  })

  it('保存されたタイムゾーンが読めなくても、書けなくならない', () => {
    expect(() =>
      buildPostUserMessage({
        profile: PROFILE,
        samples: [],
        recent: [],
        plannedSameDay: [],
        scheduledAt: '2026-10-10T03:00:00.000Z',
        timeZone: 'Mars/Base',
      })
    ).not.toThrow()
  })
})

describe('文体をまとめる指示', () => {
  it('投稿に無いことを足さない・未成年を連想させる内容はまとめに入れない', () => {
    expect(PROFILE_SYSTEM_PROMPT).toContain('投稿に無い性格・経歴・職業・年齢・好みを推測で足さない')
    expect(PROFILE_SYSTEM_PROMPT).toContain('未成年・学生・年齢が曖昧な相手を連想させる内容')
  })

  it('渡す投稿は、新しい150件＋反応の多い50件まで（費用を抑える）。50件は「いまの書き方」の範囲(半年)の中から', () => {
    // 毎日1件ずつ400日ぶん。範囲は、いちばん新しい投稿から183日前まで（0〜183日前の184件）。150件の外にあるのは34件だけ
    const history = Array.from({ length: 400 }, (_, i) => post(i, i % 3 === 0 ? 5 : 0))
    const selected = selectForProfile(history)
    expect(selected).toHaveLength(184)
    expect(selected.slice(0, 150)).toEqual(history.slice(0, 150))
    expect(new Set(selected.map((p) => p.id)).size).toBe(184) // 重複なし
    expect(selected.some((p) => p.id === '183')).toBe(true) // 範囲の端(183日前)は入る
    expect(selected.some((p) => p.id === '184')).toBe(false) // その1日前は入らない
  })

  // 実例: 2025年は投稿の3〜4割が「おはようございます🍋」始まりで反応も多かったが、2026年は0件。
  // 反応の多さだけで全期間から選ぶと、いまは使っていない型の古い投稿が文体のまとめに入り、AIがそれで書いてしまう。
  it('反応がとても多くても、半年より古い投稿は入れない', () => {
    const history = Array.from({ length: 400 }, (_, i) => post(i, i === 399 ? 999 : i === 300 ? 500 : 0))
    const selected = selectForProfile(history)
    expect(selected.some((p) => p.id === '399')).toBe(false)
    expect(selected.some((p) => p.id === '300')).toBe(false)
  })

  it('半年より新しい投稿が少ない（長く休んでいた）ときは、新しい順150件のまま。空にならない', () => {
    // 30日おきに200件。半年の範囲に入るのは7件だけで、150件に満たない
    const history = Array.from({ length: 200 }, (_, i) => ({ ...post(0, i === 190 ? 99 : 0), id: String(i), at: new Date(Date.UTC(2026, 9, 30) - i * 30 * 86_400_000).toISOString() }))
    const selected = selectForProfile(history)
    expect(selected).toHaveLength(150)
    expect(selected).toEqual(history.slice(0, 150))
  })

  it('投稿の日付と反応を添える', () => {
    const message = buildProfileUserMessage([post(1, 12)])
    expect(message).toContain('2026-10-29 ♥12')
    expect(message).toContain('投稿その1')
  })
})
