import { describe, expect, it } from 'vitest'
import {
  cleanHistory,
  containsUrl,
  maxSimilarity,
  mentionsMinor,
  pickSamples,
  recentWindow,
  similarity,
  SIMILARITY_LIMIT,
} from './text'
import type { HistoryPost } from './types'

describe('似ているか', () => {
  it('同じ文は 1、まったく違う文は低い', () => {
    expect(similarity('今日はいい天気ですね', '今日はいい天気ですね')).toBe(1)
    expect(similarity('今日はいい天気ですね', 'コーヒーを淹れて仕事を始める')).toBeLessThan(0.2)
  })

  it('語尾や記号を変えただけの言い換えは、しきい値を超える', () => {
    expect(similarity('今日はいい天気ですね！', '今日はいい天気ですね。')).toBeGreaterThan(SIMILARITY_LIMIT)
    expect(similarity('今日はいい天気ですね', '今日はいい天気だなあ')).toBeLessThan(SIMILARITY_LIMIT + 0.2)
  })

  it('空の文・短い文でも落ちない', () => {
    expect(similarity('', '')).toBe(0)
    expect(similarity('あ', 'い')).toBe(0)
    expect(maxSimilarity('文', [])).toBe(0)
  })

  it('いくつかの中で最も似ているものの値を返す', () => {
    expect(maxSimilarity('朝ごはんにパンを食べた', ['全然ちがう話', '朝ごはんにパンを食べた'])).toBe(1)
  })
})

describe('URL・未成年を連想させる言葉', () => {
  it('URLを検出する（課金が13倍になるので出さない）', () => {
    expect(containsUrl('見てね https://example.com/a')).toBe(true)
    expect(containsUrl('example.com で公開')).toBe(true)
    expect(containsUrl('今日は散歩した')).toBe(false)
  })

  it('未成年を連想させる言葉を検出する', () => {
    for (const text of ['女子高生です', '中学の頃の話', 'JKっぽい', '18歳未満はNG', 'ロリ系', 'ショタ']) {
      expect(mentionsMinor(text)).toBe(true)
    }
    expect(mentionsMinor('大人のお姉さんと話したい')).toBe(false)
    expect(mentionsMinor('耳が弱いので、ささやいてほしい')).toBe(false)
  })
})

describe('履歴の下ごしらえ', () => {
  const raw = (id: string, text: string, at = '2026-10-01T00:00:00.000Z', likes = 0) => ({
    id,
    text,
    created_at: at,
    public_metrics: { like_count: likes, retweet_count: 0 },
  })

  it('返信・リポスト・短すぎるもの・リンクだけのもの・重複・未成年を連想するものを落とす', () => {
    const cleaned = cleanHistory([
      raw('1', '朝のコーヒーがおいしい'),
      raw('2', '@someone ありがとう！'),
      raw('3', 'RT @x: これは転載'),
      raw('4', 'おはよ'),
      raw('5', 'https://t.co/abc123'),
      raw('6', '朝のコーヒーがおいしい'),
      raw('7', '女子高生の頃の話'),
      raw('8', '夜の散歩が好き https://t.co/zzz'),
    ])
    expect(cleaned.map((p) => p.id).sort()).toEqual(['1', '8'])
    expect(cleaned.find((p) => p.id === '8')?.text).toBe('夜の散歩が好き') // t.co の短縮URLは本文から除く
  })

  it('新しい順に並べ、反応数を引き継ぐ', () => {
    const cleaned = cleanHistory([
      raw('a', '古い投稿のほうです', '2026-09-01T00:00:00.000Z'),
      raw('b', '新しい投稿のほうです', '2026-10-05T00:00:00.000Z', 12),
    ])
    expect(cleaned.map((p) => p.id)).toEqual(['b', 'a'])
    expect(cleaned[0].likes).toBe(12)
  })
})

