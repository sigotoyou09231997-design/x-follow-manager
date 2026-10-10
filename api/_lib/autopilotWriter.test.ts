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
  at: `2026-10-${String(30 - i).padStart(2, '0')}T00:00:00.000Z`,
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

  it('渡す投稿は、新しい150件＋反応の多い50件まで（費用を抑える）', () => {
    const history = Array.from({ length: 400 }, (_, i) => post(i, i === 399 ? 99 : 0))
    const selected = selectForProfile(history)
    expect(selected).toHaveLength(200)
    expect(selected.slice(0, 150)).toEqual(history.slice(0, 150))
    expect(selected.some((p) => p.id === '399')).toBe(true) // 古くても、反応が多ければ入る
    expect(new Set(selected.map((p) => p.id)).size).toBe(200)
  })

  it('投稿の日付と反応を添える', () => {
    const message = buildProfileUserMessage([post(1, 12)])
    expect(message).toContain('2026-10-29 ♥12')
    expect(message).toContain('投稿その1')
  })
})
