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

/**
 * 天気・気温の言葉。自動運転は数日先の投稿を作り置きするので、投稿が出る日の天気は分からない。
 * 外れた天気の話（涼しい日に「今日は暑い」）がそのまま本人の名前で出ると、本人が嘘をついたことになる。
 * 本人の指示（2026-10-15「天気とか不確定な情報は記事に出さないでほしい」）で、AIが書いた文に入っていたら使えない案にして書き直させる。
 *
 * 言葉の一致なので粗い（「雨」は雨宿りも、「晴れ」は「気が晴れた」も拾う）。
 * 誤って書き直させる費用は小さく、天気の話が通ってしまう費用は大きいので、広めに拾う。
 * 季節の名前（秋・冬）は入れない。季節は投稿する日から決まり、外れないため。
 */
const UNCERTAIN_WORDS = [
  '天気', '天候', '気温', '気圧', '湿度', '台風', '梅雨', '花粉', '黄砂', '紫外線', '熱中症',
  '猛暑', '酷暑', '残暑', '真夏日', '熱帯夜', '寒波', '極寒', '底冷え', '冷え込', '肌寒',
  '暑い', '暑さ', '暑く', '蒸し暑', '寒い', '寒さ', '寒く',
  '雨', '大雪', '降雪', '積雪', '初雪', '吹雪', '雪が降', '雷雨', '落雷',
  '晴れ', '晴天', '快晴', '曇り', '曇天', '日差し', '日射し', '陽射し',
  '強風', '突風', '暴風', '濃霧',
]

/** 本文に含まれる、天気・気温の言葉（無ければ空）。 */
export const uncertainIn = (text: string): string[] => UNCERTAIN_WORDS.filter((word) => text.includes(word))

/**
 * 本文の改行をなくして、1つの文章につなぐ（本人の指示「生成された文章は、勝手に改行しなくていい」）。
 * 日本語どうしは詰め、英数字どうしがつながるときだけ空白を1つ入れる（単語がくっつかないように）。
 */
export const flattenLines = (text: string): string =>
  text
    .replace(/\s*\r?\n\s*/g, (_m, offset: number, whole: string) => {
      const before = whole[offset - 1] ?? ''
      const after = whole.slice(offset + _m.length)[0] ?? ''
      return /[A-Za-z0-9]/.test(before) && /[A-Za-z0-9]/.test(after) ? ' ' : ''
    })
    .trim()

/**
 * ゲームの用語（何のゲームか分からないと意味が通らない言葉）。本人の指示で、どのゲームか分からない文は書かせない
 * （「回復アイテム、大事にしすぎて結局ずっと使えん。」のように、読む人には何のゲームの話か分からないため）。
 * 「アイテム」だけで足りるが、見つけた言葉を理由に出すので、よく出る形も並べておく。
 */
const GAME_WORDS = [
  '回復アイテム', 'アイテム', 'ガチャ', 'レベル上げ', 'レベリング', '周回', 'スタミナ', 'リセマラ', 'ドロップ', 'クエスト',
  'ボス戦', 'ボス', '装備', '経験値', 'ステータス', '攻略', 'パーティ', 'デバフ', 'バフ', 'リスポーン', '武器', 'スキル振り', 'ランク戦',
]

/**
 * ゲームの用語を使っているのに、どのゲームか（「」『』で題名を書いている）分からない文の、その用語（無ければ空）。
 * 題名を書いてあれば、ゲームの話として通じるので止めない。
 */
export const vagueGameIn = (text: string): string[] =>
  /[「『][^」』]+[」』]/.test(text) ? [] : GAME_WORDS.filter((word) => text.includes(word))

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

/** 「いまの書き方」の手がかりにする期間。いちばん新しい投稿から、何日さかのぼるか。 */
export const STYLE_WINDOW_DAYS = 183

/**
 * 履歴のうち、「いまの書き方」を表す範囲（いちばん新しい投稿から半年）。history は新しい順。
 *
 * 書き方は時期で変わる。反応の多さだけで全期間から選ぶと、いまは使っていない型（実例: 2025年に投稿の3〜4割が
 * 「おはようございます🍋」始まりだったが、2026年は0件）の古い投稿が、反応が多いぶんお手本や文体のまとめに多く混ざり、
 * AIがそれを真似て、本人がもうやめた書き方で投稿してしまう。
 * 範囲が minCount 件に満たないとき（長く休んでいた人など）は、新しい順に minCount 件まで広げる。お手本が空になるより、
 * 古くても有るほうがよいため。日付が読めない投稿は、範囲の内に数える（捨てて件数を減らさない）。
 */
export function recentWindow(history: HistoryPost[], minCount: number): HistoryPost[] {
  const times = history.map((p) => Date.parse(p.at)).filter((t) => !Number.isNaN(t))
  if (times.length === 0) return history
  const cutoff = Math.max(...times) - STYLE_WINDOW_DAYS * 86_400_000
  const inWindow = history.filter((p) => {
    const t = Date.parse(p.at)
    return Number.isNaN(t) || t >= cutoff
  })
  return inWindow.length >= minCount ? inWindow : history.slice(0, minCount)
}

/**
 * AIに見せる「お手本」の投稿を n 件選ぶ。反応の多いもの・最近のもの・残りからの無作為を混ぜる。
 * どれも「いまの書き方」の範囲（recentWindow）の中から選ぶ。古い投稿は、反応が多くても選ばない。
 * 毎回同じお手本だと文が似通うので、seed（枠の印など）で選び方を変える。同じ seed なら同じ結果。
 */
export function pickSamples(history: HistoryPost[], n: number, seed: number): HistoryPost[] {
  if (history.length <= n) return [...history]
  const pool = recentWindow(history, Math.max(n * 3, 12))
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
  const byReaction = [...pool].sort((a, b) => b.likes + b.reposts * 2 - (a.likes + a.reposts * 2))
  takeRandom(byReaction.slice(0, Math.max(n * 3, 12)), Math.ceil(n * 0.4)) // 反応の多かったもの
  takeRandom(pool.slice(0, Math.max(n * 3, 12)), Math.ceil(n * 0.3)) // 最近のもの
  takeRandom(pool, n - picked.length) // 残りは範囲の中から
  return picked
}
