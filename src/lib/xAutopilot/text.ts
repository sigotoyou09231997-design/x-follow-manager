import type { HistoryPost } from './types'

// 自動運転が扱う「文」の検査と下ごしらえ。AIが何を返しても、ここを通らない文は予約に入れない。

/** 字面が似ているかの 0〜1。文字2つ組の一致で測る（日本語は単語で区切れないため）。 */
export function similarity(a: string, b: string): number {
  const grams = (text: string): Map<string, number> => {
    const s = text.replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase()
    const map = new Map<string, number>()
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2)
      map.set(g, (map.get(g) ?? 0) + 1)
    }
    return map
  }
  const x = grams(a)
  const y = grams(b)
  let total = 0
  let common = 0
  for (const n of x.values()) total += n
  for (const n of y.values()) total += n
  if (total === 0) return 0
  for (const [g, n] of x) common += Math.min(n, y.get(g) ?? 0)
  return (2 * common) / total
}

export function maxSimilarity(text: string, others: string[]): number {
  let best = 0
  for (const other of others) best = Math.max(best, similarity(text, other))
  return best
}

/** これ以上似ていたら「同じ内容の言い換え」とみなして書き直させる。 */
export const SIMILARITY_LIMIT = 0.55

/**
 * URL を含むか。URL入りの投稿は X の課金が13倍（1件約30円）になるので、自動運転では出さない。
 * 判定は textLength.ts と同じ考え方（http(s)始まりと、よくあるドメイン形式）。
 */
export function containsUrl(text: string): boolean {
  return /https?:\/\/\S+|\b(?:[a-z0-9-]+\.)+(?:com|net|org|jp|io|co|dev|app|ai|me|tv|info|biz)\b/i.test(text)
}

/**
 * 未成年を連想させる言葉。履歴から学ぶ対象にも、AIが書いた文にも、これを含むものは使わない。
 * 本人の過去の投稿に含まれていても、そこから文体を学ばない（自動で量産してしまわないため）。
 */
const MINOR_PATTERN =
  /小学|中学|高校|高[1-3１-３]|JK|JC|JS|女子高|男子高|未成年|18歳未満|児童|幼女|少女|少年|ロリ|ショタ|制服/i

export const mentionsMinor = (text: string): boolean => MINOR_PATTERN.test(text)

interface RawPost {
  id: string
  text: string
  created_at?: string
  public_metrics?: { like_count?: number; retweet_count?: number }
}

/** t.co の短縮URL（X が本文に自動で入れる）を取り除く。 */
const stripShortLinks = (text: string) => text.replace(/https?:\/\/t\.co\/\S+/g, '').trim()

/**
 * X から読んだ投稿を、文体を学ぶのに使える形にそろえる。
 * 返信・リポスト・リンクだけの投稿・短すぎるもの・未成年を連想させるもの・重複は落とす。
 * 新しい順で返す。
 */
export function cleanHistory(raw: RawPost[]): HistoryPost[] {
  const seen = new Set<string>()
  const posts: HistoryPost[] = []
  for (const item of raw) {
    const text = stripShortLinks(item.text ?? '')
    if (!item.id || text.length < 6) continue
    if (text.startsWith('@') || text.startsWith('RT @')) continue
    if (mentionsMinor(text)) continue
    const key = text.replace(/\s+/g, ' ')
    if (seen.has(key)) continue
    seen.add(key)
    posts.push({
      id: item.id,
      text,
      at: item.created_at ?? new Date(0).toISOString(),
      likes: item.public_metrics?.like_count ?? 0,
      reposts: item.public_metrics?.retweet_count ?? 0,
    })
  }
  return posts.sort((a, b) => b.at.localeCompare(a.at))
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * AIに見せる「お手本」の投稿を n 件選ぶ。反応の多いもの・最近のもの・残りからの無作為を混ぜる。
 * 毎回同じお手本だと文が似通うので、seed（枠の印など）で選び方を変える。同じ seed なら同じ結果。
 */
export function pickSamples(history: HistoryPost[], n: number, seed: number): HistoryPost[] {
  if (history.length <= n) return [...history]
  const rand = mulberry32(seed)
  const picked: HistoryPost[] = []
  const used = new Set<string>()
  // 候補の中から無作為に count 件。上位だけを候補にしても、毎回同じ顔ぶれにならないよう seed で選ぶ。
  const takeRandom = (pool: HistoryPost[], count: number) => {
    const candidates = pool.filter((p) => !used.has(p.id))
    while (count > 0 && picked.length < n && candidates.length > 0) {
      const [post] = candidates.splice(Math.floor(rand() * candidates.length), 1)
      used.add(post.id)
      picked.push(post)
      count--
    }
  }
  const byReaction = [...history].sort((a, b) => b.likes + b.reposts * 2 - (a.likes + a.reposts * 2))
  takeRandom(byReaction.slice(0, Math.max(n * 3, 12)), Math.ceil(n * 0.4)) // 反応の多かったもの
  takeRandom(history.slice(0, Math.max(n * 3, 12)), Math.ceil(n * 0.3)) // 最近のもの
  takeRandom(history, n - picked.length) // 残りは全体から
  return picked
}
