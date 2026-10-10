import { describe, expect, it } from 'vitest'
import { cleanHistory, containsUrl, maxSimilarity, mentionsMinor, pickSamples, similarity, SIMILARITY_LIMIT } from './text'
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