describe('お手本の選び方', () => {
  const posts: HistoryPost[] = Array.from({ length: 60 }, (_, i) => ({
    id: String(i),
    text: `投稿その${i}の本文です`,
    at: new Date(2026, 9, 1, 0, 60 - i).toISOString(),
    likes: i % 7 === 0 ? 50 : 0,
    reposts: 0,
  }))

  it('n 件を重複なく選ぶ', () => {
    const picked = pickSamples(posts, 12, 1)
    expect(picked).toHaveLength(12)
    expect(new Set(picked.map((p) => p.id)).size).toBe(12)
  })

  it('同じ seed なら同じ結果、seed を変えれば顔ぶれが変わる（毎回同じお手本にしない）', () => {
    expect(pickSamples(posts, 12, 7).map((p) => p.id)).toEqual(pickSamples(posts, 12, 7).map((p) => p.id))
    expect(pickSamples(posts, 12, 7).map((p) => p.id)).not.toEqual(pickSamples(posts, 12, 8).map((p) => p.id))
  })

  it('履歴が n 件に満たなければ、あるだけ全部', () => {
    expect(pickSamples(posts.slice(0, 5), 12, 1)).toHaveLength(5)
  })

  it('反応の多かった投稿が混ざる', () => {
    const picked = pickSamples(posts, 12, 3)
    expect(picked.some((p) => p.likes > 0)).toBe(true)
  })
})

// 実例: 2025年は投稿の3〜4割が「おはようございます🍋」始まりで反応も多かったが、2026年は0件。
// 反応の多さだけで全期間から選ぶと、いまは使っていない型の古い投稿がお手本に多く混ざり、AIがそれを真似てしまう。
describe('お手本は「いまの書き方」の範囲から選ぶ', () => {
  const DAY = 86_400_000
  const base = Date.UTC(2026, 9, 30)
  // 新しい順に 300 件。毎日1件。0〜182日前が「いま」で反応は少なめ、183日より前は「昔」で反応がとても多い
  const history: HistoryPost[] = Array.from({ length: 300 }, (_, i) => ({
    id: String(i),
    text: `投稿その${i}の本文です`,
    at: new Date(base - i * DAY).toISOString(),
    likes: i <= 183 ? (i % 5 === 0 ? 10 : 1) : 200,
    reposts: 0,
  }))

  it('昔の投稿は、反応がとても多くても、どの seed でも選ばれない', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const picked = pickSamples(history, 12, seed)
      expect(picked).toHaveLength(12)
      expect(picked.every((p) => Number(p.id) <= 183)).toBe(true)
    }
  })

  it('recentWindow: いちばん新しい投稿から183日前まで。端は入り、その1日前は入らない', () => {
    const window = recentWindow(history, 12)
    expect(window).toHaveLength(184)
    expect(window.some((p) => p.id === '183')).toBe(true)
    expect(window.some((p) => p.id === '184')).toBe(false)
  })

  it('recentWindow: 範囲が minCount 件に満たないとき（長く休んでいた）は、新しい順に minCount 件まで広げる', () => {
    const sparse = Array.from({ length: 40 }, (_, i) => ({ ...history[0], id: String(i), at: new Date(base - i * 60 * DAY).toISOString() }))
    expect(recentWindow(sparse, 12).map((p) => p.id)).toEqual(sparse.slice(0, 12).map((p) => p.id))
    // その場合でもお手本は空にならず、n 件選べる
    expect(pickSamples(sparse, 12, 1)).toHaveLength(12)
  })

  it('recentWindow: 日付が読めない投稿は範囲の内に数える／全部読めないなら全件のまま／空は空', () => {
    const broken = [{ ...history[0], id: 'x', at: 'いつか' }, ...history.slice(0, 3)]
    expect(recentWindow(broken, 1).some((p) => p.id === 'x')).toBe(true)
    const allBroken = history.slice(0, 5).map((p) => ({ ...p, at: '不明' }))
    expect(recentWindow(allBroken, 1)).toEqual(allBroken)
    expect(recentWindow([], 12)).toEqual([])
  })
})
